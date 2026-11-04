'use strict';
const express = require('express');
const { executeCommand, importFeature } = require('./commands');
const { stateFeed } = require('./feed');
const { owned } = require('./catalog');
const { saveAssets } = require('./assets');

/** Stamp transport time after commit, separately from the command's immutable logical time. */
function stamped(result) {
    return { ...result, sent_at: new Date().toISOString() };
}

/** Feature routes inherit the existing session owner and sanitized Express error handling. */
function featureRoutes(db) {
    const router = express.Router();
    router.get('/archives/:id', async (req, res) => {
        const id = require('../activity/validation').uuid(req.params.id);
        const rows = await db.withClient(
            async (client) =>
                (
                    await client.query(
                        'SELECT feature,backup_name,before_state FROM feature_undo WHERE owner_id=$1 AND id=$2',
                        [req.owner.id, id]
                    )
                ).rows
        );
        if (!rows.length) throw require('../activity/errors').fail(404, 'archive_not_found');
        res.json({ ok: true, archive: rows[0] });
    });
    router.get('/reports/:kind', async (req, res) => {
        const { featureReport, reportCsv } = require('./reports');
        const report = await featureReport(db, req.owner, req.params.kind, req.query);
        res.json(
            req.query.format === 'csv'
                ? {
                      ok: true,
                      filename: 'icb-' + req.params.kind + '.csv',
                      csv: reportCsv(report.rows),
                      next_offset: report.next_offset
                  }
                : report
        );
    });
    router.get('/assets', async (req, res) =>
        res.json({
            ok: true,
            references: await db.withClient((client) =>
                require('./assets').loadAssets(client, req.owner.id)
            )
        })
    );
    router.post('/assets', async (req, res) => res.json(await saveAssets(db, req.owner, req.body)));
    router.get('/capabilities', async (req, res) =>
        res.json({
            ok: true,
            protocol_version: 2,
            features: owned.map((entry) => entry.feature),
            authority: 'per-owner-feature'
        })
    );
    router.get('/state', async (req, res) =>
        res.json(
            stamped(
                await stateFeed(db, req.owner, {
                    after: req.query.after ? Number(req.query.after) : 0
                })
            )
        )
    );
    router.post('/state/read', async (req, res) =>
        res.json(stamped(await stateFeed(db, req.owner, req.body)))
    );
    router.post('/:feature/commands', async (req, res) =>
        res.json(stamped(await executeCommand(db, req.owner, req.params.feature, req.body)))
    );
    router.post('/:feature/import', async (req, res) =>
        res.json(await importFeature(db, req.owner, req.params.feature, req.body))
    );
    return router;
}

module.exports = { featureRoutes };
