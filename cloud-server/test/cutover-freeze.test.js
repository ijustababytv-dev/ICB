'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { featureSources } = require('../tools/feature-source');
const { freezeSources } = require('../tools/cutover-freeze');

test('a partial cutover reuses frozen defaults, bytes, collector and watermark and rejects edited sources', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-cutover-'));
    const directory = path.join(root, 'data');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'todos.json'), JSON.stringify({ daily: [], weekly: [] }));
    try {
        const owner = randomUUID();
        const fresh = featureSources(directory, root);
        const first = freezeSources(root, owner, fresh, randomUUID(), 'acknowledged-watermark');
        const changedDefaults = featureSources(directory, root);
        const missing = changedDefaults.find((source) => !source.exists);
        missing.source = Buffer.from('{}');
        missing.sha256 = createHash('sha256').update(missing.source).digest('hex');
        const resumed = freezeSources(root, owner, changedDefaults, randomUUID(), 'new-watermark');
        assert.equal(resumed.frozen.collector_id, first.frozen.collector_id);
        assert.equal(resumed.frozen.watermark, 'acknowledged-watermark');
        assert.deepEqual(
            resumed.sources.map((source) => source.sha256),
            first.sources.map((source) => source.sha256)
        );
        assert.throws(() => freezeSources(root, randomUUID(), fresh), /Another owner/);
        fs.writeFileSync(
            path.join(directory, 'todos.json'),
            JSON.stringify({ daily: [{ id: 'changed' }], weekly: [] })
        );
        assert.throws(
            () => freezeSources(root, owner, featureSources(directory, root)),
            /changed while fenced/
        );
    } finally {
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'icb-cutover-')));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
