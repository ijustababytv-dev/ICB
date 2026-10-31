'use strict';
const express = require('express');
const {
    SecretsManagerClient,
    CreateSecretCommand,
    PutSecretValueCommand,
    DescribeSecretCommand,
    DeleteSecretCommand,
    RestoreSecretCommand
} = require('@aws-sdk/client-secrets-manager');
const { fields, uuid, integer } = require('../activity/validation');
const { fail } = require('../activity/errors');
const { transaction } = require('../activity/db');
const { lockOwner } = require('./repository');
const { digest } = require('./contracts');

/** Integration secrets are separate from SQL and the database credential secret. */
function integrationRoutes(
    db,
    secrets = new SecretsManagerClient({
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 }
    }),
    env = process.env
) {
    const router = express.Router();
    router.put('/steam/secret', async (req, res) => {
        integer(req.body.expected_revision, 0, Number.MAX_SAFE_INTEGER);
        const result = await putSteamSecret(db, req.owner.id, req.body, secrets, env);
        res.json(result);
    });
    router.delete('/steam/secret', async (req, res) => {
        fields(req.body, ['command_id', 'expected_revision']);
        uuid(req.body.command_id);
        integer(req.body.expected_revision, 0, Number.MAX_SAFE_INTEGER);
        const result = await credentialChange(db, req.owner.id, req.body, async (client) => {
            const current = await client.query(
                "SELECT secret_arn FROM integration_secrets WHERE owner_id=$1 AND kind='steam'",
                [req.owner.id]
            );
            if (current.rowCount) {
                await secrets.send(
                    new DeleteSecretCommand({
                        SecretId: current.rows[0].secret_arn,
                        RecoveryWindowInDays: 7
                    })
                );
                await client.query(
                    "DELETE FROM integration_secrets WHERE owner_id=$1 AND kind='steam'",
                    [req.owner.id]
                );
                await client.query(
                    "DELETE FROM integration_jobs WHERE owner_id=$1 AND kind='steam'",
                    [req.owner.id]
                );
            }
            return { ok: true, configured: false };
        });
        res.json(result);
    });
    return router;
}

/** Used by the authenticated API and explicit administrative import; credentials never enter a feature payload. */
async function putSteamSecret(db, owner, body, secrets, env) {
    fields(body, ['command_id', 'api_key', 'expected_revision']);
    uuid(body.command_id);
    if (!/^[a-f0-9]{32}$/i.test(body.api_key || '')) throw fail(400, 'invalid_steam_key');
    const prefix = env.INTEGRATION_SECRET_PREFIX;
    if (!/^baby-icb-[a-z0-9/-]+\/$/.test(prefix || '')) throw fail(503, 'integration_unavailable');
    const name = prefix + owner + '/steam';
    const value = {
        Name: name,
        SecretString: body.api_key.toUpperCase(),
        ClientRequestToken: body.command_id
    };
    return credentialChange(db, owner, body, async (client) => {
        let arn;
        try {
            arn = (await secrets.send(new CreateSecretCommand(value))).ARN;
        } catch (error) {
            if (error.name !== 'ResourceExistsException')
                throw fail(503, 'integration_secret_unavailable');
            const description = await secrets.send(new DescribeSecretCommand({ SecretId: name }));
            arn = description.ARN;
            if (description.DeletedDate)
                await secrets.send(new RestoreSecretCommand({ SecretId: arn }));
            await secrets.send(
                new PutSecretValueCommand({
                    SecretId: arn,
                    SecretString: value.SecretString,
                    ClientRequestToken: value.ClientRequestToken
                })
            );
        }
        await client.query(
            `INSERT INTO integration_secrets(owner_id,kind,secret_arn,credential_version) VALUES($1,'steam',$2,$3)
        ON CONFLICT(owner_id,kind) DO UPDATE SET secret_arn=EXCLUDED.secret_arn,credential_version=EXCLUDED.credential_version`,
            [owner, arn, body.command_id]
        );
        await client.query(
            `INSERT INTO integration_jobs(owner_id,kind,due_at) VALUES($1,'steam',now())
        ON CONFLICT(owner_id,kind) DO UPDATE SET due_at=now()`,
            [owner]
        );
        return { ok: true, configured: true };
    });
}

/** Serialize secret versions with deletes; old retries acknowledge without reverting a newer credential. */
async function credentialChange(db, owner, body, operation) {
    return transaction(db, async (client) => {
        const clock = await lockOwner(client, owner);
        await client.query("SET LOCAL idle_in_transaction_session_timeout='12s'");
        const hash = digest(body);
        const old = await client.query(
            "SELECT digest,result FROM feature_commands WHERE owner_id=$1 AND feature='steam-credential' AND command_id=$2",
            [owner, body.command_id]
        );
        if (old.rowCount) {
            if (old.rows[0].digest !== hash) throw fail(409, 'command_content_changed');
            return old.rows[0].result;
        }
        const authority = (
            await client.query(
                "SELECT mode,revision FROM feature_authority WHERE owner_id=$1 AND feature='steam'",
                [owner]
            )
        ).rows[0];
        if (authority?.mode === 'migrating') throw fail(409, 'feature_not_migrated');
        if (
            body.expected_revision !== undefined &&
            (authority?.mode !== 'cloud' || Number(authority.revision) !== body.expected_revision)
        )
            throw fail(409, 'stale_feature_revision');
        const revision = Number(clock.revision) + (authority?.mode === 'cloud' ? 1 : 0);
        const result = {
            ...(await operation(client)),
            command_id: body.command_id,
            feature_revision: authority?.mode === 'cloud' ? revision : null
        };
        if (authority?.mode === 'cloud') {
            await client.query(
                "UPDATE feature_authority SET revision=$2 WHERE owner_id=$1 AND feature='steam'",
                [owner, revision]
            );
            await client.query('UPDATE owner_revisions SET revision=$2 WHERE owner_id=$1', [
                owner,
                revision
            ]);
            await client.query(
                "INSERT INTO feature_changes(owner_id,revision,feature,snapshot) VALUES($1,$2,'steam','{}'::jsonb)",
                [owner, revision]
            );
        }
        await client.query(
            `INSERT INTO feature_commands(owner_id,feature,command_id,digest,revision,result)
            VALUES($1,'steam-credential',$2,$3,$4,$5::jsonb)`,
            [owner, body.command_id, hash, revision, JSON.stringify(result)]
        );
        return result;
    });
}

module.exports = { integrationRoutes, putSteamSecret };
