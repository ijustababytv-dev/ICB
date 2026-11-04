'use strict';
const feed = require('./cloud/state-feed');
const config = require('./config');
const { mergeDefaults } = require('./storage');
const events = require('./events');
const startedAt = Date.now();
let reader = structuredClone(config.DEFAULT_LIVE.reader);
const actions = [];

/** Reader diagnostics remain local RAM; confirmed balances come only from the cloud cache. */
function liveState() {
    feed.watch('/api/live');
    const live = mergeDefaults(config.DEFAULT_LIVE, feed.document('live.json') || {});
    const required = !!live.reconciliation?.required;
    return {
        ...live,
        reader: {
            ...reader,
            state: required
                ? 'needs-reconciliation'
                : reader.state === 'needs-reconciliation'
                ? 'offline'
                : reader.state
        }
    };
}

/** Static preferences let artwork render while authenticated state is still loading. */
function settingsState() {
    feed.watch('/api/settings');
    return mergeDefaults(config.DEFAULT_SETTINGS, feed.document('settings.json') || {});
}

/** Expose detached confirmed DTOs without granting callers a writable progress store. */
function publicState() {
    feed.watch('/api/state');
    return {
        settings: settingsState(),
        live: liveState(),
        todos: feed.document('todos.json') || { daily: [], weekly: [] },
        actions: structuredClone(actions)
    };
}

/** Publish connection/file diagnostics without rewriting a feature JSON file. */
function updateReader(patch) {
    const next = { ...reader, ...patch };
    if (JSON.stringify(next) === JSON.stringify(reader)) return false;
    reader = next;
    events.broadcast('live', liveState());
    return true;
}

/** Local operator diagnostics use bounded RAM, without another persistent action log. */
function recordAction(action) {
    actions.push(action);
    if (actions.length > 20) actions.shift();
    events.broadcast('action', action);
}

Object.assign(exports, { publicState, updateReader, recordAction, startedAt });
events.adapt('live', () => liveState());
events.adapt('snapshot', () => publicState());
Object.defineProperties(exports, {
    live: { get: liveState },
    settings: { get: settingsState },
    actions: { get: () => structuredClone(actions) }
});
