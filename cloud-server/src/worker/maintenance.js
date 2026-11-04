'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('../activity/db');
const repository = require('../features/repository');
const { createContext } = require('../features/context');
const { finalizeDue } = require('../features/executor');
const { commitEffects } = require('../features/effects');
const { sanitize } = require('../features/contracts');
const { reportingDay } = require('../activity/reporting-day');
const { releaseJob } = require('./jobs');

/** Finalize idle windows and retain rolling/daily snapshots without loading hundreds of backup payloads. */
async function maintenance(db, job) {
    return transaction(db, async (client) => {
        const clock = await repository.lockOwner(client, job.owner_id);
        const lease = await client.query(
            'SELECT 1 FROM integration_jobs WHERE owner_id=$1 AND kind=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE',
            [job.owner_id, job.kind, job.token]
        );
        if (!lease.rowCount) return;
        const authorities = await repository.authorities(client, job.owner_id);
        const context = createContext(await repository.loadDocuments(client, job.owner_id), {
            now: clock.now.getTime(),
            timezone: job.reporting_timezone,
            assets: await require('../features/assets').loadAssets(client, job.owner_id),
            integrations: await require('../features/jobs').integrationFlags(client, job.owner_id)
        }).initialize();
        finalizeDue(context);
        const revision = await repository.saveChanges(
            client,
            job.owner_id,
            context,
            clock.revision,
            authorities
        );
        await commitEffects(
            client,
            { id: job.owner_id, reporting_timezone: job.reporting_timezone },
            context.effects
        );
        const state = JSON.stringify(sanitize(context.use('giveaway/state').giveaway));
        const stamp = clock.now
            .toISOString()
            .replace(/[:.TZ]/g, '-')
            .replace(/-+$/, '');
        const day = reportingDay(clock.now.getTime(), job.reporting_timezone);
        for (const name of ['auto_' + stamp + '.json', 'daily_' + day + '_000000.json']) {
            await client.query(
                `INSERT INTO feature_undo(owner_id,feature,id,backup_name,before_state,after_revision,backup_metadata)
                VALUES($1,'giveaway',$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(owner_id,feature,backup_name) DO NOTHING`,
                [
                    job.owner_id,
                    randomUUID(),
                    name,
                    state,
                    revision,
                    JSON.stringify(
                        require('../features/recovery').backupMetadata(JSON.parse(state))
                    )
                ]
            );
        }
        for (const [kind, keep] of [
            ['auto', 144],
            ['daily', 60],
            ['before', 40],
            ['corrupt', 20]
        ])
            await client.query(
                `DELETE FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' AND id IN
                (SELECT id FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' AND backup_name LIKE $2 ORDER BY created_at DESC OFFSET $3)`,
                [job.owner_id, kind + '_%', keep]
            );
        await client.query(
            'DELETE FROM feature_display_events WHERE owner_id=$1 AND expires_at<now()',
            [job.owner_id]
        );
        await client.query(
            "DELETE FROM feature_changes WHERE owner_id=$1 AND created_at<now()-interval '24 hours'",
            [job.owner_id]
        );
        await releaseJob(client, job, 300);
    });
}

module.exports = { maintenance };
