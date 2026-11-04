'use strict';
const events = require('../events');
const fingerprints = new Map();
const ROUTES = {
    '/api/state': ['snapshot'],
    '/api/settings': ['settings', 'settings'],
    '/api/live': ['live', 'live'],
    '/api/todos': ['todos', 'todos'],
    '/api/weekly': ['weekly', 'weekly'],
    '/api/resource-trackers': ['resource-trackers', 'resourceTrackers'],
    '/api/giveaway/state': ['giveaway', 'giveaway'],
    '/api/sprite-tv': ['spritetv'],
    '/api/decor/state': ['decor'],
    '/api/hub': ['hub'],
    '/api/tradeup/state': ['tradeup'],
    '/api/party': ['party'],
    '/api/sashimi': ['sashimi'],
    '/api/beanburger-signup': ['beanburger-signup'],
    '/api/flowtree-signup': ['flowtree-signup'],
    '/api/steam': ['steam'],
    '/api/aniimo': ['aniimo'],
    '/api/sprites': ['sprites'],
    '/api/randomizer': ['randomizer']
};

/** Local HTTP and SSE decorate the same confirmed data with machine-only reader/listener diagnostics. */
function localize(path, packet) {
    if (!packet || packet.ok === false) return packet;
    if (typeof packet.now === 'number')
        packet = {
            ...packet,
            now: require('./clock').now()
        };
    const route = ROUTES[path.split('?')[0]];
    if (!route) return packet;
    const [event, key] = route;
    return key
        ? { ...packet, [key]: events.localize(event, packet[key]) }
        : events.localize(event, packet);
}

/** Preserve existing dashboard events without rebuilding unchanged forms on every clock-only poll. */
function broadcast(views) {
    for (const [path, packet] of Object.entries(views || {})) {
        const route = ROUTES[path.split('?')[0]];
        if (!route || packet?.ok === false) continue;
        const fingerprint = JSON.stringify(packet, (key, value) =>
            key === 'now' ? undefined : value
        );
        if (fingerprints.get(path) === fingerprint) continue;
        fingerprints.set(path, fingerprint);
        events.broadcast(route[0], route[1] ? packet[route[1]] : packet);
    }
}

module.exports = { localize, broadcast, reset: () => fingerprints.clear() };
