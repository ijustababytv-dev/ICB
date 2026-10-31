'use strict';
const { fail } = require('../activity/errors');

/** Persist one bounded due job; manual refresh cannot bypass the provider's minimum interval. */
async function scheduleJobs(client, owner, context) {
    for (const job of context.jobs) {
        if (job.kind !== 'steam') throw new Error('unknown_integration_job');
        if (job.force) {
            const current = await client.query(
                "SELECT due_at FROM integration_jobs WHERE owner_id=$1 AND kind='steam'",
                [owner]
            );
            const lastPoll = Number(context.documents['steam.json']?.lastPoll) || 0;
            if (current.rowCount && context.now - lastPoll < 30000)
                throw fail(429, 'steam_refresh_limited');
        }
        await client.query(
            `INSERT INTO integration_jobs(owner_id,kind,due_at) VALUES($1,'steam',now())
            ON CONFLICT(owner_id,kind) DO UPDATE SET due_at=LEAST(integration_jobs.due_at,EXCLUDED.due_at)`,
            [owner]
        );
    }
}

/** Only presence of an owner-scoped reference is exposed to presentation models. */
async function integrationFlags(client, owner) {
    const rows = await client.query('SELECT kind FROM integration_secrets WHERE owner_id=$1', [
        owner
    ]);
    return { steamConfigured: rows.rows.some((entry) => entry.kind === 'steam') };
}

module.exports = { scheduleJobs, integrationFlags };
