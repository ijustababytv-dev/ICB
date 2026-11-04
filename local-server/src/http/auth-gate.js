'use strict';
const session = require('../cloud/session');
const { sendJson } = require('./response');
const config = require('../config');
const loginAssets = new Set([
    '/cloud.html',
    '/css/hub.css',
    '/css/cloud.css',
    '/css/page-navigation.css',
    '/js/client/local-api.js',
    '/js/client/cloud-auth.js'
]);
const authMethods = new Map([
    ['/api/cloud/status', 'GET'],
    ['/api/cloud/csrf', 'GET'],
    ['/api/cloud/login', 'POST'],
    ['/api/cloud/logout', 'POST'],
    ['/api/cloud/restore', 'POST']
]);

/** Block every feature, static asset and event stream until this installation has a validated session. */
async function requireSignIn(req, res, url) {
    const method = req.method;
    const page = url.pathname;
    if (
        (['GET', 'HEAD'].includes(method) && loginAssets.has(page)) ||
        authMethods.get(page) === method
    )
        return false;
    if (method === 'GET' && page === '/api/health' && !session.current()) {
        // Launchers need readiness, never private file paths or feature diagnostics, before login.
        sendJson(res, 200, {
            ok: true,
            service: 'ICB Clean Room',
            port: config.PORT,
            auth_required: true
        });
        return true;
    }
    await session.ready();
    if (session.current()) return false;
    if (method === 'GET' && page === '/api/hub/startup-urls') {
        sendJson(res, 200, {
            ok: true,
            urls: ['http://127.0.0.1:' + config.PORT + '/cloud.html?startup=1']
        });
    } else if (['GET', 'HEAD'].includes(method) && (page === '/' || /\.html$/i.test(page))) {
        res.writeHead(303, {
            Location: '/cloud.html?next=' + encodeURIComponent(url.pathname + url.search),
            'Cache-Control': 'no-store'
        });
        res.end();
    } else {
        sendJson(res, 401, {
            ok: false,
            code: 'login_required',
            error: 'Cloud sign-in is required.'
        });
    }
    return true;
}

/** Close already-open event streams as soon as an account changes, expires or signs out. */
function bindStreams() {
    const events = require('../events');
    return session.onChange(() => {
        for (const client of events.clients)
            try {
                client.end();
            } catch (_error) {}
        events.clients.clear();
    });
}

module.exports = { requireSignIn, bindStreams };
