'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { featureStateRoutes } = require('../../src/activity/feature-state');
const { ingest } = require('../../src/activity/ingest');
const { normalizeSupport } = require('../../src/domain/support-normalize');

/** Retired snapshot and client-decided award routes cannot overwrite a cloud-owned or temporarily fenced feature. */
async function verifyLegacyFences(pool, db, owner, collector) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.owner = owner;
        next();
    });
    app.use('/v1/state', featureStateRoutes(db));
    app.use((error, _req, res, _next) =>
        res.status(error.status || 500).json({ code: error.code })
    );
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
        const base = 'http://127.0.0.1:' + server.address().port;
        for (const mode of ['cloud', 'migrating']) {
            await pool.query(
                'UPDATE feature_authority SET mode=$2 WHERE owner_id=$1 AND feature=$3',
                [owner.id, mode, 'todos']
            );
            const response = await fetch(base + '/v1/state/todos.json', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    collector_id: collector,
                    revision: 999999,
                    captured_at: new Date().toISOString(),
                    payload: { daily: [], weekly: [] }
                })
            });
            assert.equal(response.status, 409);
            assert.equal((await response.json()).code, 'feature_cloud_owned');
        }
        await pool.query(
            "UPDATE feature_authority SET mode='cloud' WHERE owner_id=$1 AND feature='todos'",
            [owner.id]
        );
        const record = normalizeSupport(
            { type: 'bits', username: 'RetiredFixture', amount: 100, unicorns: 1 },
            owner.reporting_timezone
        );
        await assert.rejects(
            () =>
                ingest(
                    db,
                    { ...owner, live_cutover_at: new Date(Date.now() - 60000) },
                    {
                        schema_version: 1,
                        batch_id: randomUUID(),
                        collector_id: collector,
                        sealed_at: new Date().toISOString(),
                        migration_id: null,
                        records: [record]
                    }
                ),
            /legacy_award_writer_retired/
        );
        assert.equal(
            (await pool.query('SELECT current FROM todos WHERE owner_id=$1', [owner.id])).rows[0]
                .current,
            '1'
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

module.exports = { verifyLegacyFences };
