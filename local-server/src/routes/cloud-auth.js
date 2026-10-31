'use strict';
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { readBody } = require('../http/body');
const { sendJson } = require('../http/response');
const session = require('../cloud/session');
const collector = require('../activity/collector');
const config = require('../config');
const csrf = randomBytes(32).toString('hex');

/** Limit credential/configuration mutations to exact local origins with an unpredictable CSRF token. */
function trusted(req) {
    if (
        !['http://127.0.0.1:' + config.PORT, 'http://localhost:' + config.PORT].includes(
            req.headers.origin
        )
    )
        return false;
    const provided = Buffer.from(String(req.headers['x-icb-csrf'] || ''));
    const expected = Buffer.from(csrf);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Keep the API URL in Node configuration and cloud sessions out of browser storage. */
async function handleCloudAuth(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/cloud/status') {
        // CORS-readable status contains no credentials or CSRF token.
        return sendJson(res, 200, {
            ok: true,
            ...collector.status(),
            configured: !!process.env.ICB_CLOUD_API_URL
        });
    }
    if (req.method === 'GET' && url.pathname === '/api/cloud/csrf') {
        const ref = String(req.headers.referer || '');
        if (
            ![
                'http://127.0.0.1:' + config.PORT + '/',
                'http://localhost:' + config.PORT + '/'
            ].some((origin) => ref.startsWith(origin))
        )
            return sendJson(res, 403, { ok: false, code: 'local_origin_required' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ ok: true, csrf }));
    }
    if (!trusted(req)) return sendJson(res, 403, { ok: false, code: 'local_origin_required' });
    try {
        if (req.method === 'POST' && url.pathname === '/api/cloud/login') {
            const body = await readBody(req, 2048);
            if (Object.keys(body).some((key) => !['username', 'password'].includes(key)))
                throw new Error('invalid_login');
            collector.flushCounts();
            await session.logout();
            await session.login(process.env.ICB_CLOUD_API_URL, body.username, body.password);
            await collector.sync();
            require('../activity/state-sync').captureAll();
            return sendJson(res, 200, { ok: true, ...collector.status() });
        }
        if (req.method === 'POST' && url.pathname === '/api/cloud/logout') {
            collector.flushCounts();
            await session.logout();
            return sendJson(res, 200, { ok: true, ...collector.status() });
        }
    } catch (_error) {
        return sendJson(res, 401, { ok: false, code: 'cloud_login_failed' });
    }
    return sendJson(res, 404, { ok: false, code: 'not_found' });
}

module.exports = { handleCloudAuth, trusted };
