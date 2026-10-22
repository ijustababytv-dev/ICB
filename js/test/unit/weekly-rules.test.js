'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weekStartFor } = require('../../server/domain/week');
const {
    applyWeeklyEvent,
    rolloverWeek,
    undoWeeklyReset
} = require('../../server/domain/weekly-rules');

/** Model one automatic goal using a token observed in the project logs. */
function goal(overrides = {}) {
    return {
        id: 'ore',
        type: 'collect',
        target: 30,
        count: 0,
        tokens: ['itemtype_mineral_ore_gold'],
        ...overrides
    };
}

for (const [at, expected] of [
    ['2026-10-19T03:59:59Z', '2026-10-12T04:00:00.000Z'],
    ['2026-10-19T04:00:00Z', '2026-10-19T04:00:00.000Z'],
    ['2026-10-25T23:59:59Z', '2026-10-19T04:00:00.000Z'],
    ['2027-01-01T00:00:00Z', '2026-12-28T04:00:00.000Z']
])
    test(`Palia week is anchored to Monday 04:00 UTC at ${at}`, () =>
        assert.equal(weekStartFor(at, {}), expected));
test('custom week anchors are honored', () =>
    assert.equal(
        weekStartFor('2026-10-22T12:00:00Z', { weekStartsUtc: { weekday: 4, hour: 10 } }),
        '2026-10-22T10:00:00.000Z'
    ));
test('tree/node/creature goals count one event, while item goals count quantity', () => {
    const event = goal({ mode: 'events', tokenPattern: '^itemtype_mineral_' });
    const item = goal();
    applyWeeklyEvent(
        { items: [event, item] },
        'Inventory gained: itemtype_mineral_ore_gold x7 itemtype_mineral_ore_iron x3'
    );
    assert.equal(event.count, 1);
    assert.equal(item.count, 7);
});
test('manual goals and completed automatic goals are never incremented by logs', () => {
    const manual = goal({ type: 'manual' }),
        done = goal({ count: 30 });
    assert.equal(
        applyWeeklyEvent(
            { items: [manual, done] },
            'Inventory gained: itemtype_mineral_ore_gold x2'
        ),
        false
    );
    assert.equal(manual.count, 0);
    assert.equal(done.count, 30);
});
test('weekly rules ignore resyncs and filter direction and star quality', () => {
    const value = goal({ starOnly: true });
    for (const line of [
        'Primary gained: itemtype_mineral_ore_gold (1*) x99',
        'Inventory lost: itemtype_mineral_ore_gold (1*) x9',
        'Inventory gained: itemtype_mineral_ore_gold x9'
    ])
        assert.equal(applyWeeklyEvent({ items: [value] }, line), false);
    assert.equal(
        applyWeeklyEvent({ items: [value] }, 'Lockbox gained: itemtype_mineral_ore_gold (1*) x2'),
        true
    );
    assert.equal(value.count, 2);
});
test('rollover catches up once, saves progress for undo, and tolerates removed goals', () => {
    const value = {
        weekStart: '2026-10-05T04:00:00.000Z',
        items: [goal({ count: 7 }), goal({ id: 'manual', type: 'manual', done: true })]
    };
    assert.equal(rolloverWeek(value, '2026-10-22T12:00:00Z', {}), true);
    assert.deepEqual(
        value.items.map((i) => [i.count, i.done]),
        [
            [0, false],
            [0, false]
        ]
    );
    const snapshot = structuredClone(value.previous);
    assert.equal(rolloverWeek(value, '2026-10-22T13:00:00Z', {}), false);
    assert.deepEqual(value.previous, snapshot);
    value.items.pop();
    assert.equal(undoWeeklyReset(value), true);
    assert.equal(value.items[0].count, 7);
    assert.equal(value.weekStart, '2026-10-05T04:00:00.000Z');
    assert.equal(undoWeeklyReset(value), false);
});
