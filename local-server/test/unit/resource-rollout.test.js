'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../../src/cloud/state-feed');
const resources = require('../../src/resources');
const definitions = require('../../config/resource-trackers.json');
const { gameFact } = require('../../src/domain/game-facts');
const {
    applyResourceEvent,
    resetResourceSession
} = require('../../../cloud-server/src/domain/resource-rules');

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

// Business rule: a Sushi cook line lowers the countdown by exactly one whatever
// the stack size. Selling/eating, full-inventory resyncs and periodic lockbox
// dumps must never move it, and the countdown stops at zero.
test('configured Sushi counts inventory gains once and ignores losses, lockbox and resyncs', () => {
    const definition = definitions.cards.find((card) => card.id === 'sushi');
    const card = { ...definition, count: definition.startAt };
    const state = { cards: [card] };
    assert.equal(card.image, 'Sushi.png');
    assert.equal(card.count, 100);
    applyResourceEvent(state, gameFact('Inventory gained: itemtype_c_sushi (2*) x4'));
    assert.equal(card.count, 99);
    for (const line of [
        'Inventory lost: itemtype_c_sushi x4',
        'Lockbox gained: itemtype_c_sushi x30',
        'Primary gained: itemtype_c_sushi x99',
        'Inventory gained: itemtype_c_sushi_other x3'
    ]) {
        applyResourceEvent(state, gameFact(line));
        assert.equal(card.count, 99, line);
    }
    card.count = 1;
    const fact = gameFact('Inventory gained: itemtype_c_sushi x2');
    applyResourceEvent(state, fact);
    applyResourceEvent(state, fact);
    assert.equal(card.count, 0);
});

// Business rule: the Infected Essence card counts down by every essence collected
// (a stack of 5 takes 5 off), floors at zero, and ignores losses, lockbox dumps
// and full-inventory resyncs.
test('Infected Essence countdown subtracts collected quantity and floors at zero', () => {
    const definition = definitions.cards.find((card) => card.id === 'essence');
    const card = { ...definition, count: 20 };
    const state = { cards: [card] };
    applyResourceEvent(state, gameFact('Inventory gained: itemtype_echo_essence x5'));
    assert.equal(card.count, 15);
    for (const line of [
        'Inventory lost: itemtype_echo_essence x5',
        'Lockbox gained: itemtype_echo_essence x40',
        'Primary gained: itemtype_echo_essence x99'
    ]) {
        applyResourceEvent(state, gameFact(line));
        assert.equal(card.count, 15, line);
    }
    applyResourceEvent(state, gameFact('Inventory gained: itemtype_echo_essence x50'));
    assert.equal(card.count, 0);
});

// Business rule: Chappa's adds every chappa meat looted and only ever counts up.
// Selling/eating, lockbox dumps, resyncs, other meats and Palia logins never move it.
test("Chappa's counts looted meat for life and ignores everything else", () => {
    const definition = definitions.cards.find((card) => card.id === 'chappas');
    const card = { ...definition, count: 0 };
    const state = { cards: [card] };
    applyResourceEvent(state, gameFact('Inventory gained: itemtype_product_meat_chapaa x2'));
    applyResourceEvent(state, gameFact('Inventory gained: itemtype_product_meat_chapaa x1'));
    assert.equal(card.count, 3);
    for (const line of [
        'Inventory lost: itemtype_product_meat_chapaa x3',
        'Lockbox gained: itemtype_product_meat_chapaa x40',
        'Primary gained: itemtype_product_meat_chapaa x99',
        'Inventory gained: itemtype_product_meat_rabbit x5'
    ]) {
        applyResourceEvent(state, gameFact(line));
        assert.equal(card.count, 3, line);
    }
    resetResourceSession(state, 'palia-login');
    assert.equal(card.count, 3);
});
