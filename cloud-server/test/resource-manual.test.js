'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/domain/resource-rules');

const cards = () => ({
    cards: [
        { id: 'profit-tracker', mode: 'lifetime', manual: true, tokens: [], count: 12500 },
        { id: 'clay', mode: 'lifetime', tokens: ['itemtype_mineral_rock_clay'], count: 1 }
    ]
});

const event = (token, direction) => ({
    source: 'inventory',
    direction,
    items: [{ token, quantity: 3, star: false }]
});

test('a manual tracker with no tokens never moves on game log events', () => {
    const state = cards();
    assert.equal(
        rules.applyResourceEvent(state, event('itemtype_mineral_rock_clay', 'gained')),
        true
    );
    assert.equal(state.cards[0].count, 12500);
    assert.equal(state.cards[1].count, 4);
    rules.applyResourceEvent(state, event('itemtype_c_sushi', 'lost'));
    assert.equal(state.cards[0].count, 12500);
});

test('a Palia login session reset leaves a manual lifetime total alone', () => {
    const state = cards();
    rules.resetResourceSession(state, 'palia-login');
    assert.equal(state.cards[0].count, 12500);
    assert.equal(state.cards[1].count, 1);
});
