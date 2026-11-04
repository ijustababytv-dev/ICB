'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase, databaseAdapter } = require('../tools/admin-db');
const { createSchema } = require('../tools/schema');
const { provisionAccount } = require('../tools/account');
const { importFeature, executeCommand } = require('../src/features/commands');
const { stateFeed } = require('../src/features/feed');
const repository = require('../src/features/repository');

test(
    'PostgreSQL preserves check-in across commands, same-window re-entry and setting changes without duplicate tickets',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' },
    async () => {
        const admin = adminDatabase();
        const schema = 'icb_test_checkin_' + randomUUID().replaceAll('-', '');
        let pool;
        try {
            await admin.query(format('CREATE SCHEMA %I', schema));
            pool = adminDatabase({ ...process.env, ICB_DB_SCHEMA: schema });
            await createSchema(pool);
            const id = await provisionAccount(pool, 'CheckInFixture', 'FixturePassword123!');
            const owner = { id, reporting_timezone: 'America/Chicago' };
            const db = databaseAdapter(pool);
            const collector = randomUUID();
            await pool.query(
                "INSERT INTO collector_leases(owner_id,collector_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
                [id, collector]
            );
            const payload = {};
            await importFeature(db, owner, 'giveaway', {
                command_id: randomUUID(),
                collector_id: collector,
                payload,
                source_sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
                input_watermark: 'checkin-fixture'
            });
            /** Use current confirmed revisions, exactly as a real operator request does. */
            async function command(path, values) {
                const authority = (await repository.authorities(pool, id)).get('giveaway');
                return executeCommand(db, owner, 'giveaway', {
                    protocol_version: 2,
                    command_id: randomUUID(),
                    expected_revision: authority.revision,
                    action: 'request',
                    operands: { path, method: 'POST', values }
                });
            }

            let sequence = 0;
            /** The same viewer/window can be delivered again after a reset; SQL still deduplicates awards. */
            async function chat() {
                return executeCommand(db, owner, 'giveaway', {
                    protocol_version: 2,
                    command_id: randomUUID(),
                    collector_id: collector,
                    expected_revision: 0,
                    action: 'intent',
                    operands: {
                        kind: 'presence',
                        sender: 'Guest',
                        at: new Date().toISOString(),
                        sequence: ++sequence,
                        source_key: 'checkin:' + randomUUID()
                    }
                });
            }

            /** Read a newly hydrated cloud view from SQL rather than a retained context. */
            async function view() {
                return (await stateFeed(db, owner, { after: 0, paths: ['/api/giveaway/state'] }))
                    .views['/api/giveaway/state'].giveaway;
            }

            await command('/api/giveaway/manual', { username: 'Guest', amount: 7 });
            await command('/api/giveaway/manual', { username: 'Absent', amount: 30 });
            assert.equal((await view()).pool.total, 0);
            await chat();
            assert.deepEqual((await view()).pool.counts, { Guest: 7 });
            await command('/api/giveaway/jar/empty', {});
            assert.equal((await view()).pool.total, 0);
            await chat();
            assert.deepEqual((await view()).pool.counts, { Guest: 7 });
            const presence = await pool.query(
                'SELECT count(*) AS n FROM chat_window_presence WHERE owner_id=$1',
                [id]
            );
            assert.equal(presence.rows[0].n, '1');
            const draw = await command('/api/giveaway/draw', { prize: 'plushie' });
            assert.equal(draw.payload.winner.username, 'Guest');
            await command('/api/giveaway/checkin', { required: false });
            assert.equal((await view()).pool.total, 37);
            const settings = await pool.query(
                "SELECT settings FROM owner_settings WHERE owner_id=$1 AND feature='giveaway'",
                [id]
            );
            assert.equal(settings.rows[0].settings.checkInRequired, false);
            assert.equal(settings.rows[0].settings.checkIn, undefined);
            const metadata = await pool.query(
                "SELECT metadata FROM feature_metadata WHERE owner_id=$1 AND feature='giveaway'",
                [id]
            );
            assert.equal(metadata.rows[0].metadata.checkIn.users.guest, true);
            assert.equal(metadata.rows[0].metadata.checkInRequired, undefined);
            const entrant = await pool.query(
                "SELECT details FROM giveaway_entrants WHERE owner_id=$1 AND name_key='Guest'",
                [id]
            );
            assert.equal(entrant.rows[0].details.counts.chatWindows, 0);
        } finally {
            if (pool) await pool.end();
            await admin.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
            await admin.end();
        }
    }
);
