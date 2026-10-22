'use strict';

const mStorage = require('./storage');
const mConfig = require('./config');
const fs = require('node:fs');
const mTodos = require('./todos');
const mEvents = require('./events');

let settings = mStorage.mergeDefaults(
    mConfig.DEFAULT_SETTINGS,
    mStorage.readJson(mConfig.SETTINGS_FILE, mConfig.DEFAULT_SETTINGS)
);
let live = mStorage.mergeDefaults(
    mConfig.DEFAULT_LIVE,
    mStorage.readJson(mConfig.LIVE_FILE, mConfig.DEFAULT_LIVE)
);

let actions = loadActions();
const startedAt = Date.now();

/** Keep only the most recent command records; an absent history starts empty. */
function loadActions() {
    try {
        return fs
            .readFileSync(mConfig.ACTIONS_FILE, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .slice(-100);
    } catch (_error) {
        return [];
    }
}

/** Persist settings separately from live counts so ordinary saves cannot overwrite totals. */
function saveSettings() {
    settings.updatedAt = new Date().toISOString();
    mStorage.writeJson(mConfig.SETTINGS_FILE, settings);
}

/** Persist current live counts and reader metadata without changing settings. */
function saveLive() {
    live.updatedAt = new Date().toISOString();
    mStorage.writeJson(mConfig.LIVE_FILE, live);
}

/** Expose detached settings, live state, todos, and recent command history. */
function publicState() {
    return {
        settings: mStorage.clone(settings),
        live: mStorage.clone(live),
        todos: mStorage.clone(mTodos.todos),
        actions: mStorage.clone(actions.slice(-20))
    };
}

/** Append command audit history and notify dashboard clients. */
function recordAction(action) {
    actions.push(action);
    actions = actions.slice(-100);
    fs.appendFileSync(mConfig.ACTIONS_FILE, `${JSON.stringify(action)}\n`, 'utf8');
    mEvents.broadcast('action', action);
}

/** Persist and broadcast reader metadata only when it actually changes. */
function updateReader(patch) {
    const next = { ...live.reader, ...patch };
    if (JSON.stringify(next) === JSON.stringify(live.reader)) return false;
    live.reader = next;
    saveLive();
    mEvents.broadcast('live', mStorage.clone(live));
    return true;
}

/** Merge a deliberate live-state update, persist it, and notify clients. */
function updateLive(patch) {
    live = mStorage.mergeDefaults(live, patch);
    saveLive();
    mEvents.broadcast('live', mStorage.clone(live));
}

Object.assign(exports, {
    updateReader,
    saveLive,
    startedAt,
    publicState,
    saveSettings,
    recordAction
});

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    live: {
        enumerable: true,
        get: () => live,

        set: (value) => {
            live = value;
        }
    },
    settings: {
        enumerable: true,
        get: () => settings,

        set: (value) => {
            settings = value;
        }
    },
    actions: {
        enumerable: true,
        get: () => actions,

        set: (value) => {
            actions = value;
        }
    }
});
