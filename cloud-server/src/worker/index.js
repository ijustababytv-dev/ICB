'use strict';
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { createDatabase, transaction } = require('../activity/db');
const repository = require('../features/repository');
const { createContext } = require('../features/context');
const { loadAssets } = require('../features/assets');
const { claimJob, releaseJob } = require('./jobs');
const { steamTransport } = require('./steam-http');
let database;
const secrets = new SecretsManagerClient({});

/** Share DB/TLS infrastructure, without an HTTP listener, Web Adapter or persistent worker loop. */
async function runTick(db, options = {}) {
    const deadline = options.deadline || Date.now() + 12000;
    let processed = 0;
    while (processed < 2 && Date.now() + 6000 < deadline) {
        const job = await claimJob(db);
        if (!job) break;
        processed++;
        try {
            const loaded = await db.withClient(async (client) => ({
                documents: await repository.loadDocuments(client, job.owner_id),
                assets: await loadAssets(client, job.owner_id),
                secret: (
                    await client.query(
                        "SELECT secret_arn,credential_version FROM integration_secrets WHERE owner_id=$1 AND kind='steam'",
                        [job.owner_id]
                    )
                ).rows[0]
            }));
            const settings = loaded.documents['steam.json'];
            if (!loaded.secret || !settings || settings.enabled === false) {
                await db.withClient((client) => releaseJob(client, job, 300));
                continue;
            }
            // Provider requests deliberately run after releasing the DB client and its transaction.
            const secret = await (options.secrets || secrets).send(
                new GetSecretValueCommand({
                    SecretId: loaded.secret.secret_arn,
                    VersionId: loaded.secret.credential_version
                })
            );
            const context = createContext(loaded.documents, {
                now: Date.now(),
                timezone: job.reporting_timezone,
                assets: loaded.assets,
                integrations: { steamKey: secret.SecretString },
                steamGet: options.steamGet || steamTransport(deadline)
            }).initialize();
            const outcome = await context.use('steam').steamPoll(false);
            await transaction(db, async (client) => {
                const clock = await repository.lockOwner(client, job.owner_id);
                const authority = await repository.authorities(client, job.owner_id);
                const lease = await client.query(
                    'SELECT lease_token,lease_until>now() AS active,attempts FROM integration_jobs WHERE owner_id=$1 AND kind=$2 FOR UPDATE',
                    [job.owner_id, job.kind]
                );
                if (lease.rows[0]?.lease_token !== job.token || !lease.rows[0].active) return;
                const sameSecret = await client.query(
                    "SELECT 1 FROM integration_secrets WHERE owner_id=$1 AND kind='steam' AND secret_arn=$2 AND credential_version=$3",
                    [job.owner_id, loaded.secret.secret_arn, loaded.secret.credential_version]
                );
                if (
                    !sameSecret.rowCount ||
                    String(authority.get('steam')?.revision) !== String(job.revision)
                ) {
                    await releaseJob(client, job, 1);
                    return;
                }
                await repository.saveChanges(
                    client,
                    job.owner_id,
                    context,
                    clock.revision,
                    authority
                );
                const interval = Math.max(60, Number(settings.pollSec) || 60);
                await releaseJob(
                    client,
                    job,
                    outcome.ok
                        ? interval
                        : Math.min(3600, 60 * 2 ** Math.min(lease.rows[0].attempts + 1, 6)),
                    outcome.ok ? null : 'steam_provider_unavailable'
                );
            });
        } catch (_) {
            await db.withClient((client) =>
                releaseJob(client, job, 120, 'integration_worker_failed')
            );
            throw new Error('integration_worker_failed');
        }
    }
    return { ok: true, processed };
}

/** Failures reach Lambda's asynchronous on-failure destination with a payload containing no credentials. */
async function handler(_event, invocation) {
    if (!database) database = createDatabase();
    return runTick(database, {
        deadline:
            Date.now() + Math.min(12000, (invocation?.getRemainingTimeInMillis() || 15000) - 1500)
    });
}

module.exports = { handler, runTick };
