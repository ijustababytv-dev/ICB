'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTodoItem, normalizeTodos } = require('../../server/domain/todos');
const { randomizerClean } = require('../../server/domain/randomizer');
const { cleanString, validResource, validTimezone } = require('../../server/domain/validation');
const { mergeDefaults } = require('../../server/storage');

test('todo lists persist old daily and weekly progress without automatic resets', () => {
  const data = { daily: [{ id: 'd', text: 'Daily', done: true, createdAt: '2020-01-01' }], weekly: [{ id: 'w', text: 'Weekly', kind: 'goal', current: 9, target: 10 }] };
  const value = normalizeTodos(data);
  assert.equal(value.daily[0].done, true);
  assert.equal(value.weekly[0].current, 9);
  assert.equal(value.daily[0].createdAt, '2020-01-01');
});
test('todo normalization rejects blank items and repairs invalid goal values', () => {
  for (const raw of [null, 1, {}, { text: '   ' }]) assert.equal(normalizeTodoItem(raw), null);
  const item = normalizeTodoItem({ text: '  Goal  ', kind: 'goal', current: -9, target: 'invalid' });
  assert.equal(item.text, 'Goal'); assert.equal(item.target, 1); assert.equal(item.current, 0);
  assert.match(item.id, /^todo-/);
  const decimal = normalizeTodoItem({ text: 'Goal', kind: 'goal', current: 2.9, target: 3.8 });
  assert.equal(decimal.current, 2); assert.equal(decimal.target, 3);
});
test('invalid todo lists become independent empty lists', () => {
  const a = normalizeTodos(null), b = normalizeTodos({ daily: 'bad', weekly: [null] });
  a.daily.push({ text: 'only a' });
  assert.deepEqual(b.daily, []); assert.deepEqual(b.weekly, []);
});
test('randomizer normalizes duplicate IDs, blank titles, and unsafe links', () => {
  const value = randomizerClean({ games: [{ id: 'Palia!', name: ' Palia ', titles: ['hello\nworld', ' '], golives: ['live'] }, { id: 'Palia', name: 'Again' }, { name: '' }], link: 'javascript:alert(1)' });
  assert.deepEqual(value.games.map(g => g.id), ['palia', 'palia-2']);
  assert.deepEqual(value.games[0].titles, ['hello world']); assert.equal(value.link, '');
  assert.equal(randomizerClean({ link: 'https://example.com/live' }).link, 'https://example.com/live');
});
test('randomizer bounds game counts and text lengths', () => {
  const value = randomizerClean({ games: Array.from({ length: 50 }, (_, i) => ({ name: `g${i}`, titles: ['x'.repeat(300)] })) });
  assert.equal(value.games.length, 30); assert.equal(value.games[0].titles[0].length, 200);
});
test('resource corrections accept only the three defined live resources', () => {
  for (const name of ['amber', 'essence', 'sweetLeaf']) assert.equal(validResource(name), true);
  for (const name of ['gold', '__proto__', 'constructor', 'Amber']) assert.equal(validResource(name), false);
});
test('settings inputs trim strings and reject nonexistent timezones', () => {
  assert.equal(cleanString(' hi '), 'hi'); assert.equal(cleanString(5, 'fallback'), 'fallback');
  assert.equal(cleanString('x'.repeat(700)).length, 500);
  assert.equal(validTimezone('America/Chicago'), true); assert.equal(validTimezone('Mars/Example'), false);
});
test('default merging retains saved values without mutating defaults or losing new fields', () => {
  const defaults = { look: { color: 'pink', size: 20 }, list: [1] };
  const result = mergeDefaults(defaults, { look: { color: 'blue' }, list: [2] });
  assert.deepEqual(result, { look: { color: 'blue', size: 20 }, list: [2] });
  assert.equal(defaults.look.color, 'pink');
  assert.deepEqual(mergeDefaults(defaults, []), defaults);
});
