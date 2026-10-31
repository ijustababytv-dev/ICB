'use strict';

const mHttpResponse = require('./response');
const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('../config');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

/** Serve public files with their MIME type while denying private project paths. */
function serveStatic(res, pathname) {
    // Browsers ask for this unprompted; a 404 in the console during a live
    // overlay debug is pure noise.
    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }
    // "/" is now ICB Home, the page with a tile for every dashboard (2026-09-29).
    const result = resolveStaticPath(pathname, mConfig.APP_DIR);
    if (result.error)
        return mHttpResponse.sendJson(res, result.status, { ok: false, error: result.error });
    const file = result.file;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
    const realFile = fs.realpathSync(file);
    const realRoot = fs.realpathSync(result.root);
    if (!realFile.startsWith(realRoot + path.sep))
        return mHttpResponse.sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });
    return res.end(fs.readFileSync(file));
}

/** Preserve public URLs while keeping server code and saved state outside the static roots. */
function resolveStaticPath(pathname, appDir) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname === '/' ? '/hub.html' : pathname);
    } catch (_error) {
        return { status: 400, error: 'Invalid URL path.' };
    }
    if (
        !decoded.startsWith('/') ||
        /[\\\0]/.test(decoded) ||
        decoded.split('/').some((part) => part.startsWith('.'))
    ) {
        return { status: 403, error: 'Forbidden.' };
    }
    const legacyScripts = {
        '/matter.min.js': 'matter.min.js',
        '/meld-firehose.js': 'meld-firehose.js'
    };
    const ui = path.join(appDir, 'ui');
    if (legacyScripts[decoded])
        return {
            file: path.join(ui, 'js', 'vendor', legacyScripts[decoded]),
            root: path.join(ui, 'js', 'vendor')
        };
    if (decoded.endsWith('.html'))
        return { file: path.join(ui, 'html', decoded.slice(1)), root: path.join(ui, 'html') };
    // The server intentionally serves only browser code, styles, and artwork.
    const publicRoots = {
        '/assets/': path.join(appDir, 'assets'),
        '/images/': path.join(ui, 'images'),
        '/css/': path.join(ui, 'css'),
        '/js/client/': path.join(ui, 'js'),
        '/js/vendor/': path.join(ui, 'js', 'vendor')
    };
    const prefix = Object.keys(publicRoots).find((entry) => decoded.startsWith(entry));
    if (!prefix) return { status: 404, error: 'Not found.' };
    return {
        file: path.join(publicRoots[prefix], decoded.slice(prefix.length)),
        root: publicRoots[prefix]
    };
}

Object.assign(exports, { MIME, serveStatic, resolveStaticPath });
