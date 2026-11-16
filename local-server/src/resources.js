'use strict';
const path = require('node:path');
const config = require('./config');
const feed = require('./cloud/state-feed');
const { serveArt } = require('./assets/public-files');
const definitions = require('../config/resource-trackers.json');
const RESOURCE_ART_DIR = path.join(config.APP_DIR, 'assets/resources');

/**
 * Where the number sits on the artwork and its colour are a look, not progress. The cloud
 * keeps the counts, but a card the cloud already knows takes its artwork, number box and
 * number colour from this computer's config, so a new art swap lines up before the next
 * cloud release. Counts, visibility, mode and every counting rule still come from the cloud.
 */
function withLocalLook(card) {
    const definition = definitions.cards.find((item) => item.id === card.id);
    if (!definition) return card;
    const look = { ...card };
    for (const key of ['image', 'valueBox']) {
        if (card[key] !== undefined && definition[key] !== undefined) look[key] = definition[key];
    }
    if (definition.valueColor !== undefined) look.valueColor = definition.valueColor;
    if (Array.isArray(card.slots) && Array.isArray(definition.slots)) {
        look.slots = card.slots.map((slot) => {
            const box = definition.slots.find((item) => item.id === slot.id)?.valueBox;
            return box && slot.valueBox ? { ...slot, valueBox: box } : slot;
        });
    }
    return look;
}

/** Definitions render artwork immediately; confirmed card values arrive through the shared cache. */
function resourceTrackersView() {
    const cached = feed.watch('/api/resource-trackers')?.resourceTrackers;
    if (cached) return { ...cached, cards: (cached.cards || []).map(withLocalLook) };
    return {
        cards: definitions.cards.map((card) => ({
            ...card,
            count: null,
            slots: card.slots?.map((slot) => ({ ...slot, count: null }))
        })),
        canUndoReset: false
    };
}

/** Static overlay routing needs definitions before sign-in and during cloud errors. */
function findResourceCard(id) {
    const confirmed = resourceTrackersView().cards.find((card) => card.id === id);
    if (confirmed) return confirmed;
    // A local definition can arrive before the cloud release. Keep its artwork
    // reachable without inventing progress or introducing local counting rules.
    const definition = definitions.cards.find((card) => card.id === id);
    return definition
        ? {
              ...definition,
              count: null,
              slots: definition.slots?.map((slot) => ({ ...slot, count: null }))
          }
        : null;
}

/** Artwork bytes stay on this computer. */
function serveResourceArt(res, pathname) {
    return serveArt(res, pathname, '/resource-art/', 'resources');
}

module.exports = { RESOURCE_ART_DIR, resourceTrackersView, findResourceCard, serveResourceArt };
