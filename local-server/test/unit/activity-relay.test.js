'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-relay-test-'));
process.env.ICB_CLEAN_DATA_DIR = temp;
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const session = require('../../src/cloud/session');
let active = { account: { id: randomUUID(), timezone: 'America/Chicago' } };
session.current = () => active;

const collector = require('../../src/activity/collector');
const giveaway = require('../../src/giveaway/state');
const activity = require('../../src/giveaway/activity');
const { acceptChat, acceptSupport, handleActivityApi } = require('../../src/routes/activity');
const chat = require('../../src/neon-chat');
const { trusted, handleCloudAuth } = require('../../src/routes/cloud-auth');

test('report selection uses the signed-in owner’s timezone rather than the local jar timezone', async () => {
    const call = session.call;
    const now = Date.now;
    Date.now = () => Date.parse('2026-10-31T18:00:00.000Z');

    active.account.timezone = 'Pacific/Auckland';
    session.call = async () => ({ status: 200, data: { days: [] } });

    let body;
    try {
        await handleActivityApi(
            { method: 'GET' },
            {
                writeHead: () => {},

                end: (value) => {
                    body = JSON.parse(value);
                }
            },
            new URL('http://127.0.0.1:8790/api/activity/nights')
        );
        assert.equal(body.tonight, '2026-11-01');
    } finally {
        session.call = call;
        Date.now = now;
        active.account.timezone = 'America/Chicago';
    }
});

test('local credential writes require both the exact local Origin and CSRF token', async () => {
    let body;
    const req = { method: 'GET', headers: { referer: 'http://127.0.0.1:8790/cloud.html' } };
    const res = {
        writeHead: () => {},

        end: (value) => {
            body = JSON.parse(value);
        }
    };
    await handleCloudAuth(req, res, new URL('http://127.0.0.1:8790/api/cloud/csrf'));
    assert.equal(
        trusted({ headers: { origin: 'http://127.0.0.1:8790', 'x-icb-csrf': body.csrf } }),
        true
    );
    assert.equal(
        trusted({ headers: { origin: 'https://evil.example', 'x-icb-csrf': body.csrf } }),
        false
    );
    assert.equal(trusted({ headers: { origin: 'http://127.0.0.1:8790' } }), false);
});

test('live chat still reaches Neon Chat and participation, but no persistent file contains its wording', () => {
    const phrase = 'distinctive-private-phrase';
    const data = {
        platform: 'twitch',
        source_id: 'message-1',
        data: { sender: 'Guest', raw: phrase }
    };
    acceptChat(data);
    acceptChat(data);
    giveaway.flushChat();
    collector.flushCounts();
    const queued = collector
        .queue()
        .get()
        .pending.filter((entry) => entry.kind === 'activity');
    assert.equal(
        queued
            .flatMap((entry) => entry.body.records)
            .filter((record) => record.type === 'chat_count')[0].message_delta,
        1
    );
    assert.equal(giveaway.giveaway.chatActiveThisWindow.Guest, true);
    assert.ok(JSON.stringify(chat.chatPublic()).includes(phrase));
    for (const file of fs.readdirSync(temp).filter((name) => /\.json$/.test(name)))
        assert.doesNotMatch(
            fs.readFileSync(path.join(temp, file), 'utf8'),
            new RegExp(phrase),
            file
        );
    assert.equal(fs.existsSync(path.join(temp, 'activity')), false);
});

test('cumulative bits, blocked supporters and chat windows preserve current local ticket rules', () => {
    acceptSupport({ type: 'bits', username: 'Guest', amount: 60, source_id: 'cheer-a' });
    acceptSupport({ type: 'bits', username: 'Guest', amount: 50, source_id: 'cheer-b' });
    acceptSupport({ type: 'bits', username: 'Guest', amount: 50, source_id: 'cheer-b' });
    assert.equal(giveaway.giveaway.entrants.Guest.counts.bits, 110);
    assert.equal(giveaway.giveaway.entrants.Guest.bitsTickets, 1);
    giveaway.giveaway.blocked = ['Blocked'];
    acceptChat({ source_id: 'blocked-chat', data: { sender: 'Blocked', raw: 'hello' } });
    acceptSupport({ type: 'gifts', username: 'Blocked', count: 3, source_id: 'blocked-gift' });
    assert.equal(giveaway.giveaway.entrants.Blocked, undefined);
    giveaway.awardChatWindow();
    assert.equal(giveaway.giveaway.entrants.Guest.counts.chatWindows, 1);
    const records = collector
        .queue()
        .get()
        .pending.flatMap((entry) => entry.body.records || []);
    assert.ok(
        records.some(
            (record) =>
                record.type === 'gifts' &&
                record.viewer.username === 'blocked' &&
                record.quantity === 3
        )
    );
    assert.ok(records.some((record) => record.type === 'bits' && record.ticket_delta === 1));
});

test('saved applied-award markers recover after a failed outbox write without awarding twice', () => {
    const queue = collector.queue();
    const enqueue = queue.enqueue;
    queue.enqueue = () => {
        throw new Error('injected disk failure');
    };

    acceptSupport({ type: 'sub', username: 'Guest', months: 1, source_id: 'sub-crash' });
    const saved = JSON.parse(fs.readFileSync(path.join(temp, 'giveaway.json'), 'utf8'));
    assert.equal(saved.cloudAuditPending.length, 1);
    const months = saved.entrants.Guest.counts.subMonths;
    queue.enqueue = enqueue;
    activity.recover(saved.cloudAuditPending);
    giveaway.saveGiveaway();
    activity.recover(saved.cloudAuditPending);
    giveaway.saveGiveaway();
    assert.equal(giveaway.giveaway.entrants.Guest.counts.subMonths, months);
    // Event UUID is stable across recovery, so cloud event receipts suppress cross-batch retries.
    const records = queue.get().pending.flatMap((entry) => entry.body.records || []);
    const recovered = records.filter((record) => record.source_id === 'sub-crash');
    assert.equal(new Set(recovered.map((record) => record.id)).size, 1);
});

test('switching accounts never relabels pending activity or mirrors another owner’s feature state', () => {
    const owner = active.account.id;
    collector.flushCounts();
    active = { account: { id: randomUUID(), timezone: 'America/Chicago' } };
    collector.chat({ username: 'Guest' });
    collector.flushCounts();
    assert.equal(collector.canCollect(), false);
    assert.ok(
        collector
            .queue()
            .get()
            .pending.every((entry) => entry.owner_id === owner)
    );
});

/** Keep a rejected second installation from accumulating duplicate live activity. */
test('a competing collector pauses new collection and preserves queued owner-bound records', async () => {
    active = { account: { id: collector.queue().get().bound_owner, timezone: 'America/Chicago' } };
    const original = session.call;
    session.call = async () => ({ status: 409, data: { code: 'collector_in_use' } });

    try {
        await collector.sync();
        assert.equal(collector.canCollect(), false);
        const before = collector.queue().get().pending.length;
        collector.chat({ username: 'AnotherGuest' });
        collector.flushCounts();
        assert.equal(collector.queue().get().pending.length, before);
        assert.equal(collector.status().code, 'collector_in_use');
    } finally {
        session.call = original;
    }
});
