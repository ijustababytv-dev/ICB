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
const { createContext } = require('../../../cloud-server/src/features/context');
const cloud = createContext({}).initialize();
const giveaway = cloud.use('giveaway/state');
const feed = require('../../src/cloud/state-feed');
const inputs = require('../../src/cloud/inputs');
feed.authority = () => ({ mode: 'cloud', protocol_version: 2, revision: 1 });

feed.document = (file) => (file === 'giveaway.json' ? structuredClone(giveaway.giveaway) : null);

const originalSync = collector.sync;
collector.sync = async () => {};

const { applyIntent } = require('../../../cloud-server/src/features/inputs');
const received = new Set();
/** Test the collector boundary using the real cloud rules; SQL receipt atomicity is tested separately against PostgreSQL. */
async function deliver() {
    for (const item of collector
        .queue()
        .get()
        .pending.filter((item) => item.kind === 'feature')) {
        if (received.has(item.body.operands.source_key)) continue;
        received.add(item.body.operands.source_key);
        await applyIntent(
            cloud,
            item.body.operands,
            { query: async () => ({ rowCount: 1 }) },

            { id: active.account.id }
        );
    }
}

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

test('live chat still reaches Neon Chat and participation, but no persistent file contains its wording', async () => {
    const phrase = 'distinctive-private-phrase';
    const data = {
        platform: 'twitch',
        source_id: 'message-1',
        data: { sender: 'Guest', raw: phrase }
    };
    acceptChat(data);
    acceptChat(data);
    inputs.flushPresence();
    await deliver();
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

test('cumulative bits, blocked supporters and chat windows preserve cloud ticket rules', async () => {
    acceptSupport({ type: 'bits', username: 'Guest', amount: 60, source_id: 'cheer-a' });
    acceptSupport({ type: 'bits', username: 'Guest', amount: 50, source_id: 'cheer-b' });
    acceptSupport({ type: 'bits', username: 'Guest', amount: 50, source_id: 'cheer-b' });
    await deliver();
    assert.equal(giveaway.giveaway.entrants.Guest.counts.bits, 110);
    assert.equal(giveaway.giveaway.entrants.Guest.bitsTickets, 1);
    giveaway.giveaway.blocked = ['Blocked'];
    acceptChat({ source_id: 'blocked-chat', data: { sender: 'Blocked', raw: 'hello' } });
    acceptSupport({ type: 'gifts', username: 'Blocked', count: 3, source_id: 'blocked-gift' });
    assert.equal(giveaway.giveaway.entrants.Blocked, undefined);
    inputs.flushPresence();
    await deliver();
    giveaway.awardChatWindow();
    assert.equal(giveaway.giveaway.entrants.Guest.counts.chatWindows, 1);
    assert.ok(
        cloud.effects.some(
            (event) => event.type === 'gifts' && event.username === 'Blocked' && event.count === 3
        )
    );
    assert.ok(cloud.effects.some((event) => event.type === 'bits' && event.unicorns === 1));
});

test('failed durable enqueue cannot mutate tickets or consume the upstream retry identity', async () => {
    const queue = collector.queue();
    const enqueue = queue.enqueueFeature;
    const months = giveaway.giveaway.entrants.Guest.counts.subMonths;
    queue.enqueueFeature = () => {
        throw new Error('injected disk failure');
    };

    try {
        assert.throws(
            () =>
                acceptSupport({
                    type: 'sub',
                    username: 'Guest',
                    months: 1,
                    source_id: 'sub-crash'
                }),
            /injected disk failure/
        );
        assert.equal(giveaway.giveaway.entrants.Guest.counts.subMonths, months);
    } finally {
        queue.enqueueFeature = enqueue;
    }
    acceptSupport({ type: 'sub', username: 'Guest', months: 1, source_id: 'sub-crash' });
    acceptSupport({ type: 'sub', username: 'Guest', months: 1, source_id: 'sub-crash' });
    await deliver();
    await deliver();
    assert.equal(giveaway.giveaway.entrants.Guest.counts.subMonths, months + 1);
    assert.equal(fs.existsSync(path.join(temp, 'giveaway.json')), false);
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
        await originalSync();
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
