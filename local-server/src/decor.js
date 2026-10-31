'use strict';
const feed = require('./cloud/state-feed');
const { serveArt, serveDecorOverlay } = require('./assets/public-files');

/** Presentation layers read configuration from the shared cloud cache. */
function decorPublicState() {
    return feed.watch('/api/decor/state') || { ok: false, effects: [], presets: [] };
}

/** Decor artwork remains local under its established URL. */
function serveDecorArt(res, pathname) {
    return serveArt(res, pathname, '/decor-art/', 'decor');
}

module.exports = { decorPublicState, serveDecorArt, serveDecorOverlay };
