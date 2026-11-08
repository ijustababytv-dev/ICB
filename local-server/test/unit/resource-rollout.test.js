'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../../src/cloud/state-feed');
const resources = require('../../src/resources');
const definitions = require('../../config/resource-trackers.json');
const { gameFact } = require('../../src/domain/game-facts');
const { applyResourceEvent } = require('../../../cloud-server/src/domain/resource-rules');

test('new tracker pages survive an older cloud catalog without inventing progress', (t) => {
    t.mock.method(feed, 'watch', () => ({ resourceTrackers: { cards: [] } }));
    const card = resources.findResourceCard('fish-tacos');
    assert.equal(card.image, 'FISH_TACOS.png');
    assert.equal(card.count, null);
    assert.equal(resources.findResourceCard('unknown-card'), null);
    assert.deepEqual(resources.resourceTrackersView().cards, []);
});

test('confirmed cloud card values and visibility remain authoritative', (t) => {
    const card = { id: 'fish-tacos', count: 37, visible: false };
    t.mock.method(feed, 'watch', () => ({ resourceTrackers: { cards: [card] } }));
    assert.deepEqual(resources.findResourceCard('fish-tacos'), card);
});

test('configured Fish Tacos counts inventory gains once and ignores losses and resyncs', () => {
    const definition = definitions.cards.find((card) => card.id === 'fish-tacos');
    const card = { ...definition, count: definition.startAt };
    const state = { cards: [card] };
    assert.equal(card.count, 100);
    // Transport-shaped fixtures exercise the actual definition; these are not
    // evidence that the supplied token has been observed in a real cooking log.
    applyResourceEvent(state, gameFact('Inventory gained: itemtype_c_fishtacos (1*) x3'));
    assert.equal(card.count, 99);
    for (const line of [
        'Inventory lost: itemtype_c_fishtacos x3',
        'Lockbox gained: itemtype_c_fishtacos x30',
        'Primary gained: itemtype_c_fishtacos x99',
        'Inventory gained: itemtype_c_fishtacos_other x3'
    ]) {
        applyResourceEvent(state, gameFact(line));
        assert.equal(card.count, 99, line);
    }
    card.count = 1;
    const fact = gameFact('Inventory gained: itemtype_c_fishtacos x3');
    applyResourceEvent(state, fact);
    applyResourceEvent(state, fact);
    assert.equal(card.count, 0);
});
