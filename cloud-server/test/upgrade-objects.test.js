'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { upgradeDefinition, objectSource, migrationHash } = require('../tools/upgrade-objects');

test('object upgrades retain their original SQL when current definitions change and reject missing/corrupt history', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-upgrade-'));
    const root = path.join(temporary, 'database');
    const version = '006-fixture.sql';
    const source = 'CREATE TABLE fixture(id integer PRIMARY KEY);\n';
    const item = {
        file: 'tables/fixture.sql',
        sha256: createHash('sha256').update(source).digest('hex')
    };
    try {
        fs.mkdirSync(path.join(root, 'tables'), { recursive: true });
        fs.mkdirSync(path.join(root, 'upgrades'));
        fs.writeFileSync(path.join(root, item.file), source);
        const manifest = path.join(root, 'upgrades/006-fixture.json');
        fs.writeFileSync(manifest, JSON.stringify({ version, objects: [item] }));
        const originalHash = migrationHash(version, 'SELECT 1;', root);
        assert.equal(objectSource(version, item, root), source);
        fs.writeFileSync(path.join(root, item.file), 'CREATE TABLE fixture(id text);');
        assert.throws(
            () => objectSource(version, item, root),
            /restore.*administrative upgrade bundle/i
        );
        const retained = path.join(temporary, 'dist/database-upgrades', version, item.file);
        fs.mkdirSync(path.dirname(retained), { recursive: true });
        fs.writeFileSync(retained, source);
        assert.equal(objectSource(version, item, root), source);
        assert.equal(migrationHash(version, 'SELECT 1;', root), originalHash);
        fs.writeFileSync(retained, 'corrupt');
        assert.throws(() => objectSource(version, item, root), /Pinned object source unavailable/);
        fs.writeFileSync(
            manifest,
            JSON.stringify({ version, objects: [{ ...item, file: '../private.sql' }] })
        );
        assert.throws(() => upgradeDefinition(version, root), /Invalid upgrade object/);
        fs.writeFileSync(manifest, JSON.stringify({ version, objects: [item, item] }));
        assert.throws(() => upgradeDefinition(version, root), /Invalid upgrade object/);
    } finally {
        assert.ok(path.resolve(temporary).startsWith(path.join(os.tmpdir(), 'icb-upgrade-')));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
