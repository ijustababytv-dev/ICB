'use strict';

const rules = require('./domain/resource-rules');

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');
const mState = require('./state');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpStatic = require('./http/static');

// ---------------------------------------------------------------------------
// RESOURCE TRACKERS — one card per resource, each its own Meld layer.
//
// Every token in config/resource-trackers.json was read out of a real
// Inventory/Lockbox line in Baby's own logs. Never add a guessed one: a wrong
// token is a card that sits at zero all stream and looks like a bug.
//
// Two modes:
//   lifetime — never resets. Amber Echo and Infected Essence only. These read
//              their value from the EXISTING live.resources totals rather than
//              counting separately, so there is exactly one number for each
//              and the reconciliation controls keep working.
//   session  — starts at 0 each time Baby logs into Palia. The previous value
//              is kept so a reset can be undone with one click; she logged in
//              11 times in a single day, so silently wiping counts is not safe.
// ---------------------------------------------------------------------------
const RESOURCE_CARDS_FILE = path.join(mConfig.APP_DIR, 'config', 'resource-trackers.json');
const RESOURCE_STATE_FILE = path.join(mConfig.DATA_DIR, 'resource-trackers.json');
const RESOURCE_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'resources');
// Verified against every log Baby has: these two strings appear ONLY when the
// game is starting up, never on zone travel. app-20260818.log contains no
// other MAP_ value at all.
const LOGIN_PATTERN = /MAP_IntroMovie|MAP_PreGame/;
// One login produces several of these lines within a few seconds; without this
// window a single login would fire several resets in a row.

/** Load tracker definitions from config without importing saved progress into the definitions. */
function resourceCardDefs() {
    const cfg = JSON.parse(fs.readFileSync(RESOURCE_CARDS_FILE, 'utf8'));
    return Array.isArray(cfg.cards) ? cfg.cards : [];
}

/** Merge progress by card/slot ID; countdown stocks restart at their configured batch size. */
function loadResourceTrackers() {
    const defs = resourceCardDefs();
    let saved = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(RESOURCE_STATE_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') saved = parsed;
    } catch (_error) {
        /* first run */
    }
    const counts = saved.counts || {};
    const previous = saved.previous || {};
    const secondaryCounts = saved.secondaryCounts || {};
    const slotCounts = saved.slotCounts || {};
    return {
        schemaVersion: 1,
        // Config owns the definitions, state owns the progress - so a token can be
        // corrected without wiping a live count. Exception: 'countdown' cards
        // (e.g. Sashimi) are deliberately NOT restored from disk - Baby asked for
        // these to snap back to their starting stock every time the server
        // restarts, not persist like every other card.
        cards: defs.map((def) => ({
            ...def,
            // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) have NO
            // single count - each slot (Ash Wood, Stone, ...) tracks its own number
            // against its own spot on the card art, so `count` is skipped entirely
            // for these and `slots` carries each one's persisted count instead.
            ...(Array.isArray(def.slots)
                ? {
                      slots: def.slots.map((slot) => ({
                          ...slot,
                          count: Number((slotCounts[def.id] || {})[slot.id]) || 0
                      }))
                  }
                : {
                      count:
                          def.mode === 'countdown'
                              ? Number(def.startAt) || 0
                              : Number(counts[def.id]) || 0
                  }),
            // A card's optional 'secondary' count (e.g. Ramen Plush's "Ramen Cooked"
            // count riding alongside its Plushies count in the same box) is its own
            // independent, never-auto-reset number - not part of `counts`.
            ...(def.secondary ? { secondaryCount: Number(secondaryCounts[def.id]) || 0 } : {}),
            visible:
                saved.visible && def.id in saved.visible
                    ? Boolean(saved.visible[def.id])
                    : def.visible !== false
        })),
        counts: { ...counts },
        secondaryCounts: { ...secondaryCounts },
        slotCounts: { ...slotCounts },
        previous: { ...previous },
        lastLoginAt: saved.lastLoginAt || null,
        lastResetAt: saved.lastResetAt || null,
        canUndoReset: Boolean(previous && Object.keys(previous).length),
        updatedAt: saved.updatedAt || null
    };
}

let resourceTrackers = loadResourceTrackers();
let lastLoginSeenMs = 0;

// Lifetime cards mirror the existing reconciled totals instead of keeping a
// second, competing number.
const { LIFETIME_SOURCE } = rules;

