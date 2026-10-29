'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../../server/domain/resource-rules');

/** Use known log tokens with small in-memory counts; no test touches live tracker files. */
function card(overrides = {}) {
    return {
        id: 'gold-ore',
        tokens: ['itemtype_mineral_ore_gold'],
        mode: 'session',
        count: 10,
        ...overrides
    };
}

/** Apply an isolated line and return the changed card for focused assertions. */
function scan(value, line) {
    rules.applyResourceEvent({ cards: [value] }, line);
    return value;
}

test('session resources add gains, subtract losses, and floor at zero', () => {
    const value = card();
    scan(value, 'Inventory gained: itemtype_mineral_ore_gold x7');
    assert.equal(value.count, 17);
    scan(value, 'Lockbox lost: itemtype_mineral_ore_gold x30');
    assert.equal(value.count, 0);
});
test('unrelated lines do not report a change', () => {
    const state = { cards: [card()] };
    assert.equal(
        rules.applyResourceEvent(state, 'Primary gained: itemtype_mineral_ore_gold x999'),
        false
    );
    assert.equal(
        rules.applyResourceEvent(state, 'Inventory gained: itemtype_currency_gold x999'),
        false
    );
    assert.equal(state.cards[0].count, 10);
});
test('lifetime mirror cards leave counting to the reconciled live resource', () => {
    assert.equal(
        scan(
            card({ id: 'amber-echo', mode: 'lifetime', tokens: ['itemtype_currency_echo_amber'] }),
            'Inventory gained: itemtype_currency_echo_amber x20'
        ).count,
        10
    );
});
for (const direction of ['gained', 'lost']) {
    test(`countdowns subtract on their configured ${direction} event only`, () => {
        const value = card({ mode: 'countdown', direction, count: 2 });
        scan(
            value,
            `Inventory ${direction === 'gained' ? 'lost' : 'gained'}: itemtype_mineral_ore_gold x8`
        );
        assert.equal(value.count, 2);
        scan(value, `Inventory ${direction}: itemtype_mineral_ore_gold x8`);
        assert.equal(value.count, 0);
    });
}
test('cooking event countdowns count one cook rather than three dishes', () => {
    const value = card({
        mode: 'countdown',
        countEvents: true,
        tokens: ['itemtype_c_sashimi'],
        direction: 'gained'
    });
    scan(value, 'Inventory gained: itemtype_c_sashimi (1*) x3');
    assert.equal(value.count, 9);
});
test('inventory-only trackers ignore full lockbox dumps', () => {
    const value = card({ eventSource: 'inventory' });
    scan(value, 'Lockbox gained: itemtype_mineral_ore_gold x40');
    assert.equal(value.count, 10);
    scan(value, 'Inventory gained: itemtype_mineral_ore_gold x2');
    assert.equal(value.count, 12);
});
test('star-only cards require the quality marker on their own token', () => {
    const value = card({ starOnly: true });
    scan(value, 'Inventory gained: itemtype_mineral_ore_gold x2 itemtype_echo_essence (1*) x4');
    assert.equal(value.count, 10);
    scan(value, 'Inventory gained: itemtype_mineral_ore_gold (1*) x2');
    assert.equal(value.count, 12);
});
test('secondary cook counts have independent direction and quality rules', () => {
    const value = card({
        direction: 'lost',
        starOnly: true,
        secondaryCount: 2,
        secondary: { tokens: ['itemtype_c_sashimi'], direction: 'gained', countEvents: true }
    });
    scan(value, 'Inventory gained: itemtype_c_sashimi x3');
    assert.equal(value.count, 10);
    assert.equal(value.secondaryCount, 3);
});
test('collection families sum matching species and honor gains-only filtering', () => {
    const value = card({
        direction: 'gained',
        tokens: [],
        slots: [{ id: 'bugs', tokenPrefix: 'itemtype_bug_', count: 0 }]
    });
    scan(value, 'Inventory gained: itemtype_bug_beer x2 itemtype_bug_ladybeetle (1*) x3');
    scan(value, 'Inventory lost: itemtype_bug_beer x2');
    assert.equal(value.slots[0].count, 5);
});
test('parallel collection cards each track their own independent progress', () => {
    const a = card({ tokens: [], slots: [{ tokens: ['itemtype_mineral_ore_gold'], count: 1 }] });
    const b = structuredClone(a);
    rules.applyResourceEvent({ cards: [a, b] }, 'Inventory gained: itemtype_mineral_ore_gold x3');
    assert.equal(a.slots[0].count, 4);
    assert.equal(b.slots[0].count, 4);
});
test('countdown slots count down one per cook line, only on their direction, never below zero', () => {
    const value = card({
        direction: 'gained',
        eventSource: 'inventory',
        tokens: [],
        slots: [
            {
                id: 'gumbo',
                tokens: ['itemtype_c_crabgumbo'],
                mode: 'countdown',
                countEvents: true,
                startAt: 2,
                count: 2
            },
            {
                id: 'rice',
                tokens: ['itemtype_c_crabfriedrice'],
                mode: 'countdown',
                startAt: 10,
                count: 10
            },
            { id: 'plain', tokens: ['itemtype_c_crabpotpie'], count: 0 }
        ]
    });
    scan(value, 'Inventory gained: itemtype_c_crabgumbo x3');
    scan(value, 'Inventory gained: itemtype_c_crabfriedrice x4');
    scan(value, 'Inventory gained: itemtype_c_crabpotpie x2');
    assert.deepEqual(
        value.slots.map((x) => x.count),
        [1, 6, 2]
    );
    scan(value, 'Inventory lost: itemtype_c_crabgumbo x1');
    scan(value, 'Lockbox gained: itemtype_c_crabgumbo x1');
    assert.equal(value.slots[0].count, 1);
    scan(value, 'Inventory gained: itemtype_c_crabgumbo x1');
    scan(value, 'Inventory gained: itemtype_c_crabgumbo x1');
    assert.equal(value.slots[0].count, 0);
});
test('login resets preserve lifetime, countdown, and secondary counts; undo is one-use', () => {
    const state = {
        cards: [
            card({ secondaryCount: 5 }),
            card({ id: 'life', mode: 'lifetime' }),
            card({ id: 'cook', mode: 'countdown' })
        ]
    };
    rules.resetResourceSession(state, 'palia-login', Date.UTC(2026, 9, 22));
    assert.deepEqual(
        state.cards.map((c) => c.count),
        [0, 10, 10]
    );
    assert.equal(state.cards[0].secondaryCount, 5);
    assert.equal(state.lastResetReason, 'palia-login');
    assert.equal(rules.undoResourceReset(state), true);
    assert.equal(state.cards[0].count, 10);
    assert.equal(rules.undoResourceReset(state), false);
});
test('empty session resets offer no undo; unknown snapshot IDs are ignored', () => {
    const state = { cards: [card({ count: 0 })] };
    rules.resetResourceSession(state, 'manual');
    assert.deepEqual(state.previous, {});
    state.previous = { removed: 5 };
    rules.undoResourceReset(state);
    assert.equal(state.cards[0].count, 0);
});
test('login debounce includes the exact two-minute boundary', () => {
    assert.equal(rules.loginResetDue(1000, 1001), false);
    assert.equal(rules.loginResetDue(1000, 121000), false);
    assert.equal(rules.loginResetDue(1000, 121001), true);
});
