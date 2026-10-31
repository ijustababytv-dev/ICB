'use strict';
const { sendJson } = require('./response');
const { readBody } = require('./body');
const { trusted } = require('../routes/cloud-auth');
const features = require('../cloud/features');
const feed = require('../cloud/state-feed');
const config = require('../config');

/** Handle machine-local actions explicitly; every feature decision is proxied to authenticated Express. */
async function handleApi(req, res, url) {
    const path = url.pathname.replace(/\/$/, '') || '/';
    res.icbPath = features.canonicalPath(url);
    if (path.startsWith('/api/cloud/'))
        return require('../routes/cloud-auth').handleCloudAuth(req, res, url);
    if (
        req.method === 'GET' &&
        /^\/api\/feature-reports\/(?:[a-z]+|archives\/[a-f0-9-]{36})$/.test(path)
    ) {
        const upstream = path.includes('/archives/')
            ? path.replace('/api/feature-reports/', '/v1/features/')
            : path.replace('/api/feature-reports/', '/v1/features/reports/');
        const reply = await require('../cloud/session').call(upstream + url.search);
        if (reply.status === 200 && reply.data.archive) {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'Content-Disposition': 'attachment; filename="icb-feature-backup.json"'
            });
            return res.end(JSON.stringify(reply.data.archive.before_state, null, 2));
        }
        if (reply.status === 200 && reply.data.csv !== undefined) {
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Cache-Control': 'no-store',
                'Content-Disposition': 'attachment; filename="icb-feature-report.csv"'
            });
            return res.end(reply.data.csv);
        }
        return sendJson(res, reply.status, reply.data);
    }
    if (req.method !== 'GET' && !trusted(req))
        return sendJson(res, 403, {
            ok: false,
            code: 'local_origin_required',
            error: 'Reload this local page before making changes.'
        });
    if (['/api/health', '/api/diagnostics', '/api/tracker-skin-standard'].includes(path))
        return require('../routes/system').handleSystemApi(req, res, url);
    if (path.startsWith('/api/connection-check'))
        return require('../health').handleHealthApi(req, res, path, req.method);
    if (path.startsWith('/api/desktop'))
        return require('../desktop').handleDeskApi(req, res, path, req.method);
    if (path.startsWith('/api/activity/'))
        return require('../routes/activity').handleActivityApi(req, res, url);
    if (path === '/api/sprites/import-local' && req.method === 'POST')
        return require('../inputs/sprite-import').handleSpriteImport(req, res);
    if (path === '/api/neonchat')
        return require('../neon-chat').handleNeonChatApi(req, res, path, req.method, url);
    if (req.method === 'GET' && path.startsWith('/api/walkers/'))
        return require('../walkers').handleWalkersApi(req, res, path, req.method, url);
    if (req.method === 'POST' && path === '/api/walkers/test') {
        const values = await readBody(req);
        const name = String(values.name || 'TestUnicorn').slice(0, 40);
        require('../walkers').walkerChat(
            name,
            [{ t: 'text', v: String(values.text || 'Hi everyone!').slice(0, 300) }],
            true
        );
        return sendJson(res, 200, { ok: true, name });
    }
    if (req.method === 'GET' && ['/api/avatars', '/api/avatars/admin'].includes(path))
        return require('../avatars').handleAvatarsApi(req, res, path, req.method);
    if (path === '/api/giveaway/listener')
        return require('../inputs/listener').handleListener(req, res);
    if (path === '/api/giveaway/event')
        return require('../inputs/listener').handleLegacyEvent(req, res);
    if (path === '/api/hub/startup-urls' && req.method === 'GET') {
        const tiles = require('../hub').hubPublic().tiles;
        const base = 'http://127.0.0.1:' + config.PORT;
        return sendJson(res, 200, {
            ok: true,
            urls: [
                base + '/hub.html',
                ...tiles
                    .filter((tile) => tile.startup)
                    .map((tile) => (tile.url.startsWith('/') ? base + tile.url : tile.url))
            ]
        });
    }
    if (path === '/api/actions' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.target === 'reader.rescan') {
            const reader = require('../reader');
            reader.forceRescan = true;
            reader.scanLog();
            const action = {
                commandId: body.commandId || require('node:crypto').randomUUID(),
                target: body.target,
                status: 'completed',
                message: 'Reader scan requested.',
                completedAt: new Date().toISOString()
            };
            require('../state').recordAction(action);
            return sendJson(res, 202, { ok: true, action });
        }
        req.icbBody = body;
    }
    if (req.method === 'GET' && ['/api/weekly', '/api/resource-trackers'].includes(path))
        require('../overlay-diagnostics').notePoll(url.searchParams.get('src'));
    return features.handleFeature(req, res, url);
}

module.exports = { handleApi };
