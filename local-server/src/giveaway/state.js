'use strict';

const mStorage = require('../storage');
const mGiveawayDefaults = require('./defaults');
const mGiveawayBackups = require('./backups');
const mGiveawayActivity = require('./activity');
const mConfig = require('../config');
const mEvents = require('../events');

let giveaway = mStorage.mergeDefaults(
    mGiveawayDefaults.GIVEAWAY_DEFAULTS,
    mGiveawayBackups.loadGiveawayFile()
);
if (!giveaway.windowStartedAt) giveaway.windowStartedAt = new Date().toISOString();
migrateGiveaway();
purgeBlocked();

/** Compare normalized names against the giveaway exclusion list. */
function isBlocked(name) {
    const lower = String(name || '')
        .toLowerCase()
        .replace(/^@/, '');
    return (giveaway.blocked || []).some((b) => String(b).toLowerCase() === lower);
}

// Drop blocked names from entrants and this chat window. Returns names removed.
function purgeBlocked() {
    const removed = [];
    for (const key of Object.keys(giveaway.entrants)) {
        if (isBlocked(key)) {
            removed.push(key);
            delete giveaway.entrants[key];
        }
    }
    for (const key of Object.keys(giveaway.chatActiveThisWindow)) {
        if (isBlocked(key)) delete giveaway.chatActiveThisWindow[key];
    }
    return removed;
}

// Live status of giveaway-listener.html (the Meld layer). Kept in memory only,
// sent to the dashboard so Baby can see before going live that Meld is feeding

const listenerStatus = { lastSeen: null, firehose: 'unknown', lastEventAt: null, lastEvent: null };

// ---- fresh jar each stream, counts roll over ----
function snapshotJar() {
    const snapshot = {};
    for (const [key, e] of Object.entries(giveaway.entrants))
        snapshot[key] = { counts: mStorage.clone(e.counts), manual: e.manualTickets || 0 };
    giveaway.jarBaseline = {
        night: mGiveawayActivity.nightKey(new Date()),
        startedAt: new Date().toISOString(),
        snapshot
    };
}

// New stream day (6 AM cutoff, same as the nightly report) -> empty jar.
function ensureJarBaseline() {
    if (
        !giveaway.jarBaseline ||
        giveaway.jarBaseline.night !== mGiveawayActivity.nightKey(new Date())
    ) {
        snapshotJar();
        saveGiveaway();
    }
}

// Priced at today's rates so a rate change never makes the jar jump.
function snapshotTotal(snap) {
    const r = giveaway.rates,
        c = snap.counts || {};
    return (
        (c.chatWindows || 0) * r.chatWindow +
        (c.subMonths || 0) * r.subMonth +
        (c.giftedSubs || 0) * r.giftedSub +
        Math.floor((c.bits || 0) / r.bitsPerUnicorn) +
        (snap.manual || 0)
    );
}

/** Show only tickets earned since the display baseline, leaving lifetime totals intact. */
function jarView() {
    ensureJarBaseline();
    const counts = {};
    let total = 0;
    for (const [key, e] of Object.entries(giveaway.entrants)) {
        const snap = giveaway.jarBaseline.snapshot[key];
        const n = Math.max(0, entrantTotal(e) - (snap ? snapshotTotal(snap) : 0));
        if (n > 0) {
            counts[e.username] = n;
            total += n;
        }
    }
    return {
        night: giveaway.jarBaseline.night,
        startedAt: giveaway.jarBaseline.startedAt,
        counts,
        total
    };
}

/** Return detached giveaway data plus transient listener and jar information. */
function publicGiveaway() {
    return { ...mStorage.clone(giveaway), listener: { ...listenerStatus }, jar: jarView() };
}

