'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fishRules = require('../../src/domain/ocean-fish');

const root = path.resolve(__dirname, '../../..');

/** A fresh settings object for each test so rules cannot leak between cases. */
function state() {
    return fishRules.oceanFishDefaults();
}

test('defaults are independent copies with one fish per jump and the built-in fish on', () => {
    const a = state();
    const b = state();
    a.fish.push({ id: 'x' });
    assert.equal(b.fish.length, 0);
    assert.equal(a.jumpCount, 1);
    assert.equal(a.useDefault, true);
    assert.equal(a.bg, 3);
});

test('number settings clamp to their limits and ignore non-numbers', () => {
    const s = fishRules.applySettings(state(), {
        jumpCount: 99,
        jumpSpread: -4,
        jumpEvery: 0,
        fishSize: 'big',
        waveSpeed: 1.04
    });
    assert.equal(s.jumpCount, 8);
    assert.equal(s.jumpSpread, 0);
    assert.equal(s.jumpEvery, 3);
    assert.equal(s.fishSize, 110);
    assert.equal(s.waveSpeed, 1);
    assert.equal(fishRules.clampNumber(null, 0, 1, 0.1, 0.5), 0.5);
});

test('only real booleans and listed choices are accepted', () => {
    const s = fishRules.applySettings(state(), {
        visible: 'no',
        useDefault: false,
        pick: 'sideways',
        directions: 'left',
        unknown: 1
    });
    assert.equal(s.visible, true);
    assert.equal(s.useDefault, false);
    assert.equal(s.pick, 'random');
    assert.equal(s.directions, 'left');
    assert.equal(s.unknown, undefined);
    assert.equal(fishRules.applySettings(s, { pick: 'order' }).pick, 'order');
});

test('adding fish gives unique ids, clean names, and stops at the limit', () => {
    const s = state();
    const a = fishRules.addFish(s, 'Red Koi.png', 'red-koi.png', true);
    const b = fishRules.addFish(s, '   ', 'fish.png');
    assert.notEqual(a.id, b.id);
    assert.equal(a.name, 'Red Koi');
    assert.equal(a.facesLeft, true);
    assert.equal(b.name, 'Fish');
    assert.deepEqual([a.on, a.scale], [true, 1]);
    while (s.fish.length < fishRules.MAX_FISH) fishRules.addFish(s, 'more', 'm.png');
    assert.throws(() => fishRules.addFish(s, 'one too many', 'x.png'), /most fish/);
});

test('fish edits change only the named fish and clamp its size', () => {
    const s = state();
    const a = fishRules.addFish(s, 'A', 'a.png');
    const b = fishRules.addFish(s, 'B', 'b.png');
    fishRules.applyFishEdits(s, { editFish: { id: a.id, on: false, scale: 9, name: '  ' } });
    assert.deepEqual([a.on, a.scale, a.name], [false, 3, 'A']);
    assert.deepEqual([b.on, b.scale], [true, 1]);
    fishRules.applyFishEdits(s, { editFish: { id: 'nope', on: false } });
    assert.equal(b.on, true);
});

test('fish move within the list and removal keeps the others in order', () => {
    const s = state();
    const ids = ['A', 'B', 'C'].map((n) => fishRules.addFish(s, n, `${n}.png`).id);
    fishRules.applyFishEdits(s, { moveFish: { id: ids[0], dir: -1 } }); // already first: no change
    assert.deepEqual(
        s.fish.map((f) => f.name),
        ['A', 'B', 'C']
    );
    fishRules.applyFishEdits(s, { moveFish: { id: ids[0], dir: 1 } });
    assert.deepEqual(
        s.fish.map((f) => f.name),
        ['B', 'A', 'C']
    );
    fishRules.applyFishEdits(s, { removeFish: ids[1] });
    assert.deepEqual(
        s.fish.map((f) => f.name),
        ['A', 'C']
    );
});

test('overlay commands are numbered, carry the chosen fish, and keep only the latest ten', () => {
    const q = { seq: 0, list: [] };
    assert.equal(fishRules.queueCommands(q, { fishSize: 120 }), 0);
    fishRules.queueCommands(q, { jumpNow: true, fishId: 'f2' }, 5);
    fishRules.queueCommands(q, { showNow: true, hideNow: true }, 6);
    assert.deepEqual(
        q.list.map((c) => [c.n, c.action, c.fishId]),
        [
            [1, 'jump', 'f2'],
            [2, 'show', ''],
            [3, 'hide', '']
        ]
    );
    for (let i = 0; i < 20; i++) fishRules.queueCommands(q, { jumpNow: true });
    assert.equal(q.list.length, 10);
    assert.equal(q.list[9].n, q.seq);
});

test('the Meld overlay scripts stay plain ES5 and poll without EventSource', () => {
    const files = ['ocean-fish.js', 'ocean-fish/waves.js', 'ocean-fish/fish-art.js'];
    for (const file of files) {
        // Comments may mention these words; only the code itself must avoid them.
        const code = fs
            .readFileSync(path.join(root, 'ui', 'js', file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
        assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|`|\bclass\b/, file);
        assert.doesNotMatch(code, /EventSource/, file);
    }
    const html = fs.readFileSync(path.join(root, 'ui', 'html', 'ocean-fish.html'), 'utf8');
    assert.ok(html.indexOf('ocean-fish/waves.js') < html.indexOf('/js/client/ocean-fish.js'));
});
