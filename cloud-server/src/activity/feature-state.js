'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createHash } = require('node:crypto');
const { fields, uuid, integer } = require('./validation');
const { transaction } = require('./db');
const { fail } = require('./errors');
const manifest = JSON.parse(
    fs.readFileSync(
        path.join(
            process.env.LAMBDA_TASK_ROOT || path.resolve(__dirname, '../../..'),
            'database/state-manifest.json'
        ),
        'utf8'
    )
);
const FORBIDDEN =
    /^(?:__proto__|prototype|constructor|password|token|secret|authorization|raw|line|lastEvent|message|lastMessage|parts|fragments|senderInfo|bubble)$/i;

/** Refuse chat-bearing fields and credentials inside otherwise valid saved feature state. */
function validatePayload(value, depth = 0) {
    if (depth > 15) throw fail(400, 'invalid_state');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN.test(key)) throw fail(400, 'private_state_field');
        validatePayload(child, depth + 1);
    }
}

/** Store only allowlisted settings/progress, ordered by capture time and revision from the same collector. */
function featureStateRoutes(db) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        fields(req.query, []);
        const result = await db.withClient((client) =>
            client.query(
                'SELECT state_key,revision,sha256,captured_at FROM feature_state WHERE owner_id=$1 ORDER BY state_key',
                [req.owner.id]
            )
        );
        res.json({ ok: true, states: result.rows });
    });
    router.get('/:key', async (req, res) => {
        if (!manifest[req.params.key]) throw fail(404, 'state_not_found');
        fields(req.query, []);
        const result = await db.withClient((client) =>
            client.query(
                'SELECT state_key,revision,payload,captured_at FROM feature_state WHERE owner_id=$1 AND state_key=$2',
                [req.owner.id, req.params.key]
            )
        );
        if (!result.rowCount) throw fail(404, 'state_not_found');
        res.json({ ok: true, ...result.rows[0] });
    });
    router.put('/:key', async (req, res) => {
        const allowed = manifest[req.params.key];
        if (!allowed) throw fail(400, 'invalid_state_key');
        fields(req.body, ['collector_id', 'revision', 'captured_at', 'payload']);
        uuid(req.body.collector_id);
        integer(req.body.revision, 1, Number.MAX_SAFE_INTEGER);
        fields(req.body.payload, allowed);
        validatePayload(req.body.payload);
        const at = Date.parse(req.body.captured_at);
        if (!Number.isFinite(at) || at > Date.now() + 300000) throw fail(400, 'invalid_timestamp');
        const hash = createHash('sha256').update(JSON.stringify(req.body.payload)).digest('hex');
        await transaction(db, async (client) => {
            const lease = await client.query(
                'SELECT collector_id FROM collector_leases WHERE owner_id=$1 AND expires_at>now() FOR UPDATE',
                [req.owner.id]
            );
            if (lease.rows[0]?.collector_id !== req.body.collector_id)
                throw fail(409, 'collector_lease_expired');
            const saved = await client.query(
                `INSERT INTO feature_state(owner_id,state_key,revision,sha256,payload,captured_at,collector_id)
                VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,state_key) DO UPDATE SET
                revision=EXCLUDED.revision,sha256=EXCLUDED.sha256,payload=EXCLUDED.payload,captured_at=EXCLUDED.captured_at,collector_id=EXCLUDED.collector_id
                WHERE feature_state.captured_at<EXCLUDED.captured_at OR
                (feature_state.collector_id=EXCLUDED.collector_id AND feature_state.revision<=EXCLUDED.revision AND feature_state.sha256=EXCLUDED.sha256)
                RETURNING state_key`,
                [
                    req.owner.id,
                    req.params.key,
                    req.body.revision,
                    hash,
                    req.body.payload,
                    req.body.captured_at,
                    req.body.collector_id
                ]
            );
            if (!saved.rowCount) throw fail(409, 'stale_state');
            await client.query(
                'INSERT INTO state_import_runs(owner_id,state_key,source_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
                [req.owner.id, req.params.key, hash]
            );
        });
        res.json({ ok: true, state_key: req.params.key, sha256: hash });
    });
    return router;
}

module.exports = { featureStateRoutes, validatePayload, manifest };
