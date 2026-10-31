'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { integrationRoutes } = require('../../src/features/integrations');

/** Concurrent key changes/deletes serialize; retries never restore a superseded secret version. */
async function verifyCredentials(pool, db, owner) {
    const collector = (
        await pool.query('SELECT collector_id FROM collector_leases WHERE owner_id=$1', [owner.id])
    ).rows[0].collector_id;
    await require('../../src/features/commands').importFeature(db, owner, 'steam', {
        command_id: randomUUID(),
        collector_id: collector,
        source_sha256: 'e'.repeat(64),
        input_watermark: 'credential-fixture',
        payload: {}
    });
    let exists = false;
    let deleted = false;
    let calls = 0;
    const versions = new Map();
    const arn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:baby-icb-fixture/steam';
    const secrets = {
        send: async (command) => {
            calls++;
            const input = command.input;
            switch (command.constructor.name) {
                case 'CreateSecretCommand':
                    if (exists)
                        throw Object.assign(new Error('exists'), {
                            name: 'ResourceExistsException'
                        });
                    exists = true;
                    versions.set(input.ClientRequestToken, input.SecretString);
                    return { ARN: arn };
                case 'DescribeSecretCommand':
                    return { ARN: arn, DeletedDate: deleted || undefined };
                case 'RestoreSecretCommand':
                    deleted = false;
                    return {};
                case 'PutSecretValueCommand':
                    assert.equal(deleted, false);
                    versions.set(input.ClientRequestToken, input.SecretString);
                    return {};
                case 'DeleteSecretCommand':
                    deleted = true;
                    return {};
                default:
                    throw new Error('Unexpected secret operation');
            }
        }
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.owner = owner;
        next();
    });
    app.use(integrationRoutes(db, secrets, { INTEGRATION_SECRET_PREFIX: 'baby-icb-fixture/' }));
    app.use((error, _req, res, _next) =>
        res.status(error.status || 500).json({ code: error.code })
    );
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
        const call = async (method, body) => {
            if (body.expected_revision === undefined)
                body.expected_revision = Number(
                    (
                        await pool.query(
                            "SELECT revision FROM feature_authority WHERE owner_id=$1 AND feature='steam'",
                            [owner.id]
                        )
                    ).rows[0].revision
                );
            const response = await fetch(
                'http://127.0.0.1:' + server.address().port + '/steam/secret',
                {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }
            );
            return { status: response.status, body: await response.json() };
        };

        const first = { command_id: randomUUID(), api_key: 'a'.repeat(32) };
        assert.equal((await call('PUT', first)).status, 200);
        const revision = Number(
            (
                await pool.query(
                    "SELECT revision FROM feature_authority WHERE owner_id=$1 AND feature='steam'",
                    [owner.id]
                )
            ).rows[0].revision
        );
        const removal = { command_id: randomUUID(), expected_revision: revision };
        const next = {
            command_id: randomUUID(),
            api_key: 'b'.repeat(32),
            expected_revision: revision
        };
        const concurrent = await Promise.all([call('DELETE', removal), call('PUT', next)]);
        assert.deepEqual(
            concurrent.map((r) => r.status).sort(),
            [200, 409],
            'Only one credential edit from the same displayed revision can commit.'
        );
        // Establish a final version regardless of which concurrent writer acquired the lock first.
        const final = { command_id: randomUUID(), api_key: 'c'.repeat(32) };
        await call('PUT', final);
        const before = calls;
        await call('PUT', first);
        await call('DELETE', removal);
        assert.equal(calls, before);
        assert.equal(deleted, false);
        assert.equal(
            (
                await pool.query(
                    'SELECT credential_version FROM integration_secrets WHERE owner_id=$1',
                    [owner.id]
                )
            ).rows[0].credential_version,
            final.command_id
        );
        assert.equal((await call('PUT', { ...first, api_key: 'd'.repeat(32) })).status, 409);
        const rows = await pool.query(
            "SELECT result::text FROM feature_commands WHERE owner_id=$1 AND feature='steam-credential'",
            [owner.id]
        );
        assert.ok(
            rows.rows.every((r) => !r.result.includes('api_key') && !r.result.includes('cccccccc'))
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

module.exports = { verifyCredentials };
