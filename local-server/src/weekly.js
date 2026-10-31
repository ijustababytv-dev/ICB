'use strict';

const rules = require('./domain/weekly-rules');

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mDomainWeek = require('./domain/week');
const mStorage = require('./storage');
const mEvents = require('./events');

// ---------------------------------------------------------------------------
// WEEKLY ACCOMPLISHMENTS
//
// A fixed checklist that is the same every week, ticked off as Baby completes
// things, wiped at Palia's weekly reset.
//
// WHAT CAN AND CANNOT BE AUTOMATIC — established by reading 30 of Baby's real
// logs on 2026-08-19, do not re-litigate:
//   * Anything measured by ITEMS ARRIVING IN HER BAG is automatic — the
//     Inventory/Lockbox "gained" lines are dense and reliable across every log.
//   * Anything measured by AN ACTIVITY HAPPENING is not. The log never names or
//     counts another player - zero hits for party/teammate/group across every
//     file - so every "with Friends" item is manual, permanently.
//   * Quests are invisible. `WeeklyWantsUpdatedEvent fired` is the entire line;
//     it never says which want or whether it completed.
//
// The week rolls over MONDAY 04:00 UTC (Palia's own reset). Anchored to UTC so
// daylight saving cannot drift it by an hour twice a year.
// ---------------------------------------------------------------------------
const WEEKLY_CONFIG_FILE = path.join(
    mConfig.APP_DIR,
    'local-server',
    'config',
    'weekly-accomplishments.json'
);
const WEEKLY_STATE_FILE = path.join(mConfig.DATA_DIR, 'weekly-accomplishments.json');

/** Read the weekly definitions and reset anchor from the canonical config. */
function weeklyConfig() {
    return JSON.parse(fs.readFileSync(WEEKLY_CONFIG_FILE, 'utf8'));
}

// The start of the week that `at` falls inside, as an ISO string.

/** Merge saved progress into current definitions by ID without losing newly added goals. */
function loadWeekly() {
    const cfg = weeklyConfig();
    let saved = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(WEEKLY_STATE_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') saved = parsed;
    } catch (_error) {
        /* first run */
    }
    const progress = saved.progress || {};
    return {
        schemaVersion: 1,
        weekStart: saved.weekStart || mDomainWeek.weekStartFor(new Date(), cfg),
        // Config owns the checklist, state owns the ticks.
        items: (cfg.items || []).map((def) => ({
            ...def,
            count: Number(progress[def.id]?.count) || 0,
            done: Boolean(progress[def.id]?.done)
        })),
        previous: saved.previous || null,
        lastResetAt: saved.lastResetAt || null,
        updatedAt: saved.updatedAt || null
    };
}

let weekly = loadWeekly();

/** Derive completion from targets while honoring manual goals and exposing the next reset. */
function weeklyView() {
    const view = mStorage.clone(weekly);
    const cfg = weeklyConfig();
    view.items = view.items.map((item) => ({
        ...item,
        // A collect item is done when it reaches its target; a manual one when
        // Baby says so.
        done: item.type === 'manual' ? Boolean(item.done) : item.count >= Number(item.target || 1)
    }));
    view.total = view.items.length;
    view.completed = view.items.filter((i) => i.done).length;
    view.nextResetAt = new Date(
        new Date(view.weekStart).getTime() + 7 * 24 * 3600 * 1000
    ).toISOString();
    view.canUndoReset = Boolean(view.previous);
    view.weekStartsUtc = cfg.weekStartsUtc;
    return view;
}

/** Persist weekly progress and undo information without modifying goal definitions. */
function saveWeekly() {
    weekly.updatedAt = new Date().toISOString();
    const progress = {};
    for (const item of weekly.items)
        progress[item.id] = { count: item.count, done: Boolean(item.done) };
    mStorage.writeJson(WEEKLY_STATE_FILE, {
        schemaVersion: 1,
        weekStart: weekly.weekStart,
        progress,
        previous: weekly.previous,
        lastResetAt: weekly.lastResetAt,
        updatedAt: weekly.updatedAt
    });
}

try {
    saveWeekly();
} catch (_error) {
    /* non-fatal */
}

/** Persist weekly progress before notifying connected dashboards. */
function broadcastWeekly() {
    saveWeekly();
    mEvents.broadcast('weekly', weeklyView());
}

// Called on a timer as well as on log activity, so a rollover still happens on
// a quiet night. If the server was off across the boundary it catches up on the
// next start rather than skipping the week.
/** Catch up after a missed boundary, including when no log events arrive. */
function rolloverWeeklyIfDue() {
    if (!rules.rolloverWeek(weekly, new Date(), weeklyConfig())) return false;
    broadcastWeekly();
    return true;
}

/** Restore the saved week and clear its one-use undo snapshot. */
function undoWeeklyReset() {
    if (!rules.undoWeeklyReset(weekly)) return false;
    broadcastWeekly();
    return true;
}

/** Apply weekly progress; persistence and broadcasts belong to the reader. */
function weeklyScan(line) {
    return rules.applyWeeklyEvent(weekly, line);
}

/** Resolve a weekly goal by ID or report that it does not exist. */
function findWeeklyItem(id) {
    return weekly.items.find((i) => i.id === id) || null;
}

Object.assign(exports, {
    weeklyScan,
    broadcastWeekly,
    weeklyView,
    rolloverWeeklyIfDue,
    undoWeeklyReset,
    findWeeklyItem
});

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    weekly: {
        enumerable: true,
        get: () => weekly,

        set: (value) => {
            weekly = value;
        }
    }
});
