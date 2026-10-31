'use strict';
const feed = require('../cloud/state-feed');
const listenerStatus = { lastSeen: null, firehose: 'unknown', lastEventAt: null, lastEvent: null };

/** Visual filters read confirmed preferences; ticket math never runs on the PC. */
function isBlocked(name) {
    return (feed.document('giveaway.json')?.blocked || []).some(
        (entry) => entry.toLowerCase() === String(name).toLowerCase()
    );
}

/** Subscriber artwork reads confirmed supporter metadata without changing an award. */
function findEntrantKey(name) {
    return (
        Object.keys(feed.document('giveaway.json')?.entrants || {}).find(
            (entry) => entry.toLowerCase() === String(name).toLowerCase()
        ) || null
    );
}

/** Retain listener health locally and relay the cloud's public giveaway DTO. */
function publicGiveaway() {
    return {
        ...(feed.watch('/api/giveaway/state')?.giveaway || {}),
        listener: structuredClone(listenerStatus)
    };
}

module.exports = { isBlocked, findEntrantKey, publicGiveaway, listenerStatus };
require('../events').adapt('giveaway', (giveaway) => ({
    ...giveaway,
    listener: structuredClone(listenerStatus)
}));
Object.defineProperty(module.exports, 'giveaway', {
    get: () => feed.document('giveaway.json') || { entrants: {}, winners: [], blocked: [] }
});
