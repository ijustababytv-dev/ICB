'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const { authenticate, authRoutes } = require('./auth');
const { collectorRoutes } = require('./collectors');
const { ingestRoutes } = require('./ingest');
const { reportRoutes } = require('./reports');
const { featureStateRoutes } = require('./feature-state');
const { featureRoutes } = require('../features/router');
const { integrationRoutes } = require('../features/integrations');

/** Construct Express independently of the listener for loopback and database integration tests. */
function createApp(db, logger = (entry) => console.info(JSON.stringify(entry))) {
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        req.requestId = randomUUID();
        const start = Date.now();
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.on('finish', () =>
            logger({
                request_id: req.requestId,
                code: res.statusCode,
                duration_ms: Date.now() - start,
                batch_size: Array.isArray(req.body?.records) ? req.body.records.length : 0,
                ok: res.statusCode < 400
            })
        );
        next();
    });
    app.get('/healthz', (_req, res) => res.json({ ok: true }));
    app.use(express.json({ limit: '256kb', strict: true }));
    app.use('/v1', authRoutes(db));
    app.use('/v1', authenticate(db));
    app.use('/v1/collectors', collectorRoutes(db));
    app.use('/v1/activity', ingestRoutes(db));
    app.use('/v1/reports', reportRoutes(db));
    app.use('/v1/state', featureStateRoutes(db));
    app.use('/v1/features', featureRoutes(db));
    app.use('/v1/integrations', integrationRoutes(db));
    app.use((_req, res) => res.status(404).json({ ok: false, code: 'not_found' }));
    app.use((error, req, res, _next) => {
        const status =
            error.status === 413
                ? 413
                : error.type === 'entity.parse.failed'
                ? 400
                : error.code && Number.isInteger(error.status)
                ? error.status
                : 503;
        const code =
            status === 413
                ? 'body_too_large'
                : error.type === 'entity.parse.failed'
                ? 'invalid_json'
                : error.status && error.code
                ? error.code
                : 'service_unavailable';
        res.status(status).json({ ok: false, code, request_id: req.requestId });
    });
    return app;
}

module.exports = { createApp };
