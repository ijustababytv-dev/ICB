'use strict';
const path = require('node:path');
const config = require('./config');
const feed = require('./cloud/state-feed');
const { serveArt } = require('./assets/public-files');
const definitions = require('../config/resource-trackers.json');
const RESOURCE_ART_DIR = path.join(config.APP_DIR, 'assets/resources');

/** Definitions render artwork immediately; confirmed card values arrive through the shared cache. */
function resourceTrackersView() {
    const cached = feed.watch('/api/resource-trackers')?.resourceTrackers;
    return (
        cached || {
            cards: definitions.cards.map((card) => ({
                ...card,
                count: null,
                slots: card.slots?.map((slot) => ({ ...slot, count: null }))
            })),
            canUndoReset: false
        }
    );
}

/** Static overlay routing needs definitions before sign-in and during cloud errors. */
function findResourceCard(id) {
    return resourceTrackersView().cards.find((card) => card.id === id) || null;
}

/** Artwork bytes stay on this computer. */
function serveResourceArt(res, pathname) {
    return serveArt(res, pathname, '/resource-art/', 'resources');
}

module.exports = { RESOURCE_ART_DIR, resourceTrackersView, findResourceCard, serveResourceArt };
