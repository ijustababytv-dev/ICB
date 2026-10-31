'use strict';
const { replaceRows, readRows } = require('./rows');

const COLLECTIONS = {
    'aniimo-dex': { roster: 'array', checked: 'object', recent: 'array' },
    sprites: { sprites: 'array', caught: 'object', recent: 'array' },
    avatars: { assign: 'object' },
    walkers: { people: 'object' },
    decor: { effects: 'array', presets: 'array' },
    parties: { names: 'object', events: 'array', slots: 'array' },
    'sashimi-signin': { names: 'object' },
    steam: {
        schema: 'object',
        statDefs: 'object',
        stats: 'object',
        rarity: 'object'
    },
    'tradeup-config': { items: 'array' },
    'tradeup-state': { board: 'array', log: 'array' }
};

/** Persist semantic collection entities as separate owner/feature/entry rows, never a raw source envelope. */
async function saveCollections(client, owner, feature, document) {
    const handled = new Set();
    for (const [key, shape] of Object.entries(COLLECTIONS[feature] || {})) {
        const value = document[key] || (shape === 'array' ? [] : {});
        const entries = Object.entries(value);
        await replaceRows(
            client,
            'collection_entries',
            owner,
            entries.map(([id, item], position) => ({
                feature: feature + ':' + key,
                id,
                position,
                details: { value: item }
            })),
            { feature: feature + ':' + key }
        );
        handled.add(key);
    }
    return handled;
}

/** Rebuild collection fields in stable order without mixing independently owned features. */
async function loadCollections(client, owner, documents, byFeature) {
    const rows = await readRows(client, 'collection_entries', owner);
    for (const [feature, fields] of Object.entries(COLLECTIONS)) {
        const entry = byFeature.get(feature);
        if (!entry || !documents[entry.file]) continue;
        for (const [key, shape] of Object.entries(fields)) {
            const selected = rows
                .filter((row) => row.feature === feature + ':' + key)
                .sort((a, b) => a.position - b.position);
            documents[entry.file][key] =
                shape === 'array'
                    ? selected.map((row) => row.details.value)
                    : Object.fromEntries(selected.map((row) => [row.id, row.details.value]));
        }
    }
}

module.exports = { COLLECTIONS, saveCollections, loadCollections };
