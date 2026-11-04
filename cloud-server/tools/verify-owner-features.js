'use strict';
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const { request } = require('../../local-server/src/cloud/client');

/** Verify migrated DTOs through the real API using a short-lived admin verification session, without resetting a password. */
async function main() {
    const pool = adminDatabase();
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    try {
        const owner = (
            await pool.query('SELECT id FROM accounts WHERE login_name=lower($1)', [
                process.env.ICB_ACCOUNT_USERNAME || 'ijustababytv'
            ])
        ).rows[0];
        assert.ok(owner);
        await pool.query(
            "INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '2 minutes')",
            [hash, owner.id]
        );
        const paths = [
            'state',
            'settings',
            'live',
            'resource-trackers',
            'weekly',
            'todos',
            'giveaway/state',
            'giveaway/backups',
            'turnline',
            'poll',
            'poll/admin',
            'teams',
            'hunt',
            'countdowns',
            'paliaclock',
            'steam',
            'steam/admin',
            'aniimo/admin',
            'sprites/admin',
            'sprites/jar',
            'sprite-tv',
            'avatars/admin',
            'decor/state',
            'hub',
            'sashimi/admin',
            'beanburger-signup/admin',
            'flowtree-signup/admin',
            'party/admin',
            'eventtime',
            'newsticker/admin',
            'oceanfish',
            'streamframe',
            'neonchat',
            'randomizer',
            'tradeup/state',
            'tradeup/config'
        ].map((path) => '/api/' + path);
        const base = process.env.ICB_CLOUD_API_URL;
        let reply = await request(
            base,
            '/v1/features/state/read',
            'POST',
            { after: 0, paths },
            token
        );
        assert.equal(reply.status, 200, reply.data.code);
        const result = reply.data;
        let pages = 1;
        while (!reply.data.complete) {
            reply = await request(
                base,
                '/v1/features/state/read',
                'POST',
                { snapshot_token: result.snapshot_token, page: pages },
                token
            );
            assert.equal(reply.status, 200, reply.data.code);
            Object.assign(result.documents, reply.data.documents);
            Object.assign(result.views, reply.data.views);
            pages++;
        }
        assert.equal(Object.keys(result.authorities).length, 32);
        assert.ok(
            Object.values(result.authorities).every(
                (row) => row.mode === 'cloud' && row.protocol_version === 2
            )
        );
        assert.equal(Object.keys(result.views).length, paths.length);
        for (const [path, view] of Object.entries(result.views))
            assert.ok(!view.__status || view.__status === 200, path + ' returned ' + view.__status);
        const summaries = await request(base, '/v1/reports/days', 'GET', undefined, token);
        assert.equal(summaries.status, 200);
        console.info(
            JSON.stringify({
                migrated_owner_api_verified: true,
                features: 32,
                views: paths.length,
                pages,
                revision: result.revision,
                historical_report_days: summaries.data.days.length
            })
        );
    } finally {
        await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash]);
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error('Owner API verification failed: ' + error.message);
        process.exitCode = 1;
    });
