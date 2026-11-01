'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, protect, defaultFile } = require('../../src/cloud/credential-store');

test(
    'Windows DPAPI store survives a fresh reader, conceals token/account text and clears remembered material',
    { skip: process.platform !== 'win32' },
    () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-dpapi-test-'));
        const file = path.join(temp, 'saved.dpapi');
        const value = {
            token: 'fixture-token-never-a-real-secret',
            account: { username: 'fixture-owner' }
        };
        try {
            const store = createStore(file);
            store.write(value);
            const bytes = fs.readFileSync(file).toString('utf8');
            assert.ok(!bytes.includes(value.token));
            assert.ok(!bytes.includes(value.account.username));
            assert.deepEqual(createStore(file).read(), value);
            assert.deepEqual(fs.readdirSync(temp), ['saved.dpapi']);
            fs.writeFileSync(file, 'corrupt protected record');
            assert.throws(() => store.read(), /secure_storage_unavailable/);
            store.clear();
            assert.equal(createStore(file).read(), null);
            assert.equal(fs.existsSync(file), false);
            assert.ok(!defaultFile().includes('OneDrive'));
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    }
);

test('Protection failure cannot leave a plaintext file or partial temporary record', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-store-failure-'));
    try {
        const store = createStore(path.join(temp, 'saved'), () => {
            throw new Error('secure_storage_unavailable');
        });
        assert.throws(() => store.write({ token: 'fixture-only' }), /secure_storage_unavailable/);
        assert.deepEqual(fs.readdirSync(temp), []);
        if (process.platform !== 'win32')
            assert.throws(() => protect(Buffer.from('fixture')), /secure_storage_unavailable/);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
