'use strict';
const express = require('express');
const { createHash } = require('node:crypto');
const { batch: validateBatch } = require('./validation');
const { transaction } = require('./db');
const { verifyCollector } = require('./collectors');
const bulk = require('./bulk');
const { fail } = require('./errors');

/** Canonicalize JSON keys so equivalent key order does not cause false receipt conflicts. */
function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return (
            '{' +
            Object.keys(value)
                .sort()
                .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
                .join(',') +
            '}'
        );
    return JSON.stringify(value);
}

/** Commit receipts, event deduplication, and summaries together before returning an acknowledgment. */
async function ingest(db, owner, input) {
    const body = validateBatch(input, owner.reporting_timezone);
    const digest = createHash('sha256').update(canonical(body)).digest('hex');
    return transaction(db, async (client) => {
        const receipt = await client.query(
            `INSERT INTO activity_receipts(owner_id,batch_id,digest,collector_id)
            VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING batch_id`,
            [owner.id, body.batch_id, digest, body.collector_id]
        );
        if (!receipt.rowCount) {
            const previous = await client.query(
                'SELECT digest FROM activity_receipts WHERE owner_id=$1 AND batch_id=$2',
                [owner.id, body.batch_id]
            );
            if (previous.rows[0].digest !== digest) throw fail(409, 'batch_content_changed');
            return { ok: true, batch_id: body.batch_id, duplicate: true };
        }
        await verifyCollector(client, owner, body);
        // Serialize by owner to avoid summary/viewer deadlocks across concurrently delivered batches.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('icb-owner:' || $1,0))", [
            owner.id
        ]);
        const records = await bulk.novelRecords(client, owner.id, body.records);
        const viewerId = await bulk.viewers(client, owner.id, records);
        await bulk.events(client, owner.id, records, viewerId);
        await bulk.summaries(client, owner.id, records, viewerId);
        const accepted = records.length;
        return { ok: true, batch_id: body.batch_id, accepted };
    });
}

/** Mount the single bounded batch endpoint. */
function ingestRoutes(db) {
    const router = express.Router();
    router.post('/batches', async (req, res) => res.json(await ingest(db, req.owner, req.body)));
    return router;
}

module.exports = { canonical, ingest, ingestRoutes };