/** Expose detached cards and mirror reconciled lifetime totals instead of counting them twice. */
function resourceTrackersView() {
    const view = mStorage.clone(resourceTrackers);
    for (const card of view.cards) {
        const key = LIFETIME_SOURCE[card.id];
        if (card.mode === 'lifetime' && key) {
            const value = mState.live.resources ? mState.live.resources[key] : null;
            card.count = Number.isFinite(Number(value)) ? Number(value) : 0;
            card.source = `live.resources.${key}`;
        }
    }
    return view;
}

/** Persist counts, visibility, secondary progress, and the one-use reset snapshot. */
function saveResourceTrackers() {
    resourceTrackers.updatedAt = new Date().toISOString();
    for (const card of resourceTrackers.cards) {
        if (!Array.isArray(card.slots)) resourceTrackers.counts[card.id] = card.count;
    }
    resourceTrackers.secondaryCounts = resourceTrackers.secondaryCounts || {};
    for (const card of resourceTrackers.cards) {
        if (card.secondary) resourceTrackers.secondaryCounts[card.id] = card.secondaryCount || 0;
    }
    resourceTrackers.slotCounts = resourceTrackers.slotCounts || {};
    for (const card of resourceTrackers.cards) {
        if (!Array.isArray(card.slots)) continue;
        const entry = {};
        for (const slot of card.slots) entry[slot.id] = slot.count || 0;
        resourceTrackers.slotCounts[card.id] = entry;
    }
    const visible = {};
    for (const card of resourceTrackers.cards) visible[card.id] = card.visible !== false;
    mStorage.writeJson(RESOURCE_STATE_FILE, {
        schemaVersion: 1,
        counts: resourceTrackers.counts,
        secondaryCounts: resourceTrackers.secondaryCounts,
        slotCounts: resourceTrackers.slotCounts,
        previous: resourceTrackers.previous,
        visible,
        lastLoginAt: resourceTrackers.lastLoginAt,
        lastResetAt: resourceTrackers.lastResetAt,
        updatedAt: resourceTrackers.updatedAt
    });
}

try {
    saveResourceTrackers();
} catch (_error) {
    /* non-fatal */
}

/** Persist progress before notifying dashboards and refresh undo availability. */
function broadcastResourceTrackers() {
    resourceTrackers.canUndoReset = Boolean(Object.keys(resourceTrackers.previous || {}).length);
    saveResourceTrackers();
    mEvents.broadcast('resourcetrackers', resourceTrackersView());
}

/** Save an undo snapshot before clearing session cards; lifetime totals are untouched. */
function resetResourceSession(reason) {
    rules.resetResourceSession(resourceTrackers, reason);
    broadcastResourceTrackers();
}

/** Restore the previous session counts at most once. */
function undoResourceReset() {
    if (!rules.undoResourceReset(resourceTrackers)) return false;
    broadcastResourceTrackers();
    return true;
}

/** Reset once per login, then apply only real inventory events. */
function resourceTrackerScan(line) {
    if (LOGIN_PATTERN.test(line)) {
        const now = Date.now();
        if (rules.loginResetDue(lastLoginSeenMs, now)) {
            lastLoginSeenMs = now;
            resourceTrackers.lastLoginAt = new Date(now).toISOString();
            resetResourceSession('palia-login');
        }
        return false;
    }
    return rules.applyResourceEvent(resourceTrackers, line);
}

/** Resolve a configured card ID, returning null for an unknown overlay path. */
function findResourceCard(id) {
    return resourceTrackers.cards.find((c) => c.id === id) || null;
}

/** Serve only a resource artwork filename from the local resource directory. */
function serveResourceArt(res, pathname) {
    let name;
    try {
        name = path.basename(decodeURIComponent(pathname.slice('/resource-art/'.length)));
    } catch (_error) {
        return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Invalid art name.' });
    }
    const file = path.join(RESOURCE_ART_DIR, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
    res.writeHead(200, {
        'Content-Type':
            mHttpStatic.MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });
    return res.end(fs.readFileSync(file));
}

Object.assign(exports, {
    resourceTrackerScan,
    broadcastResourceTrackers,
    RESOURCE_ART_DIR,
    serveResourceArt,
    findResourceCard,
    resourceTrackersView,
    resetResourceSession,
    undoResourceReset,
    RESOURCE_CARDS_FILE,
    LIFETIME_SOURCE
});

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    resourceTrackers: {
        enumerable: true,
        get: () => resourceTrackers,

        set: (value) => {
            resourceTrackers = value;
        }
    }
});
