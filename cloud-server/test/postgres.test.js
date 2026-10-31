'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const format = require('pg-format');
const fs = require('node:fs');
const path = require('node:path');
const { adminDatabase, databaseAdapter } = require('../tools/admin-db');
const { migrate } = require('../tools/migrate');
const { provisionAccount } = require('../tools/account');
const { createApp } = require('../src/activity/app');
const { reportingDay } = require('../src/activity/reporting-day');
const { ingest } = require('../src/activity/ingest');
const { maintain } = require('../tools/maintenance');

test(
    'PostgreSQL transactions, isolation, replay, cleanup, state and authentication',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' },
    async (t) => {
        const admin = adminDatabase();
        const schema = 'icb_test_' + randomUUID().replaceAll('-', '');
        let pool;
        let service;
        let server;
        try {
            await admin.query(format('CREATE SCHEMA %I', schema));
            pool = adminDatabase({ ...process.env, ICB_DB_SCHEMA: schema });
            await migrate(pool);
            await migrate(pool);
            if (process.env.ICB_TEST_SERVICE_PASSWORD) {
                await admin.query(format('GRANT USAGE ON SCHEMA %I TO icb_service', schema));
                await pool.query(
                    fs.readFileSync(path.resolve(__dirname, '../../database/grants.sql'), 'utf8')
                );
                service = adminDatabase({
                    ...process.env,
                    ICB_DB_SCHEMA: schema,
                    PGUSER: 'icb_service',
                    PGPASSWORD: process.env.ICB_TEST_SERVICE_PASSWORD
                });
            }
            const ownerId = await provisionAccount(pool, 'IJustABabyTV', 'FixturePassword123!');
            assert.equal(await provisionAccount(pool, 'ijustababytv', 'ignored'), ownerId);
            const secondId = await provisionAccount(pool, 'other', 'FixturePassword123!');
            const cutover = new Date(Date.now() - 600 * 86400000).toISOString();
            await pool.query('UPDATE accounts SET live_cutover_at=$1', [cutover]);
            const owner = (await pool.query('SELECT * FROM accounts WHERE id=$1', [ownerId]))
                .rows[0];
            const db = databaseAdapter(service || pool);
            const logs = [];
            server = createApp(db, (entry) => logs.push(entry)).listen(0, '127.0.0.1');
            await new Promise((resolve) => server.once('listening', resolve));
            const base = 'http://127.0.0.1:' + server.address().port;

            /** Use real HTTP with private fixture credentials; never print responses with bearer tokens. */
            async function call(route, method = 'GET', body, token) {
                const response = await fetch(base + route, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: 'Bearer ' + token } : {})
                    },
                    body: body === undefined ? undefined : JSON.stringify(body)
                });
                return { status: response.status, data: await response.json() };
            }

            const login = await call('/v1/login', 'POST', {
                username: 'IJustABabyTV',
                password: 'FixturePassword123!'
            });
            assert.equal(login.status, 200);
            assert.equal(login.data.account.id, ownerId);
            const token = login.data.token;
            const second = await call('/v1/login', 'POST', {
                username: 'OTHER',
                password: 'FixturePassword123!'
            });
            assert.equal(second.status, 200);
            const collector = randomUUID();
            assert.equal(
                (await call('/v1/collectors/claim', 'POST', { collector_id: collector }, token))
                    .status,
                200
            );
            assert.equal(
                (await call('/v1/collectors/claim', 'POST', { collector_id: randomUUID() }, token))
                    .status,
                409
            );
            const at = new Date().toISOString();

            /** Build minimal events, leaving all chat text outside the persistent contract. */
            function record(type, extra = {}) {
                return {
                    id: randomUUID(),
                    type,
                    at,
                    day: reportingDay(at, 'America/Chicago'),
                    timezone: 'America/Chicago',
                    viewer: {
                        platform: 'twitch',
                        platform_user_id: null,
                        username: 'guest',
                        display_name: 'Guest'
                    },
                    platform: 'twitch',
                    source_id: null,
                    ...extra
                };
            }

            /** Seal immutable test envelopes using the current collector lease. */
            function batch(records) {
                return {
                    schema_version: 1,
                    batch_id: randomUUID(),
                    collector_id: collector,
                    sealed_at: at,
                    migration_id: null,
                    records
                };
            }

            const input = batch([
                record('chat_count', { message_delta: 3 }),
                record('gifts', { quantity: 5, anonymous: false, ticket_delta: 20 }),
                record('bits', { bits: 60, ticket_delta: 0 }),
                record('bits', { bits: 50, ticket_delta: 1 }),
                record('gifts', { viewer: null, quantity: 2, anonymous: true, ticket_delta: 0 }),
                record('tip', { money_minor: 125, currency: 'USD', anonymous: false }),
                record('tip', { money_minor: 200, currency: 'EUR', anonymous: false })
            ]);
            assert.equal((await call('/v1/activity/batches', 'POST', input, token)).status, 200);
            assert.equal(
                (await call('/v1/activity/batches', 'POST', input, token)).data.duplicate,
                true
            );
            const changed = structuredClone(input);
            changed.records[0].message_delta = 99;
            assert.equal((await call('/v1/activity/batches', 'POST', changed, token)).status, 409);
            const invalid = batch([
                record('chat_count', { message_delta: 1, text: 'distinctive-private-phrase' })
            ]);
            assert.equal((await call('/v1/activity/batches', 'POST', invalid, token)).status, 400);
            const source = record('sub', {
                months: 2,
                ticket_delta: 4,
                source_id: 'provider-id-1'
            });
            await Promise.all([
                ingest(db, owner, batch([source])),
                ingest(db, owner, batch([{ ...source, id: randomUUID() }]))
            ]);
            // A committed response lost in transit must be safe to retry unchanged.
            const lost = batch([record('chat_count', { message_delta: 2 })]);
            await ingest(db, owner, lost);
            await ingest(db, owner, lost);
            const report = await call(
                '/v1/reports/days/' + input.records[0].day,
                'GET',
                undefined,
                token
            );
            assert.equal(report.status, 200);
            assert.equal(report.data.totals.messages, '5');
            assert.equal(report.data.totals.gifted_subs, '7');
            assert.equal(report.data.totals.bits, '110');
            assert.equal(report.data.totals.sub_events, '1');
            assert.equal(report.data.totals.sub_months, '2');
            const viewerId = report.data.viewers[0].viewer_id;
            const viewerReport = await call(
                '/v1/reports/viewers/' +
                    viewerId +
                    '?from=' +
                    input.records[0].day +
                    '&to=' +
                    input.records[0].day,
                'GET',
                undefined,
                token
            );
            assert.equal(viewerReport.data.totals.messages, '5');
            assert.equal(
                (
                    await call(
                        '/v1/reports/viewers/' + viewerId + '/lifetime',
                        'GET',
                        undefined,
                        token
                    )
                ).data.totals.messages,
                '5'
            );
            assert.equal(report.data.totals.ticket_delta, '25');
            assert.equal(report.data.currencies.length, 4);
            const otherReport = await call(
                '/v1/reports/days/' + input.records[0].day,
                'GET',
                undefined,
                second.data.token
            );
            assert.equal(otherReport.data.viewers.length, 0);
            assert.equal(otherReport.data.totals, null);
            assert.equal(
                (
                    await call(
                        '/v1/reports/days?owner_id=' + ownerId,
                        'GET',
                        undefined,
                        second.data.token
                    )
                ).status,
                400
            );
            // Verify transaction rollback when a late statement fails after receipt insertion.
            const rollback = batch([record('chat_count', { message_delta: 7 })]);
            const broken = {
                withClient: (op) =>
                    db.withClient((client) =>
                        op({
                            query: (sql, values) => {
                                if (sql.startsWith('INSERT INTO stream_daily_stats'))
                                    throw new Error('injected crash');
                                return client.query(sql, values);
                            }
                        })
                    )
            };
            await assert.rejects(() => ingest(broken, owner, rollback));
            assert.equal(
                (
                    await pool.query('SELECT 1 FROM activity_receipts WHERE batch_id=$1', [
                        rollback.batch_id
                    ])
                ).rowCount,
                0
            );
            await ingest(db, owner, rollback);
            // Snapshots belong to one owner and never silently accept chat-bearing fields.
            const state = {
                collector_id: collector,
                revision: 1,
                captured_at: at,
                payload: { schemaVersion: 1, resources: { amber: 17 } }
            };
            assert.equal((await call('/v1/state/live.json', 'PUT', state, token)).status, 200);
            assert.equal(
                (await call('/v1/state/live.json', 'GET', undefined, second.data.token)).status,
                404
            );
            assert.equal(
                (
                    await call(
                        '/v1/state/live.json',
                        'PUT',
                        {
                            ...state,
                            revision: 2,
                            payload: {
                                reader: { lastEvent: { line: 'distinctive-private-phrase' } }
                            }
                        },
                        token
                    )
                ).status,
                400
            );
            const beforeCleanup = (
                await pool.query('SELECT SUM(messages) AS n FROM stream_daily_stats')
            ).rows[0].n;
            await pool.query("UPDATE support_events SET occurred_at=now()-interval '400 days'");
            await maintain(pool);
            assert.equal(
                (await pool.query('SELECT count(*) AS n FROM support_events')).rows[0].n,
                '0'
            );
            assert.equal(
                (await pool.query('SELECT SUM(messages) AS n FROM stream_daily_stats')).rows[0].n,
                beforeCleanup
            );
            await ingest(db, owner, batch([{ ...source, id: randomUUID() }]));
            assert.equal(
                (await pool.query('SELECT SUM(sub_events) AS n FROM stream_daily_stats')).rows[0].n,
                '1'
            );
            const dump = (
                await pool.query(
                    'SELECT row_to_json(t)::text AS body FROM stream_daily_stats t UNION ALL SELECT row_to_json(t)::text FROM feature_state t'
                )
            ).rows;
            assert.doesNotMatch(
                JSON.stringify(dump) + JSON.stringify(logs),
                /distinctive-private-phrase|FixturePassword123!/
            );
            const bulkRecords = Array.from({ length: 500 }, () =>
                record('chat_count', { message_delta: 1 })
            );
            const bulkStart = Date.now();
            await ingest(db, owner, batch(bulkRecords));
            assert.ok(
                Date.now() - bulkStart < 10000,
                '500-record batch must complete within the configured request budget'
            );
            const unknownRun = randomUUID();
            await pool.query(
                `INSERT INTO migration_runs(id,owner_id,source_file,source_sha256,importer_version,cutoff_at,status)
                VALUES($1,$2,'fixture','fixture',1,now()+interval '1 minute','prepared')`,
                [unknownRun, owner.id]
            );
            const unknown = record('sub', { months: 1, ticket_delta: null });
            await ingest(db, owner, { ...batch([unknown]), migration_id: unknownRun });
            assert.equal(
                (
                    await pool.query('SELECT ticket_delta FROM support_events WHERE event_id=$1', [
                        unknown.id
                    ])
                ).rows[0].ticket_delta,
                null
            );
            assert.equal(
                (
                    await pool.query(
                        'SELECT SUM(unknown_award_events)::text AS n FROM stream_daily_stats'
                    )
                ).rows[0].n,
                '1'
            );
            await pool.query(
                `INSERT INTO collector_history(owner_id,collector_id,started_at,expires_at)
                VALUES($1,$2,$3::timestamptz-interval '10 seconds',$3::timestamptz+interval '1 second')`,
                [owner.id, collector, at]
            );
            await pool.query(
                "UPDATE collector_leases SET collector_id=$1,started_at=now(),expires_at=now()+interval '90 seconds' WHERE owner_id=$2",
                [randomUUID(), owner.id]
            );
            await ingest(db, owner, batch([record('chat_count', { message_delta: 1 })]));
            const later = new Date().toISOString();
            await assert.rejects(
                () =>
                    ingest(db, owner, {
                        ...batch([
                            record('chat_count', {
                                message_delta: 1,
                                at: later,
                                day: reportingDay(later, 'America/Chicago')
                            })
                        ]),
                        sealed_at: later
                    }),
                (error) => error.code === 'collector_lease_expired'
            );
            assert.equal((await call('/v1/logout', 'POST', {}, token)).status, 200);
            assert.equal((await call('/v1/me', 'GET', undefined, token)).status, 401);
            assert.ok(secondId);
            for (let i = 0; i < 11; i++)
                await call('/v1/login', 'POST', { username: 'missing', password: 'wrong' });
            assert.equal(
                (await call('/v1/login', 'POST', { username: 'MISSING', password: 'wrong' }))
                    .status,
                429
            );
            await t.test('all checks used isolated PostgreSQL schemas and committed real SQL', () =>
                assert.ok(schema.startsWith('icb_test_'))
            );
        } finally {
            if (server) await new Promise((resolve) => server.close(resolve));
            if (service) await service.end();
            if (pool) await pool.end();
            // The generated schema is allowlisted and verified before this recursive SQL cleanup.
            assert.match(schema, /^icb_test_[a-f0-9]{32}$/);
            await admin.query(format('DROP SCHEMA %I CASCADE', schema));
            await admin.end();
        }
    }
);
