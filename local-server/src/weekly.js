'use strict';
const feed = require('./cloud/state-feed');
const definitions = require('../config/weekly-accomplishments.json');

/** Render goal labels locally while all values and reset decisions remain cloud-owned. */
function weeklyView() {
    return (
        feed.watch('/api/weekly')?.weekly || {
            items: definitions.items.map((item) => ({ ...item, count: null, done: false })),
            completed: 0,
            total: definitions.items.length,
            canUndoReset: false
        }
    );
}

module.exports = { weeklyView };
