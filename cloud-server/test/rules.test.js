'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { reportingDay } = require('../src/activity/reporting-day');
const { hashPassword, verifyPassword } = require('../src/activity/passwords');
const validation = require('../src/activity/validation');
const { deltas } = require('../src/activity/summaries');
const { canonical } = require('../src/activity/ingest');
const { createApp } = require('../src/activity/app');
const { validatePayload } = require('../src/activity/feature-state');

test('accounts are canonicalized identically for provisioning and mixed-case login', () => {
    assert.equal(validation.loginName(' IJustABabyTV '), 'ijustababytv');
    assert.throws(() => validation.loginName('bad user'));
});

test('salted scrypt verifies passwords with explicit work factors', async () => {
    const start = Date.now();
    const stored = await hashPassword('FixturePassword123!');
    const account = {
        password_salt: stored.salt,
        password_hash: stored.hash,
        scrypt_n: stored.n,
        scrypt_r: stored.r,
        scrypt_p: stored.p
    };
    assert.equal(await verifyPassword('FixturePassword123!', account), true);
    assert.equal(await verifyPassword('wrong', account), false);
    assert.equal(await verifyPassword('anything', null), false);
    assert.notEqual((await hashPassword('FixturePassword123!')).salt, stored.salt);
    assert.ok(Date.now() - start < 10000);
});

for (const [at, expected] of [
    ['2026-03-08T10:59:59Z', '2026-03-07'],
    ['2026-03-08T11:00:00Z', '2026-03-08'],
    ['2026-11-01T11:59:59Z', '2026-10-31'],
    ['2026-11-01T12:00:00Z', '2026-11-01'],
    ['2026-11-01T06:30:00Z', '2026-10-31'],
    ['2026-11-01T07:30:00Z', '2026-10-31']
])
    test('six-AM Chicago reporting boundary ' + at, () =>
        assert.equal(reportingDay(at, 'America/Chicago'), expected)
    );

test('minimal records reject text, raw metadata, owner overrides, invalid dates and overflowing amounts', () => {
    const at = new Date().toISOString();
    const record = {
        id: randomUUID(),
        type: 'chat_count',
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
        message_delta: 1
    };
    assert.equal(validation.record(record, 'America/Chicago'), record);
    for (const extra of [
        { text: 'distinctive-private-phrase' },
        { raw: {} },
        { owner_id: randomUUID() },
        { message_delta: Number.MAX_SAFE_INTEGER + 1 }
    ])
        assert.throws(() => validation.record({ ...record, ...extra }, 'America/Chicago'));
    assert.throws(() => validation.day('2026-02-30'));
    assert.equal(deltas({ type: 'gifts', quantity: 5, ticket_delta: 20 }).sub_months, 0);
    assert.equal(deltas({ type: 'gifts', quantity: 5, ticket_delta: 20 }).gifted_subs, 5);
    assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
    assert.throws(() => validatePayload({ reader: { lastEvent: { line: 'private' } } }));
    assert.throws(() => validatePayload({ password: 'private' }));
});

test('Express health, middleware order, JSON bounds and safe errors use actual loopback HTTP', async (t) => {
    const logs = [];
    const app = createApp(
        {
            withClient: async () => {
                throw new Error('private SQL parameters');
            }
        },
        (entry) => logs.push(entry)
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/v1/reports/days')).status, 401);
    assert.equal((await fetch(base + '/missing')).status, 404);
    const invalid = await fetch(base + '/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
    });
    assert.equal(invalid.status, 400);
    const large = await fetch(base + '/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'x'.repeat(270000) })
    });
    assert.equal(large.status, 413);
    const failed = await fetch(base + '/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'guest', password: 'distinctive-private-phrase' })
    });
    assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /private SQL|parameters/);
    assert.doesNotMatch(JSON.stringify(logs), /distinctive-private-phrase|password|authorization/);
});
