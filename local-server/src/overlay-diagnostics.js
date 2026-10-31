'use strict';

const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');

// ---------------------------------------------------------------------------
// OVERLAY POLL TRACKING
// The XHR-polling overlay pages (ticker.html, weekly.html, ...) never show up
// in connectedClients, so without this the dashboard's "NO OVERLAY LAYERS
// CONNECTED" warning would be blind to them. Each page tags its poll with
// ?src=<name>, and this records who asked for an overlay page and what browser
// engine asked - the only way to tell a Meld request apart from a Chrome one.
// ---------------------------------------------------------------------------
const overlayPolls = new Map();
const OVERLAY_POLL_FRESH_MS = 15000;
// Persisted so a failure can be diagnosed from the files alone, without
// needing someone to read a number off the dashboard mid-stream. Records who
// asked for an overlay page and what browser engine asked - which is the only
// way to tell a Meld request apart from a Chrome one.
const OVERLAY_LOG_FILE = path.join(mConfig.DATA_DIR, 'overlay-requests.json');
const overlayRequests = [];
let overlayLogWrittenAt = 0;

/** Retain bounded request evidence so missing Meld layers can be diagnosed from files. */
function noteOverlayRequest(kind, req, url) {
    overlayRequests.unshift({
        at: new Date().toISOString(),
        kind,
        url: url.pathname + (url.search || ''),
        userAgent: String(req.headers['user-agent'] || '(none)').slice(0, 200),
        referer: String(req.headers.referer || '').slice(0, 200) || null,
        accept: String(req.headers.accept || '').slice(0, 120)
    });
    while (overlayRequests.length > 40) overlayRequests.pop();
    const now = Date.now();
    if (now - overlayLogWrittenAt < 3000) return;
    overlayLogWrittenAt = now;
    try {
        mStorage.writeJson(OVERLAY_LOG_FILE, {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            requests: overlayRequests
        });
    } catch (_error) {
        /* non-fatal */
    }
}

/** Record recent polling overlays, which do not appear among SSE clients. */
function notePoll(src) {
    if (!src) return;
    const name = String(src)
        .slice(0, 24)
        .replace(/[^a-z0-9_-]/gi, '');
    if (!name) return;
    const prior = overlayPolls.get(name) || { count: 0, firstSeen: new Date().toISOString() };
    prior.count += 1;
    prior.lastSeen = new Date().toISOString();
    overlayPolls.set(name, prior);
}

/** Expose recently active polling sources with their freshness information. */
function overlayPollView() {
    const now = Date.now();
    const out = {};
    for (const [name, info] of overlayPolls) {
        out[name] = {
            polling: now - new Date(info.lastSeen).getTime() < OVERLAY_POLL_FRESH_MS,
            count: info.count,
            lastSeen: info.lastSeen,
            firstSeen: info.firstSeen
        };
    }
    return out;
}

Object.assign(exports, { noteOverlayRequest, overlayPollView, notePoll });
