'use strict';
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const { provisionAccount } = require('./account');
const { request } = require('../../local-server/src/cloud/client');
const { reportingDay } = require('../src/activity/reporting-day');

/** Verify Gateway -> ARM Web Adapter -> Express -> limited-role RDS with disposable accounts only. */
async function main() {
    const base = process.env.ICB_CLOUD_API_URL;
    if (!base) throw new Error('API URL required.');
    const pool = adminDatabase();
    const ids = [];
    const names = [];
    const password = randomBytes(24).toString('hex');
    try {
        assert.equal((await request(base, '/healthz')).status, 200);
        assert.equal((await request(base, '/v1/me')).status, 401);
        for (let i = 0; i < 2; i++) {
            const name = 'icb_smoke_' + randomBytes(6).toString('hex');
            names.push(name);
            ids.push(await provisionAccount(pool, name, password));
        }
        await pool.query(
            'UPDATE accounts SET live_cutover_at=now()-$1::interval WHERE id=ANY($2::uuid[])',
            ['1 minute', ids]
        );
        const start = Date.now();
        const login = await request(base, '/v1/login', 'POST', {
            username: names[0].toUpperCase(),
            password
        });
        assert.equal(login.status, 200, login.data.code);
        const loginMs = Date.now() - start;
        const token = login.data.token;
        assert.equal(
            (await request(base, '/v1/me', 'GET', undefined, token)).data.account.id,
            ids[0]
        );
        const collector = randomUUID();
        assert.equal(
            (
                await request(
                    base,
                    '/v1/collectors/claim',
                    'POST',
                    { collector_id: collector },
                    token
                )
            ).status,
            200
        );
        const at = new Date().toISOString();
        const common = {
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
            source_id: null
        };
        const records = Array.from({ length: 496 }, () => ({
            ...common,
            id: randomUUID(),
            type: 'chat_count',
            message_delta: 1
        }));
        records.push(
            {
                ...common,
                id: randomUUID(),
                type: 'gifts',
                quantity: 3,
                anonymous: false,
                ticket_delta: 12
            },
            { ...common, id: randomUUID(), type: 'bits', bits: 60, ticket_delta: 0 },
            { ...common, id: randomUUID(), type: 'bits', bits: 50, ticket_delta: 1 },
            {
                ...common,
                id: randomUUID(),
                type: 'gifts',
                viewer: null,
                quantity: 2,
                anonymous: true,
                ticket_delta: 0
            }
        );
        const batch = {
            schema_version: 1,
            batch_id: randomUUID(),
            collector_id: collector,
            sealed_at: at,
            migration_id: null,
            records
        };
        const before = Date.now();
        const ingested = await request(base, '/v1/activity/batches', 'POST', batch, token);
        assert.equal(ingested.status, 200, ingested.data.code);
        const ingestMs = Date.now() - before;
        assert.equal(
            (await request(base, '/v1/activity/batches', 'POST', batch, token)).data.duplicate,
            true
        );
        const report = await request(
            base,
            '/v1/reports/days/' + common.day,
            'GET',
            undefined,
            token
        );
        assert.equal(report.status, 200);
        assert.equal(report.data.totals.messages, '496');
        assert.equal(report.data.totals.gifted_subs, '5');
        assert.equal(report.data.totals.bits, '110');
        const second = await request(base, '/v1/login', 'POST', { username: names[1], password });
        assert.equal(
            (
                await request(
                    base,
                    '/v1/reports/days/' + common.day,
                    'GET',
                    undefined,
                    second.data.token
                )
            ).data.totals,
            null
        );
        const invalid = {
            ...batch,
            batch_id: randomUUID(),
            records: [{ ...records[0], text: 'distinctive-private-phrase' }]
        };
        assert.equal(
            (await request(base, '/v1/activity/batches', 'POST', invalid, token)).status,
            400
        );
        assert.equal((await request(base, '/v1/logout', 'POST', {}, token)).status, 200);
        assert.equal((await request(base, '/v1/me', 'GET', undefined, token)).status, 401);
        console.info(
            JSON.stringify({
                gateway_adapter_express_rds: true,
                case_insensitive_login: true,
                owner_isolation: true,
                committed_retry_safe: true,
                body_text_rejected: true,
                records: 500,
                login_ms: loginMs,
                ingest_ms: ingestMs
            })
        );
    } finally {
        // Only accounts created by this invocation may be removed; no real owner's rows are touched.
        for (let i = 0; i < ids.length; i++) {
            assert.match(names[i], /^icb_smoke_[a-f0-9]{12}$/);
            for (const table of [
                'feature_state',
                'state_import_runs',
                'daily_summary_quality',
                'support_currency_daily',
                'viewer_daily_stats',
                'stream_daily_stats',
                'support_events',
                'giveaway_audit_events',
                'activity_event_receipts',
                'source_event_receipts',
                'activity_receipts',
                'migration_runs',
                'viewers',
                'collector_history',
                'collector_leases',
                'sessions'
            ])
                await pool.query('DELETE FROM ' + table + ' WHERE owner_id=$1', [ids[i]]);
            await pool.query('DELETE FROM accounts WHERE id=$1 AND login_name=$2', [
                ids[i],
                names[i]
            ]);
        }
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error('Deployed API smoke failed: ' + (error.code || error.message));
        process.exitCode = 1;
    });
