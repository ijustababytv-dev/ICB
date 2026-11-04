'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const { createOwner, removeOwner } = require('./smoke-owners');
const { request } = require('../../local-server/src/cloud/client');
const { gameFact } = require('../../local-server/src/domain/game-facts');
const { digest } = require('../src/features/contracts');

/** Exercise the deployed Gateway/ARM handler, immutable commands, SQL projections and aggregate traffic with disposable accounts. */
async function main() {
    const base = process.env.ICB_CLOUD_API_URL;
    assert.ok(base);
    const pool = adminDatabase();
    const owners = [];
    const measurements = [];
    let bytes = 0;
    const statuses = {};
    try {
        for (let n = 0; n < 2; n++) owners.push(await createOwner(pool));
        const tokens = [];
        for (const owner of owners) {
            const login = await request(base, '/v1/login', 'POST', {
                username: owner.username.toUpperCase(),
                password: owner.password
            });
            assert.equal(login.status, 200, login.data.code);
            tokens.push(login.data.token);
        }
        const call = async (path, method, body, who = 0) => {
            const start = Date.now();
            const result = await request(base, path, method, body, tokens[who]);
            measurements.push(Date.now() - start);
            bytes += Buffer.byteLength(JSON.stringify(result.data));
            statuses[result.status] = (statuses[result.status] || 0) + 1;
            return result;
        };

        const paths = [
            '/api/todos',
            '/api/giveaway/state',
            '/api/resource-trackers',
            '/api/weekly',
            '/api/turnline'
        ];
        const initial = await call('/v1/features/state/read', 'POST', { after: 0, paths });
        assert.equal(initial.status, 200, initial.data.code);
        assert.equal(Object.keys(initial.data.authorities).length, 32);
        const collector = randomUUID();
        assert.equal(
            (await call('/v1/collectors/claim', 'POST', { collector_id: collector })).status,
            200
        );
        const body = {
            protocol_version: 2,
            command_id: randomUUID(),
            expected_revision: initial.data.authorities.todos.revision,
            action: 'request',
            operands: {
                path: '/api/todos/daily',
                method: 'POST',
                values: { text: 'Smoke goal', target: 5, kind: 'goal' }
            },
            read_paths: ['/api/todos']
        };
        const command = await call('/v1/features/todos/commands', 'POST', body);
        assert.equal(command.status, 200, command.data.code);
        assert.equal(command.data.command_id, body.command_id);
        assert.equal(command.data.payload.todos.daily.length, 1);
        assert.equal(
            (await call('/v1/features/todos/commands', 'POST', body)).data.duplicate,
            true
        );
        assert.equal(
            (
                await call('/v1/features/todos/commands', 'POST', {
                    ...body,
                    command_id: randomUUID()
                })
            ).status,
            409
        );
        const changed = structuredClone(body);
        changed.operands.values.target = 99;
        assert.equal((await call('/v1/features/todos/commands', 'POST', changed)).status, 409);
        const other = await call(
            '/v1/features/state/read',
            'POST',
            { after: 0, paths: ['/api/todos'] },
            1
        );
        assert.equal(other.data.views['/api/todos'].todos.daily.length, 0);
        const privateInput = {
            ...body,
            command_id: randomUUID(),
            operands: { raw: 'PRIVATE_SMOKE_CHAT_WORDS' }
        };
        assert.equal((await call('/v1/features/todos/commands', 'POST', privateInput)).status, 400);
        let sequence = 0;
        const session = randomUUID();
        const now = new Date().toISOString();
        const envelope = (action, operands) => ({
            protocol_version: 2,
            command_id: randomUUID(),
            expected_revision: 0,
            action,
            collector_id: collector,
            operands: {
                sequence: ++sequence,
                source_key: randomUUID(),
                at: now,
                session_id: session,
                ...operands
            }
        });

        const start = envelope('collector_start', {});
        assert.equal((await call('/v1/features/live/commands', 'POST', start)).status, 200);
        const fact = envelope('game', {
            facts: [
                {
                    source_key: 'fixture:' + session + ':0',
                    at: now,
                    fact: gameFact('Inventory gained: itemtype_crop_apple (1*) x5')
                }
            ]
        });
        const game = await call('/v1/features/live/commands', 'POST', fact);
        assert.equal(game.status, 200, game.data.code);
        assert.equal(game.data.payload.accepted, 1);
        assert.equal((await call('/v1/features/live/commands', 'POST', fact)).data.duplicate, true);
        const steady = await call('/v1/features/state/read', 'POST', { after: 0, paths });
        const known_views = Object.fromEntries(
            Object.entries(steady.data.views).map(([path, value]) => {
                const copy = { ...value };
                delete copy.now;
                return [path, digest(copy)];
            })
        );
        // Four installations, staggered at two seconds each: 2 requests/s aggregate.
        const startLoad = Date.now();
        for (let n = 0; n < 24; n++) {
            const who = n % 2;
            const result = await call(
                '/v1/features/state/read',
                'POST',
                {
                    after: who ? other.data.revision : steady.data.revision,
                    paths,
                    known_views: who ? {} : known_views
                },
                who
            );
            assert.equal(result.status, 200, result.data.code);
            await new Promise((resolve) =>
                setTimeout(resolve, Math.max(0, startLoad + (n + 1) * 500 - Date.now()))
            );
        }
        // Gateway returns 429 at its bucket limit; Lambda's lower reserved concurrency can return an upstream 503 first.
        const burst = await Promise.all(
            Array.from({ length: 80 }, () =>
                call('/v1/features/state/read', 'POST', {
                    after: steady.data.revision,
                    paths: ['/api/todos']
                })
            )
        );
        assert.ok(
            burst.every((r) => [200, 429].includes(r.status) || (r.status === 503 && !r.data.code)),
            JSON.stringify(burst.map((r) => ({ status: r.status, code: r.data.code })))
        );
        assert.equal((await call('/v1/features/reports/commands', 'GET')).status, 200);
        const privacy = await pool.query(
            "SELECT count(*) AS n FROM feature_commands WHERE owner_id=ANY($1::uuid[]) AND result::text LIKE '%PRIVATE_SMOKE_CHAT_WORDS%'",
            [owners.map((o) => o.id)]
        );
        assert.equal(privacy.rows[0].n, '0');
        measurements.sort((a, b) => a - b);
        console.info(
            JSON.stringify({
                gateway_arm_express_postgres: true,
                owner_isolation: true,
                command_replay_stale_privacy_game: true,
                steady_installations: 4,
                requests: measurements.length,
                statuses,
                response_bytes: bytes,
                latency_ms: {
                    p50: measurements[Math.floor(measurements.length * 0.5)],
                    p95: measurements[Math.floor(measurements.length * 0.95)],
                    max: measurements.at(-1)
                }
            })
        );
    } finally {
        for (const owner of owners) await removeOwner(pool, owner);
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error('Feature smoke failed: ' + error.message);
        process.exitCode = 1;
    });
