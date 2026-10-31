'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { normalizeSupport, minorUnits } = require('../../src/domain/support-normalize');
const { envelope } = require('../../src/domain/activity-normalize');
const { reportingDay } = require('../../src/domain/reporting-day');
const { createOutbox } = require('../../src/activity/outbox');
const { request } = require('../../src/cloud/client');
const https = require('node:https');
const { EventEmitter } = require('node:events');

test('cloud proxies preserve the named API stage and report query parameters over HTTPS', async (t) => {
    const original = https.request;
    t.after(() => {
        https.request = original;
    });
    let captured;
    https.request = (url, _options, callback) => {
        captured = url;
        const req = new EventEmitter();
        req.end = () => {
            const res = new EventEmitter();
            res.statusCode = 200;
            callback(res);
            res.emit('data', Buffer.from('{"ok":true}'));
            res.emit('end');
        };

        return req;
    };

    const result = await request(
        'https://example.com/baby-icb-api',
        '/v1/reports/days?from=2026-10-01&to=2026-10-31'
    );
    assert.equal(result.status, 200);
    assert.equal(captured.hostname, 'example.com');
    assert.equal(captured.pathname, '/baby-icb-api/v1/reports/days');
    assert.equal(captured.searchParams.get('from'), '2026-10-01');
    await assert.rejects(() => request('http://example.com', '/v1/me'), /invalid_cloud_url/);
});

test('support normalization keeps gifts distinct, anonymity, purchased months and actual ticket deltas', () => {
    const gift = normalizeSupport({
        type: 'gifts',
        username: 'Guest',
        count: 5,
        tier: 'TIER_1',
        recipients: ['private'],
        raw: 'private',
        unicorns: 20
    });
    assert.equal(gift.quantity, 5);
    assert.equal(gift.ticket_delta, 20);
    assert.equal(gift.months, undefined);
    assert.doesNotMatch(JSON.stringify(gift), /private|recipients|raw/);
    assert.equal(normalizeSupport({ type: 'gifts', anonymous: true, count: 2 }).viewer, null);
    assert.equal(
        normalizeSupport({ type: 'sub', username: 'Guest', months: 2, cumulative_months: 99 })
            .months,
        2
    );
    assert.equal(normalizeSupport({ type: 'sub', username: 'Guest', months: 99 }), null);
    assert.equal(normalizeSupport({ type: 'viewer_list', users: ['private'] }), null);
});

test('money preserves currencies and integer precision; ambiguous amounts are never invented as zero', () => {
    assert.equal(minorUnits('12.34', 'USD'), 1234);
    assert.equal(minorUnits('123', 'JPY'), 123);
    assert.equal(minorUnits('1.234', 'KWD'), 1234);
    assert.equal(minorUnits('1.234', 'USD'), null);
    assert.equal(minorUnits('5', 'UNK'), null);
    assert.equal(
        normalizeSupport({
            type: 'tip',
            username: 'Guest',
            amount: '1.25',
            currency: 'USD',
            count: 2
        }).money_minor,
        250
    );
    assert.equal(normalizeSupport({ type: 'tip', amount: 'unknown', currency: 'USD' }), null);
});

test('count envelopes contain identity and day only, with a DST-safe local cutoff', () => {
    const result = envelope(
        'chat_count',
        { username: 'Guest', text: 'distinctive-private-phrase', badges: ['sub'] },
        'America/Chicago',
        '2026-11-01T11:59:59.000Z'
    );
    assert.equal(result.day, '2026-10-31');
    assert.doesNotMatch(JSON.stringify(result), /distinctive-private-phrase|badges/);
    assert.equal(reportingDay('2026-11-01T12:00:00Z'), '2026-11-01');
    assert.equal(reportingDay('2026-03-08T11:00:00Z'), '2026-03-08');
});

test('outbox survives restart, keeps owner boundaries, quarantines visibly and preserves data when full', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-outbox-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'queue.json');
    const owner = randomUUID();
    const item = {
        owner_id: owner,
        kind: 'activity',
        body: { batch_id: randomUUID(), records: [{ type: 'bits', bits: 50 }] }
    };
    const queue = createOutbox(file, { bytes: 100000, records: 1 });
    assert.equal(queue.bindOwner(owner), true);
    assert.equal(queue.bindOwner(randomUUID()), false);
    queue.enqueue(item);
    queue.enqueue(item);
    assert.equal(queue.canAccept(), false);
    const reopened = createOutbox(file, { bytes: 100000, records: 1 });
    assert.deepEqual(reopened.get().pending[0].body, item.body);
    assert.throws(
        () => reopened.enqueue({ ...item, body: { ...item.body, batch_id: randomUUID() } }),
        /outbox_full/
    );
    assert.equal(reopened.get().pending.length, 1);
    const stored = reopened.get().pending[0];
    reopened.acknowledge({ ...stored, owner_id: randomUUID() });
    assert.equal(reopened.get().pending.length, 1);
    reopened.quarantine(stored, 'invalid_fields');
    assert.equal(reopened.get().pending.length, 0);
    assert.equal(reopened.get().quarantine.length, 1);
    fs.writeFileSync(file, 'broken checkpoint');
    assert.throws(() => createOutbox(file), /outbox_unreadable/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken checkpoint');
});
