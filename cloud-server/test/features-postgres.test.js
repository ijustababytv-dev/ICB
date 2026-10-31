'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase, databaseAdapter } = require('../tools/admin-db');
const { createSchema, applyGrants } = require('../tools/schema');
const { provisionAccount } = require('../tools/account');
const { importFeature, executeCommand } = require('../src/features/commands');
const { stateFeed } = require('../src/features/feed');

test(
    'feature commands persist typed rows, retry once, reject stale writes and isolate owners in PostgreSQL',
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
            const db = databaseAdapter(service || pool);
            const first = await provisionAccount(pool, 'FeatureOwner', 'FixturePassword123!');
            const other = await provisionAccount(pool, 'FeatureOther', 'FixturePassword123!');
            const owner = { id: first, reporting_timezone: 'America/Chicago' };
            const collector = randomUUID();
            await pool.query(
                "INSERT INTO collector_leases(owner_id,collector_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
                [first, collector]
            );
            const payload = { schemaVersion: 1, daily: [], weekly: [], updatedAt: null };
            const input = {
                command_id: randomUUID(),
                collector_id: collector,
                source_sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
                input_watermark: 'fixture:empty',
                payload
            };
            const imported = await importFeature(db, owner, 'todos', input);
            assert.equal((await importFeature(db, owner, 'todos', input)).duplicate, true);
            await assert.rejects(
                () =>
                    importFeature(db, owner, 'todos', { ...input, source_sha256: 'a'.repeat(64) }),
                /feature_already_migrated/
            );
            const command = {
                protocol_version: 2,
                command_id: randomUUID(),
                expected_revision: imported.revision,
                action: 'request',
                operands: {
                    path: '/api/todos/daily',
                    method: 'POST',
                    values: { text: 'Fixture goal', kind: 'goal', target: 10 }
                }
            };
            const result = await executeCommand(db, owner, 'todos', command);
            assert.equal(result.payload.todos.daily.length, 1);
            assert.equal((await executeCommand(db, owner, 'todos', command)).duplicate, true);
            assert.equal(
                (await pool.query('SELECT count(*) AS n FROM todos WHERE owner_id=$1', [first]))
                    .rows[0].n,
                '1'
            );
            const changed = structuredClone(command);
            changed.operands.values.target = 99;
            await assert.rejects(
                () => executeCommand(db, owner, 'todos', changed),
                /command_content_changed/
            );
            await assert.rejects(
                () => executeCommand(db, owner, 'todos', { ...command, command_id: randomUUID() }),
                /stale_feature_revision/
            );
            const feed = await stateFeed(db, owner, { after: 0, paths: ['/api/todos'] });
            assert.equal(feed.views['/api/todos'].todos.daily[0].target, 10);
            assert.equal(feed.documents['todos.json'].daily.length, 1);
            const otherFeed = await stateFeed(
                db,
                { id: other, reporting_timezone: 'America/Chicago' },
                { after: 0, paths: ['/api/todos'] }
            );
            assert.deepEqual(otherFeed.documents, {});
            assert.deepEqual(otherFeed.views, {});
            const id = feed.documents['todos.json'].daily[0].id;
            const update = {
                ...command,
                expected_revision: result.feature_revision,
                operands: { path: '/api/todos/daily/' + id, method: 'PATCH', values: { delta: 1 } }
            };
            const outcomes = await Promise.allSettled(
                [1, 2].map(() =>
                    executeCommand(db, owner, 'todos', { ...update, command_id: randomUUID() })
                )
            );
            assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
            assert.equal(
                (await pool.query('SELECT current FROM todos WHERE owner_id=$1', [first])).rows[0]
                    .current,
                '1'
            );
            assert.equal(
                (
                    await pool.query(
                        'SELECT count(*) AS n FROM feature_commands WHERE owner_id=$1',
                        [first]
                    )
                ).rows[0].n,
                '2'
            );
            const giveawayImport = await importFeature(db, owner, 'giveaway', {
                ...input,
                command_id: randomUUID(),
                payload: {},
                source_sha256: 'b'.repeat(64)
            });
            let sequence = 0;
            /** Each input retry retains its exact command and upstream identity. */
            function support(bits, source) {
                return {
                    protocol_version: 2,
                    command_id: randomUUID(),
                    expected_revision: giveawayImport.revision,
                    action: 'intent',
                    collector_id: collector,
                    operands: {
                        sequence: ++sequence,
                        source_key: source,
                        at: new Date().toISOString(),
                        kind: 'support',
                        sender: 'Guest',
                        support: { type: 'bits', bits }
                    }
                };
            }

            const cheer = support(60, 'fixture:cheer-one');
            await executeCommand(db, owner, 'giveaway', cheer);
            assert.equal((await executeCommand(db, owner, 'giveaway', cheer)).duplicate, true);
            const replay = support(60, 'fixture:cheer-one');
            assert.equal((await executeCommand(db, owner, 'giveaway', replay)).duplicate, true);
            await executeCommand(db, owner, 'giveaway', support(50, 'fixture:cheer-two'));
            const totals = await pool.query(
                'SELECT bits,tickets FROM giveaway_entrants WHERE owner_id=$1',
                [first]
            );
            assert.equal(totals.rows[0].bits, '110');
            assert.equal(totals.rows[0].tickets, '1');
            const reported = await pool.query(
                'SELECT sum(bits) AS bits,sum(ticket_delta) AS tickets FROM stream_daily_stats WHERE owner_id=$1',
                [first]
            );
            assert.equal(reported.rows[0].bits, '110');
            assert.equal(reported.rows[0].tickets, '1');
            const gap = support(100, 'fixture:gap');
            gap.operands.sequence++;
            await assert.rejects(
                () => executeCommand(db, owner, 'giveaway', gap),
                /collector_sequence_gap/
            );
            assert.equal(
                (await pool.query('SELECT bits FROM giveaway_entrants WHERE owner_id=$1', [first]))
                    .rows[0].bits,
                '110'
            );
        } finally {
            if (service) await service.end();
            if (pool) await pool.end();
            assert.match(schema, /^icb_test_[a-f0-9]{32}$/);
            await admin.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
            await admin.end();
        }
    }
);