/** Truncate and bound finite rates; use the existing default for invalid numbers. */
function cleanRate(value, fallback, min, max) {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Older giveaway.json files stored ticket totals only. Turn them back into
// counts using the rates that were live then (chat 1, sub 1, gift 2,
// 100 bits = 1), so the new rates can re-price them.
function migrateGiveaway() {
    const r = giveaway.rates;
    r.chatWindow = cleanRate(r.chatWindow, 1, 0, 100);
    r.subMonth = cleanRate(r.subMonth, 2, 0, 100);
    r.giftedSub = cleanRate(r.giftedSub, 4, 0, 100);
    r.bitsPerUnicorn = cleanRate(r.bitsPerUnicorn, 100, 1, 100000);
    for (const key of Object.keys(giveaway.entrants)) {
        const e = giveaway.entrants[key];
        if (!e.counts) {
            e.counts = {
                chatWindows: e.chatTickets || 0,
                subMonths: e.subTickets || 0,
                giftedSubs: Math.round((e.giftTickets || 0) / 2),
                bits: (e.bitsTickets || 0) * 100
            };
        }
        if (typeof e.note !== 'string') e.note = '';
        if (typeof e.manualTickets !== 'number') e.manualTickets = 0;
        recomputeEntrant(e);
    }
    // Names on unicorns shipped briefly as ON; Baby asked for them off. Flip saved
    // copies off once, after which the dashboard toggle is respected.
    if (!giveaway.display.namesOffV2) {
        giveaway.display.showNames = false;
        giveaway.display.namesOffV2 = true;
    }
    const oldTicker = 'Sub = 1 fluffy unicorn. Gift a sub = 2 fluffy unicorns EACH!';
    const t = giveaway.display.tickerMessages;
    if (Array.isArray(t)) {
        const i = t.indexOf(oldTicker);
        if (i >= 0) t[i] = 'Sub = 2 fluffy unicorns a month. Gift a sub = 4 fluffy unicorns EACH!';
    }
}

/** Price earned counts at current rates and prevent manual deductions from making totals negative. */
function recomputeEntrant(e) {
    const r = giveaway.rates,
        c = e.counts;
    e.chatTickets = c.chatWindows * r.chatWindow;
    e.subTickets = c.subMonths * r.subMonth;
    e.giftTickets = c.giftedSubs * r.giftedSub;
    e.bitsTickets = Math.floor(c.bits / r.bitsPerUnicorn);
    // Hand take-aways can go negative to correct earned unicorns, never below a 0 total.
    const earned = e.chatTickets + e.subTickets + e.giftTickets + e.bitsTickets;
    if (e.manualTickets < -earned) e.manualTickets = -earned;
    return e;
}

/** Persist the active giveaway state independently of tracker settings. */
function saveGiveaway() {
    mStorage.writeJson(mConfig.GIVEAWAY_FILE, giveaway);
}

/** Persist ticket changes before updating dashboards and overlays. */
function broadcastGiveaway() {
    saveGiveaway();
    mEvents.broadcast('giveaway', publicGiveaway());
}

// Case-insensitive: "bob" from the dashboard and "Bob" from chat are one person.
function findEntrantKey(username) {
    if (giveaway.entrants[username]) return username;
    const lower = String(username).toLowerCase();
    return Object.keys(giveaway.entrants).find((k) => k.toLowerCase() === lower) || null;
}

/** Reuse case-insensitive entrants or create a zero-count record for a new viewer. */
function ensureEntrant(username) {
    const existing = findEntrantKey(username);
    if (existing) return giveaway.entrants[existing];
    {
        giveaway.entrants[username] = {
            username,
            counts: { chatWindows: 0, subMonths: 0, giftedSubs: 0, bits: 0 },
            note: '',
            chatTickets: 0,
            subTickets: 0,
            giftTickets: 0,
            bitsTickets: 0,
            manualTickets: 0,
            mysteryOutfitWon: false,
            lastSeenAt: null
        };
    }
    return giveaway.entrants[username];
}

/** Sum earned and manual ticket components used by the weighted drawing pool. */
function entrantTotal(entrant) {
    return (
        entrant.chatTickets +
        entrant.subTickets +
        entrant.giftTickets +
        entrant.bitsTickets +
        entrant.manualTickets
    );
}

// Every CHAT_WINDOW_MS, anyone who chatted at least once since the last
// tick gets exactly 1 ticket, then the window clears. This is deliberately
// NOT per-message - spamming chat doesn't earn extra tickets, only being
// present across separate windows does.
/** Award one earned chat window per active, unblocked viewer, then clear the window. */
function awardChatWindow() {
    const activeUsers = Object.keys(giveaway.chatActiveThisWindow).filter((u) => !isBlocked(u));
    for (const username of activeUsers) {
        const entrant = ensureEntrant(username);
        entrant.counts.chatWindows += 1;
        recomputeEntrant(entrant);
    }
    if (activeUsers.length)
        mGiveawayActivity.logActivity({
            type: 'chat_unicorns',
            usernames: activeUsers,
            each: giveaway.rates.chatWindow
        });
    giveaway.chatActiveThisWindow = {};
    giveaway.windowStartedAt = new Date().toISOString();
    if (activeUsers.length) broadcastGiveaway();
    else saveGiveaway();
}

Object.assign(exports, {
    listenerStatus,
    findEntrantKey,
    isBlocked,
    publicGiveaway,
    ensureEntrant,
    saveGiveaway,
    entrantTotal,
    recomputeEntrant,
    broadcastGiveaway,
    snapshotJar,
    jarView,
    purgeBlocked,
    cleanRate,
    migrateGiveaway
});

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    giveaway: {
        enumerable: true,
        get: () => giveaway,

        set: (value) => {
            giveaway = value;
        }
    }
});

exports.awardChatWindow = awardChatWindow;
