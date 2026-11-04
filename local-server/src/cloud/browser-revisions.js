'use strict';
const feed = require('./state-feed');

/** A submitted edit carries the revision its page read, rather than silently using a newer Node cache. */
function expectedRevision(req, feature) {
    try {
        const raw = req.headers['x-icb-revisions'];
        if (typeof raw !== 'string' || raw.length > 8000) throw new Error();
        const value = JSON.parse(raw)[feature];
        if (!Number.isSafeInteger(value) || value < 0) throw new Error();
        return { expected_revision: value };
    } catch (_) {
        throw Object.assign(new Error('feature_revision_required'), { status: 428 });
    }
}

/** Read-only response metadata has no token or secret and follows the displayed view's revision. */
function responseHeaders(path) {
    const { routeFor } = require('../../../cloud-server/src/features/executor');
    let revisions = {};
    try {
        const feature = routeFor(path).route[0];
        revisions =
            path === '/api/state'
                ? feed.revisions()
                : {
                      [feature]: feed.viewRevision(path) || feed.authority(feature)?.revision || 0
                  };
    } catch (_) {
        /* Machine-local endpoints have no feature revision. */
    }
    return {
        'X-ICB-Sync-State': feed.status().code || 'ready',
        'X-ICB-Revisions': JSON.stringify(revisions),
        'X-ICB-Clock-Offset': String(feed.status().clock_offset_ms)
    };
}

module.exports = { expectedRevision, responseHeaders };
