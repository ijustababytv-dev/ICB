'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildImport, stableId } = require('../../tools/activity-import');

test('streaming import chooses one chat representation, matches support, and produces stable minimal retries', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-import-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, '2026-10-20.jsonl');
    const at = '2026-10-20T18:00:00.000Z';
    const entries = [
        { type: 'chat', at, username: 'Guest' },
        {
            type: 'raw',
            kind: 'chat',
            at,
            data: { id: 'source-chat', sender: 'Guest', raw: 'distinctive-private-phrase' }
        },
        {
            type: 'raw',
            kind: 'chat',
            at,
            data: { id: 'source-chat-2', sender: 'Guest', raw: 'other private speech' }
        },
        { type: 'sub', at, username: 'Guest', months: 2, unicorns: 4 },
        { type: 'raw', kind: 'sub', at, data: { subscriber: 'Guest', months_purchased: 2 } },
        { type: 'chat_unicorns', at, usernames: ['Guest'], each: 1 },
        { type: 'winner', at, username: 'Guest', unicorns: 500 },
        { type: 'raw', kind: 'viewer_list', at, data: { viewers: ['private'] } },
        { type: 'chat', at: '2026-10-22T18:00:00.000Z', username: 'TooLate' }
    ];
    fs.writeFileSync(
        file,
        entries.map((entry) => JSON.stringify(entry)).join('\n') + '\nnot json\n'
    );
    const first = await buildImport(file, '2026-10-21T00:00:00.000Z');
    const second = await buildImport(file, '2026-10-21T00:00:00.000Z');
    assert.deepEqual(first.records, second.records);
    assert.equal(
        first.records.filter((record) => record.type === 'chat_count')[0].message_delta,
        2
    );
    assert.equal(first.records.filter((record) => record.type === 'sub').length, 1);
    assert.equal(
        first.records.filter((record) => record.type === 'winner')[0].ticket_delta,
        undefined
    );
    assert.equal(first.stats.malformed, 1);
    assert.equal(first.stats.unequal_chat_days, 1);
    assert.equal(first.stats.partial, true);
    assert.equal(first.stats.ignored_after_cutoff, 1);
    assert.doesNotMatch(
        JSON.stringify(first.records),
        /distinctive-private-phrase|speech|viewers|TooLate/
    );
    assert.equal(stableId(first.hash, 'batch:0'), stableId(second.hash, 'batch:0'));
});
