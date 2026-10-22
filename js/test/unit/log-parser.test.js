'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lineDelta, quantityFor, quantityForPrefix } = require('../../server/domain/log-parser');

for (const source of ['Inventory', 'Lockbox']) {
  for (const [direction, sign] of [['gained', 1], ['lost', -1]]) {
    test(`${source} ${direction} counts quality-marked stacks`, () => {
      assert.deepEqual(lineDelta(`${source} ${direction}: itemtype_forage_spice_sweetleaves (1*) x6`),
        [{ resource: 'sweetLeaf', amount: sign * 6, token: 'itemtype_forage_spice_sweetleaves' }]);
    });
  }
}
for (const line of ['Primary gained: itemtype_echo_essence x999', 'Primary lost: itemtype_echo_essence x999', 'Crafted recipe 7342: 89 -> 90 (+1)', 'unrelated line']) {
  test(`non-incremental log records are ignored: ${line}`, () => assert.deepEqual(lineDelta(line), []));
}
test('a line can update each live resource without confusing gold currency with ore', () => {
  const delta = lineDelta('Inventory gained: itemtype_currency_echo_amber x2 itemtype_echo_essence x3 itemtype_currency_gold x500');
  assert.deepEqual(delta.map(d => [d.resource, d.amount]), [['amber', 2], ['essence', 3]]);
});
test('exact token quantities cannot consume a longer token name', () => {
  assert.equal(quantityFor('itemtype_crop_apple_golden x20', 'itemtype_crop_apple'), 0);
  assert.equal(quantityFor('itemtype_crop_apple (1*) x2', 'itemtype_crop_apple'), 2);
  assert.equal(quantityFor('itemtype_crop_apple', 'itemtype_crop_apple'), 0);
});
test('family slots sum every matching species, including starred pickups', () => {
  const line = 'Inventory gained: itemtype_bug_beer x2 itemtype_bug_ladybeetle (1*) x3 itemtype_fish_beer x80';
  assert.equal(quantityForPrefix(line, 'itemtype_bug_'), 5);
  assert.equal(quantityForPrefix(line, 'itemtype_wood_'), 0);
});
