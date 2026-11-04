'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-retry-'));
process.env.ICB_CLEAN_DATA_DIR = directory;
const session = require('../../src/cloud/session');
const collector = require('../../src/activity/collector');
const feed = require('../../src/cloud/state-feed');

test('429 and upstream 503 retain the same ordered feature input, back off and acknowledge only its committed UUID', async (t) => {
    const owner = randomUUID();
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.method(session, 'current', () => ({
        account: { id: owner, timezone: 'America/Chicago' }
    }));
    t.mock.method(feed, 'publish', () => {});
    const attempts = [];
    let calls = 0;
    t.mock.method(session, 'call', async (route, _method, body) => {
        calls++;
        if (route.endsWith('/claim'))
            return {
                status: 200,
                data: { expires_at: new Date(Date.now() + 90000).toISOString() }
            };
        attempts.push(structuredClone(body));
        return attempts.length < 3
            ? { status: attempts.length === 1 ? 429 : 503, data: {} }
            : { status: 200, data: { command_id: body.command_id } };
    });
    try {
        const id = collector.queue().enqueueFeature(owner, 'live', 'collector_start', {
            sequence: 1,
            source_key: 'fixture-start',
            at: new Date().toISOString(),
            session_id: randomUUID()
        });
        await collector.sync();
        assert.equal(collector.queue().get().pending.length, 1);
        const before = calls;
        await collector.sync();
        assert.equal(calls, before, 'Backoff prevents an immediate retry storm.');
        t.mock.timers.tick(65000);
        await collector.sync();
        assert.equal(collector.queue().get().pending.length, 1);
        assert.equal(collector.queue().get().quarantine.length, 0);
        t.mock.timers.tick(65000);
        await collector.sync();
        assert.equal(collector.queue().get().pending.length, 0);
        assert.equal(attempts.length, 3);
        assert.ok(attempts.every((body) => body.command_id === id && body.operands.sequence === 1));
        assert.deepEqual(attempts[0], attempts[2]);
    } finally {
        assert.ok(directory.startsWith(path.join(os.tmpdir(), 'icb-retry-')));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
