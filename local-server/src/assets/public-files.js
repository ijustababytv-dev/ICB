'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { MIME, serveStatic } = require('../http/static');
const { sendJson } = require('../http/response');

/** Resolve artwork inside its actual local root, including symlink containment. */
function serveArt(res, pathname, prefix, folder) {
    let relative;
    try {
        relative = decodeURIComponent(pathname.slice(prefix.length));
    } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid art path.' });
    }
    if (
        !relative ||
        /[\\\x00-\x1f]/.test(relative) ||
        relative.split('/').some((part) => !part || part.startsWith('.'))
    )
        return sendJson(res, 404, { ok: false, error: 'Not found.' });
    const root = path.join(config.APP_DIR, 'assets', folder);
    const file = path.resolve(root, relative);
    if (
        !file.startsWith(path.resolve(root) + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
    )
        return sendJson(res, 404, { ok: false, error: 'Not found.' });
    if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep))
        return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });
    return res.end(fs.readFileSync(file));
}

/** Dedicated decor URLs share the existing static overlay markup. */
function serveDecorOverlay(res) {
    return serveStatic(res, '/decor-overlay.html');
}

module.exports = { serveArt, serveDecorOverlay };
