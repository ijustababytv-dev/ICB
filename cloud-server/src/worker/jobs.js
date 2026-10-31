'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('../activity/db');

/** A duplicate tick cannot claim a live lease, and inactive owners do not generate provider traffic. */
async function claimJob(db) {
    return transaction(db, async (client) => {
        const result = await client.query(`SELECT j.owner_id,j.kind,a.reporting_timezone,f.revision
            FROM integration_jobs j JOIN owner_revisions o ON o.owner_id=j.owner_id
            JOIN accounts a ON a.id=j.owner_id JOIN feature_authority f ON f.owner_id=j.owner_id AND f.feature='steam' AND f.mode='cloud'
            WHERE j.due_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now())
            AND o.active_at>now()-interval '5 minutes' ORDER BY j.due_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
        if (!result.rowCount) return null;
        const job = { ...result.rows[0], token: randomUUID() };
        await client.query(
            "UPDATE integration_jobs SET lease_token=$3,lease_until=now()+interval '30 seconds' WHERE owner_id=$1 AND kind=$2",
            [job.owner_id, job.kind, job.token]
        );
        return job;
    });
}

/** Finish only the still-current lease; a stale worker never replaces a newer command or credential. */
async function releaseJob(client, job, seconds, error = null) {
    return client.query(
        `UPDATE integration_jobs SET lease_token=NULL,lease_until=NULL,
        due_at=now()+$4*interval '1 second',attempts=CASE WHEN $5::text IS NULL THEN 0 ELSE attempts+1 END,last_error=$5
        WHERE owner_id=$1 AND kind=$2 AND lease_token=$3`,
        [job.owner_id, job.kind, job.token, seconds, error]
    );
}

module.exports = { claimJob, releaseJob };
