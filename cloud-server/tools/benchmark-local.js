'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { adminDatabase } = require('./admin-db');
const { createOwner, removeOwner } = require('./smoke-owners');
const root = path.resolve(__dirname, '../..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Compare the prior committed bridge and current source using separate temp state and disposable cloud owners. */
async function measure(source, label, pool) {
    const owner = await createOwner(pool);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-performance-'));
    const log = path.join(temp, 'app-fixture.log');
    fs.writeFileSync(log, 'old history\n');
    const child = spawn(
        process.execPath,
        [
            '--require',
            path.join(root, 'local-server/test/helpers/performance-probe.js'),
            path.join(source, 'local-server/src/index.js')
        ],
        {
            cwd: source,
            env: {
                ...process.env,
                ICB_CLEAN_PORT: '8791',
                ICB_CLEAN_DATA_DIR: temp,
                ICB_CLEAN_PALIA_LOG_FILE: log
            },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        }
    );
    let errors = '';
    child.stderr.on('data', (bytes) => {
        errors = (errors + bytes.toString()).slice(-2000);
    });
    const base = 'http://127.0.0.1:8791';
    let csrf;
    const revisions = {};
    const json = async (route, method = 'GET', body) => {
        const response = await fetch(base + route, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Origin: base,
                'X-ICB-CSRF': csrf || '',
                'X-ICB-Revisions': JSON.stringify(revisions)
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        Object.assign(revisions, JSON.parse(response.headers.get('X-ICB-Revisions') || '{}'));
        return { status: response.status, data: await response.json() };
    };

    try {
        let ready = false;
        for (let n = 0; n < 100; n++) {
            try {
                if ((await json('/api/health')).status === 200) {
                    ready = true;
                    break;
                }
            } catch (_) {}
            await pause(100);
        }
        assert.ok(ready, 'Isolated server did not start: ' + errors);
        csrf = (
            await (
                await fetch(base + '/api/cloud/csrf', {
                    headers: { Referer: base + '/cloud.html' }
                })
            ).json()
        ).csrf;
        const login = await json('/api/cloud/login', 'POST', {
            username: owner.username,
            password: owner.password
        });
        assert.equal(login.status, 200, label + ': cloud login failed');
        await json('/api/state');
        assert.equal(
            (await json('/api/live/reconcile', 'PUT', { amber: 1, essence: 1, sweetLeaf: 1 }))
                .status,
            200
        );
        await pause(3000);
        child.send('measure-start');
        await once(child, 'message');
        let chats = 0;
        let reads = 0;
        const failures = {};
        const started = Date.now();
        for (let tick = 0; tick < 30; tick++) {
            fs.appendFileSync(
                log,
                Array.from(
                    { length: 10 },
                    () => 'Inventory gained: itemtype_currency_echo_amber x1\n'
                ).join('')
            );
            const work = [];
            for (let n = 0; n < 20; n++) {
                const text = n === 0 && tick % 5 === 0 ? '!turn' : 'Transient fixture chat';
                work.push(
                    json('/api/activity/chat', 'POST', {
                        platform: 'twitch',
                        source_id: label + ':' + tick + ':' + n,
                        data: { sender: 'Fixture' + n, text, parts: [{ t: 'text', v: text }] }
                    }).then((r) => {
                        chats++;
                        if (r.status !== 200) failures[r.status] = (failures[r.status] || 0) + 1;
                    })
                );
            }
            if (tick % 2 === 0)
                for (let n = 0; n < 20; n++)
                    work.push(
                        json(
                            [
                                '/api/resource-trackers',
                                '/api/weekly',
                                '/api/giveaway/state',
                                '/api/turnline'
                            ][n % 4]
                        ).then((r) => {
                            reads++;
                            if (r.status !== 200)
                                failures[r.status] = (failures[r.status] || 0) + 1;
                        })
                    );
            await Promise.all(work);
            await pause(Math.max(0, started + (tick + 1) * 1000 - Date.now()));
        }
        child.send('measure-stop');
        const [metrics] = await once(child, 'message');
        let final;
        for (let retry = 0; retry < 15; retry++) {
            await pause(1000);
            final = await json('/api/state');
            if (final.data.live.resources.amber === 301) break;
        }
        assert.equal(
            final.data.live.resources.amber,
            301,
            label + ': game facts did not drain exactly once'
        );
        return {
            source: label,
            chats,
            overlay_reads: reads,
            verified_game_total: 301,
            failures,
            ...metrics
        };
    } finally {
        if (child.exitCode === null) {
            child.kill();
            await once(child, 'exit');
        }
        await removeOwner(pool, owner);
        assert.ok(temp.startsWith(path.join(os.tmpdir(), 'icb-performance-')));
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

/** Requires an explicit archived source root under ignored backups; never starts port 8790. */
async function main() {
    const previous = path.resolve(process.argv[2] || '');
    assert.ok(previous.startsWith(path.join(root, 'backups') + path.sep));
    assert.ok(fs.existsSync(path.join(previous, 'local-server/src/index.js')));
    const pool = adminDatabase();
    try {
        const results = [];
        results.push(await measure(previous, 'before', pool));
        results.push(await measure(root, 'after', pool));
        console.info(
            JSON.stringify(
                {
                    workload:
                        '30s, 20 chat messages/s, 10 normalized game facts/s, 20 overlay polls/2s; isolated 8791; real cloud requests',
                    results
                },
                null,
                2
            )
        );
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error('Local benchmark failed: ' + error.message);
        process.exitCode = 1;
    });
