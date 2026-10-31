'use strict';
const express = require('express');
const { executeCommand, importFeature } = require('./commands');
const { stateFeed } = require('./feed');
const { owned } = require('./catalog');
const { saveAssets } = require('./assets');

/** Feature routes inherit the existing session owner and sanitized Express error handling. */
function featureRoutes(db) {
    const router = express.Router();
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
            await stateFeed(db, req.owner, { after: req.query.after ? Number(req.query.after) : 0 })
        )
    );
    router.post('/state/read', async (req, res) =>
        res.json(await stateFeed(db, req.owner, req.body))
    );
    router.post('/:feature/commands', async (req, res) =>
        res.json(await executeCommand(db, req.owner, req.params.feature, req.body))
    );
    router.post('/:feature/import', async (req, res) =>
        res.json(await importFeature(db, req.owner, req.params.feature, req.body))
    );
    return router;
}

module.exports = { featureRoutes };
