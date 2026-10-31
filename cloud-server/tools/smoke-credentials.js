'use strict';
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const {
    SecretsManagerClient,
    GetSecretValueCommand,
    DeleteSecretCommand,
    RestoreSecretCommand,
    DescribeSecretCommand
} = require('@aws-sdk/client-secrets-manager');
const { adminDatabase } = require('./admin-db');
const { createOwner, removeOwner } = require('./smoke-owners');
const { request } = require('../../local-server/src/cloud/client');

/** Verify actual API IAM/secret versioning with a generated fixture key; no Steam/provider request or real account is used. */
async function main() {
    const pool = adminDatabase();
    const secrets = new SecretsManagerClient({});
    let owner;
    let arn;
    try {
        owner = await createOwner(pool);
        const base = process.env.ICB_CLOUD_API_URL;
        const login = await request(base, '/v1/login', 'POST', {
            username: owner.username,
            password: owner.password
        });
        assert.equal(login.status, 200);
        const call = (route, method, body) => request(base, route, method, body, login.data.token);

        const feed = await call('/v1/features/state/read', 'POST', {
            after: 0,
            paths: ['/api/steam/admin']
        });
        assert.equal(feed.status, 200);
        // Keep the fixture integration disabled so Scheduler cannot contact Steam with its synthetic key.
        const disabled = await call('/v1/features/steam/commands', 'POST', {
            protocol_version: 2,
            command_id: randomUUID(),
            expected_revision: feed.data.authorities.steam.revision,
            action: 'request',
            operands: { path: '/api/steam/settings', method: 'POST', values: { enabled: false } }
        });
        assert.equal(disabled.status, 200, disabled.data.code);
        const key = randomBytes(16).toString('hex');
        const first = {
            command_id: randomUUID(),
            api_key: key,
            expected_revision: disabled.data.feature_revision
        };
        const saved = await call('/v1/integrations/steam/secret', 'PUT', first);
        assert.equal(saved.status, 200, saved.data.code);
        assert.equal(saved.data.feature_revision, first.expected_revision + 1);
        arn = (
            await pool.query('SELECT secret_arn FROM integration_secrets WHERE owner_id=$1', [
                owner.id
            ])
        ).rows[0].secret_arn;
        assert.ok(arn.includes(':secret:baby-icb-') && arn.includes('/' + owner.id + '/steam-'));
        const stored = await secrets.send(
            new GetSecretValueCommand({ SecretId: arn, VersionId: first.command_id })
        );
        if (stored.SecretString !== key.toUpperCase())
            throw new Error('Scoped secret contents differ.');
        assert.equal(JSON.stringify(saved.data).includes(key), false);
        assert.equal(
            (
                await call('/v1/integrations/steam/secret', 'PUT', {
                    ...first,
                    command_id: randomUUID(),
                    api_key: randomBytes(16).toString('hex')
                })
            ).status,
            409
        );
        assert.equal(
            (
                await call('/v1/integrations/steam/secret', 'DELETE', {
                    command_id: randomUUID(),
                    expected_revision: saved.data.feature_revision
                })
            ).status,
            200
        );
        assert.equal((await call('/v1/integrations/steam/secret', 'PUT', first)).status, 200);
        assert.equal(
            (
                await pool.query(
                    'SELECT count(*) AS n FROM integration_secrets WHERE owner_id=$1',
                    [owner.id]
                )
            ).rows[0].n,
            '0',
            'An old PUT receipt never revives a removed key.'
        );
        console.info(
            JSON.stringify({
                scoped_aws_secret_write_read_delete: true,
                stale_credential_revision_rejected: true,
                old_retry_does_not_restore_key: true,
                provider_contacted: false
            })
        );
    } finally {
        if (owner && !arn) {
            const prefix =
                process.env.INTEGRATION_SECRET_PREFIX ||
                (process.env.TF_VAR_db_identifier || 'baby-icb-postgres').slice(0, 40) +
                    '-integrations/';
            try {
                arn = (
                    await secrets.send(
                        new DescribeSecretCommand({ SecretId: prefix + owner.id + '/steam' })
                    )
                ).ARN;
            } catch (error) {
                if (error.name !== 'ResourceNotFoundException') throw error;
            }
        }
        if (arn) {
            assert.match(owner.username, /^icb_step2_[a-f0-9]{12}$/);
            assert.ok(arn.includes('/' + owner.id + '/steam-'));
            try {
                await secrets.send(
                    new DeleteSecretCommand({ SecretId: arn, ForceDeleteWithoutRecovery: true })
                );
            } catch (error) {
                if (error.name !== 'InvalidRequestException') throw error;
                await secrets.send(new RestoreSecretCommand({ SecretId: arn }));
                await secrets.send(
                    new DeleteSecretCommand({ SecretId: arn, ForceDeleteWithoutRecovery: true })
                );
            }
        }
        if (owner) await removeOwner(pool, owner);
        secrets.destroy();
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error('Scoped credential smoke failed: ' + error.message);
        process.exitCode = 1;
    });
