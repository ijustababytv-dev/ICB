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
const { fields, uuid } = require('../activity/validation');
const { fail } = require('../activity/errors');
const { transaction } = require('../activity/db');
const { lockOwner } = require('./repository');

/** Integration secrets are separate from SQL and the database credential secret. */
function integrationRoutes(db, secrets = new SecretsManagerClient({}), env = process.env) {
    const router = express.Router();
    router.put('/steam/secret', async (req, res) => {
        fields(req.body, ['command_id', 'api_key']);
        uuid(req.body.command_id);
        if (!/^[a-f0-9]{32}$/i.test(req.body.api_key || '')) throw fail(400, 'invalid_steam_key');
        const prefix = env.INTEGRATION_SECRET_PREFIX;
        if (!/^baby-icb-[a-z0-9/-]+\/$/.test(prefix || ''))
            throw fail(503, 'integration_unavailable');
        const name = prefix + req.owner.id + '/steam';
        const value = {
            Name: name,
            SecretString: req.body.api_key.toUpperCase(),
            ClientRequestToken: req.body.command_id
        };
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
        await transaction(db, async (client) => {
            await lockOwner(client, req.owner.id);
            await client.query(
                `INSERT INTO integration_secrets(owner_id,kind,secret_arn,credential_version) VALUES($1,'steam',$2,$3)
                ON CONFLICT(owner_id,kind) DO UPDATE SET secret_arn=EXCLUDED.secret_arn,credential_version=EXCLUDED.credential_version`,
                [req.owner.id, arn, req.body.command_id]
            );
            await client.query(
                `INSERT INTO integration_jobs(owner_id,kind,due_at) VALUES($1,'steam',now())
                ON CONFLICT(owner_id,kind) DO UPDATE SET due_at=now()`,
                [req.owner.id]
            );
        });
        res.json({ ok: true, configured: true });
    });
    router.delete('/steam/secret', async (req, res) => {
        fields(req.body, []);
        const result = await db.withClient((client) =>
            client.query(
                "SELECT secret_arn FROM integration_secrets WHERE owner_id=$1 AND kind='steam'",
                [req.owner.id]
            )
        );
        if (result.rowCount) {
            await secrets.send(
                new DeleteSecretCommand({
                    SecretId: result.rows[0].secret_arn,
                    RecoveryWindowInDays: 7
                })
            );
            await transaction(db, async (client) => {
                await lockOwner(client, req.owner.id);
                await client.query(
                    "DELETE FROM integration_secrets WHERE owner_id=$1 AND kind='steam' AND secret_arn=$2",
                    [req.owner.id, result.rows[0].secret_arn]
                );
                await client.query(
                    "DELETE FROM integration_jobs WHERE owner_id=$1 AND kind='steam'",
                    [req.owner.id]
                );
            });
        }
        res.json({ ok: true, configured: false });
    });
    return router;
}

module.exports = { integrationRoutes };
