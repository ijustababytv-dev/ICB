'use strict';
const express = require('express');
const { fields, uuid } = require('./validation');
const { transaction } = require('./db');
const { fail } = require('./errors');

/** Serialize lease claims per owner; a second live collector cannot take over silently. */
function collectorRoutes(db) {
    const router = express.Router();
    router.post('/claim', async (req, res) => {
        fields(req.body, ['collector_id']);
        const collector = uuid(req.body.collector_id);
        const lease = await transaction(db, async (client) => {
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtextextended('icb-owner:' || $1,0))",
                [req.owner.id]
            );
            const current = await client.query(
                'SELECT *, expires_at>now() AS active FROM collector_leases WHERE owner_id=$1',
                [req.owner.id]
            );
            const row = current.rows[0];
            if (row?.active && row.collector_id !== collector) throw fail(409, 'collector_in_use');
            if (row && row.collector_id !== collector)
                await client.query(
                    `INSERT INTO collector_history(owner_id,collector_id,started_at,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [req.owner.id, row.collector_id, row.started_at, row.expires_at]
                );
            const next = await client.query(
                `INSERT INTO collector_leases(owner_id,collector_id,expires_at)
                VALUES($1,$2,now()+interval '90 seconds') ON CONFLICT(owner_id) DO UPDATE SET
                collector_id=EXCLUDED.collector_id,
                started_at=CASE WHEN collector_leases.collector_id=EXCLUDED.collector_id THEN collector_leases.started_at ELSE now() END,
                expires_at=EXCLUDED.expires_at RETURNING expires_at`,
                [req.owner.id, collector]
            );
            return next.rows[0];
        });
        res.json({ ok: true, ...lease });
    });
    return router;
}

/** Admit previously sealed batches from expired leases without admitting competing live collectors. */
async function verifyCollector(client, owner, batch) {
    if (batch.migration_id) {
        const run = await client.query(
            'SELECT cutoff_at FROM migration_runs WHERE id=$1 AND owner_id=$2 AND status IN ($3,$4)',
            [batch.migration_id, owner.id, 'prepared', 'partial']
        );
        if (
            !run.rowCount ||
            batch.records.some((r) => Date.parse(r.at) >= new Date(run.rows[0].cutoff_at).getTime())
        )
            throw fail(409, 'import_boundary');
        return;
    }
    if (
        !owner.live_cutover_at ||
        batch.records.some((r) => Date.parse(r.at) < new Date(owner.live_cutover_at).getTime())
    )
        throw fail(409, 'cutover_required');
    const current = await client.query(
        'SELECT *, expires_at>now() AS active FROM collector_leases WHERE owner_id=$1',
        [owner.id]
    );
    const row = current.rows[0];
    if (
        row?.active &&
        row.collector_id === batch.collector_id &&
        batch.records.every(
            (record) => Date.parse(record.at) >= new Date(row.started_at).getTime() - 5000
        )
    )
        return;
    const history = await client.query(
        `SELECT started_at,expires_at FROM collector_history WHERE owner_id=$1 AND collector_id=$2
        UNION ALL SELECT started_at,expires_at FROM collector_leases WHERE owner_id=$1 AND collector_id=$2`,
        [owner.id, batch.collector_id]
    );
    const accepted = history.rows.some(
        (lease) =>
            Date.parse(batch.sealed_at) <= new Date(lease.expires_at).getTime() &&
            batch.records.every(
                (r) =>
                    Date.parse(r.at) >= new Date(lease.started_at).getTime() &&
                    Date.parse(r.at) <= new Date(lease.expires_at).getTime()
            )
    );
    if (!accepted) throw fail(409, 'collector_lease_expired');
}

module.exports = { collectorRoutes, verifyCollector };
