'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DATABASE_ROOT, definition, sourceHash } = require('../tools/schema');

/** Each manifest test owns a temporary copy so checked-in SQL and live data cannot be altered. */
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-schema-'));
    fs.cpSync(DATABASE_ROOT, root, {
        recursive: true,
        filter: (file) => !path.basename(file).startsWith('.') && !file.endsWith('.pem')
    });
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
        assert.match(path.basename(root), /^icb-schema-/);
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}

/** Persist only the synthetic manifest being tested. */
function save(root, manifest) {
    fs.writeFileSync(path.join(root, 'schema.json'), JSON.stringify(manifest));
}

test('every table and standalone index has its own named, ordered source file', () => {
    const manifest = definition();
    const tables = manifest.objects.filter((file) => file.startsWith('tables/'));
    const indexes = manifest.objects.filter((file) => file.startsWith('indexes/'));
    assert.equal(tables.length, 19);
    assert.equal(indexes.length, 12);
    for (const [directory, pattern] of [
        ['tables', /CREATE TABLE\s+([a-z0-9_]+)/g],
        ['indexes', /CREATE (?:UNIQUE )?INDEX\s+([a-z0-9_]+)/g]
    ]) {
        const listed = manifest.objects.filter((file) => file.startsWith(directory + '/')).sort();
        const actual = fs
            .readdirSync(path.join(DATABASE_ROOT, directory))
            .filter((file) => file.endsWith('.sql'))
            .map((file) => directory + '/' + file)
            .sort();
        assert.deepEqual(actual, listed);
        for (const file of listed) {
            const matches = [
                ...fs.readFileSync(path.join(DATABASE_ROOT, file), 'utf8').matchAll(pattern)
            ];
            assert.equal(matches.length, 1, file);
            assert.equal(matches[0][1], path.basename(file, '.sql'));
        }
    }
    assert.deepEqual(
        manifest.bootstrap.filter((file) => file.startsWith('roles/')),
        ['roles/icb_migrator.sql', 'roles/icb_service.sql']
    );
    assert.deepEqual(
        manifest.grants.map((file) => path.basename(file)).sort(),
        tables.map((file) => path.basename(file)).sort()
    );
    // The four already-deployed versions are represented by the current table/index sources.
    assert.equal(Object.keys(manifest.covers).length, 4);
    for (const file of fs
        .readdirSync(path.join(DATABASE_ROOT, 'migrations'))
        .filter((name) => name.endsWith('.sql')))
        assert.doesNotMatch(
            fs.readFileSync(path.join(DATABASE_ROOT, 'migrations', file), 'utf8'),
            /CREATE\s+TABLE/i
        );
});

test('schema definitions reject traversal, duplicate files, missing files and invalid version history', (t) => {
    const root = fixture(t);
    const original = definition(root);
    for (const mutate of [
        (value) => value.objects.push('../outside.sql'),
        (value) => value.objects.push(value.objects[0]),
        (value) => value.objects.push('tables/missing.sql'),
        (value) => value.objects.reverse(),
        (value) => {
            value.covers['001-activity.sql'] = 'changed';
        },
        (value) => {
            value.format = 2;
        }
    ]) {
        const value = structuredClone(original);
        mutate(value);
        save(root, value);
        assert.throws(() => definition(root));
    }
});

test('fresh-schema fingerprint includes object contents and preserved version hashes', (t) => {
    const root = fixture(t);
    const before = sourceHash(root);
    fs.appendFileSync(path.join(root, 'tables/accounts.sql'), '\n-- changed fixture\n');
    assert.notEqual(sourceHash(root), before);
    const changed = sourceHash(root);
    const manifest = definition(root);
    manifest.covers['001-activity.sql'] = 'a'.repeat(64);
    save(root, manifest);
    assert.notEqual(sourceHash(root), changed);
});
