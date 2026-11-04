'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase, databaseAdapter } = require('../tools/admin-db');
const { createSchema, applyGrants } = require('../tools/schema');
const { provisionAccount } = require('../tools/account');
const { importFeature, executeCommand } = require('../src/features/commands');
const repository = require('../src/features/repository');
const { runTick } = require('../src/worker');
const { claimJob } = require('../src/worker/jobs');

test(
    'leased Steam jobs run outside SQL transactions, establish a baseline, deduplicate unlocks and reject stale results',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' },
    async () => {
        const admin = adminDatabase();
        const schema = 'icb_test_' + randomUUID().replaceAll('-', '');
        let pool;
        let service;
        try {
            await admin.query(format('CREATE SCHEMA %I', schema));
            pool = adminDatabase({ ...process.env, ICB_DB_SCHEMA: schema });
            await createSchema(pool);
            if (process.env.ICB_TEST_SERVICE_PASSWORD) {
                await admin.query(format('GRANT USAGE ON SCHEMA %I TO icb_service', schema));
                await applyGrants(pool);
                service = adminDatabase({
                    ...process.env,
                    ICB_DB_SCHEMA: schema,
                    PGUSER: 'icb_service',
                    PGPASSWORD: process.env.ICB_TEST_SERVICE_PASSWORD
                });
            }
            const adapter = databaseAdapter(service || pool);
            let borrowed = 0;
            const db = {
                withClient: async (operation) =>
                    adapter.withClient(async (client) => {
                        borrowed++;
                        try {
                            return await operation(client);
                        } finally {
                            borrowed--;
                        }
                    })
            };
            const owner = {
                id: await provisionAccount(pool, 'SteamFixture', 'FixturePassword123!'),
                reporting_timezone: 'America/Chicago'
            };
            const collector = randomUUID();
            await pool.query(
                "INSERT INTO collector_leases(owner_id,collector_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
                [owner.id, collector]
            );
            await importFeature(db, owner, 'steam', {
                collector_id: collector,
                command_id: randomUUID(),
                source_sha256: 'c'.repeat(64),
                input_watermark: 'fixture:steam',
                payload: {
                    steamId: '76561198000000001',
                    appId: 123,
                    enabled: true,
                    known: null,
                    seq: 1,
                    schema: {},
                    stats: {},
                    statDefs: {},
                    rarity: {},
                    popups: []
                }
            });
            const credential = randomUUID();
            const arn =
                'arn:aws:secretsmanager:us-east-1:123456789012:secret:baby-icb-fixture/steam';
            await pool.query(
                "INSERT INTO integration_secrets(owner_id,kind,secret_arn,credential_version) VALUES($1,'steam',$2,$3)",
                [owner.id, arn, credential]
            );
            await pool.query(
                "INSERT INTO integration_jobs(owner_id,kind,due_at) VALUES($1,'steam',now())",
                [owner.id]
            );
            const claims = await Promise.all([claimJob(db), claimJob(db)]);
            assert.equal(claims.filter(Boolean).length, 1);
            await pool.query(
                "UPDATE integration_jobs SET lease_until=now()-interval '1 second' WHERE owner_id=$1",
                [owner.id]
            );
            let unlocked = ['FIRST'];
            let mutate = null;
            const options = {
                secrets: {
                    send: async (command) => {
                        assert.equal(command.input.SecretId, arn);
                        assert.equal(command.input.VersionId, credential);
                        return { SecretString: 'FixtureSteamCredential' };
                    }
                },
                steamGet: async (path) => {
                    assert.equal(borrowed, 0, 'provider I/O must not retain a borrowed SQL client');
                    if (path.includes('/GetSchemaForGame/'))
                        return {
                            game: {
                                gameName: 'Fixture',
                                availableGameStats: {
                                    achievements: ['FIRST', 'SECOND', 'STALE'].map((name) => ({
                                        name,
                                        displayName: name
                                    }))
                                }
                            }
                        };
                    if (path.includes('/GetGlobalAchievementPercentagesForApp/'))
                        return { achievementpercentages: { achievements: [] } };
                    if (path.includes('/GetUserStatsForGame/'))
                        return { playerstats: { stats: [] } };
                    if (mutate) {
                        const operation = mutate;
                        mutate = null;
                        await operation();
                    }
                    return {
                        playerstats: {
                            success: true,
                            achievements: unlocked.map((apiname) => ({
                                apiname,
                                achieved: 1,
                                unlocktime: 1700000000
                            }))
                        }
                    };
                }
            };
            await runTick(db, options);
            let document = await db.withClient(
                async (client) => (await repository.loadDocuments(client, owner.id))['steam.json']
            );
            assert.deepEqual(Object.keys(document.known), ['FIRST']);
            assert.deepEqual(document.popups, [], 'first successful response is a silent baseline');
            unlocked = ['FIRST', 'SECOND'];
            await pool.query('UPDATE integration_jobs SET due_at=now() WHERE owner_id=$1', [
                owner.id
            ]);
            await runTick(db, options);
            document = await db.withClient(
                async (client) => (await repository.loadDocuments(client, owner.id))['steam.json']
            );
            assert.equal(document.popups.length, 1);
            assert.equal(document.popups[0].apiname, 'SECOND');
            assert.equal(JSON.stringify(document).includes('FixtureSteamCredential'), false);
            await pool.query('UPDATE integration_jobs SET due_at=now() WHERE owner_id=$1', [
                owner.id
            ]);
            await runTick(db, options);
            document = await db.withClient(
                async (client) => (await repository.loadDocuments(client, owner.id))['steam.json']
            );
            assert.equal(
                document.popups.length,
                1,
                'unchanged achievements never produce another popup'
            );
            unlocked.push('STALE');
            mutate = async () => {
                const authority = await db.withClient((client) =>
                    repository.authorities(client, owner.id)
                );
                await executeCommand(db, owner, 'steam', {
                    protocol_version: 2,
                    command_id: randomUUID(),
                    expected_revision: authority.get('steam').revision,
                    action: 'request',
                    operands: {
                        path: '/api/steam/settings',
                        method: 'POST',
                        values: { progressTitle: 'New title' }
                    }
                });
            };

            await pool.query('UPDATE integration_jobs SET due_at=now() WHERE owner_id=$1', [
                owner.id
            ]);
            await runTick(db, options);
            document = await db.withClient(
                async (client) => (await repository.loadDocuments(client, owner.id))['steam.json']
            );
            assert.equal(document.progressTitle, 'New title');
            assert.equal(
                'STALE' in document.known,
                false,
                'an intervening command fences the older worker result'
            );
            assert.equal((await runTick(db, { deadline: Date.now() + 500 })).processed, 0);
        } finally {
            if (service) await service.end();
            if (pool) await pool.end();
            assert.match(schema, /^icb_test_[a-f0-9]{32}$/);
            await admin.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
            await admin.end();
        }
    }
);
