'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const frameRules = require('../../src/domain/stream-frame');

const root = path.resolve(__dirname, '../../..');

/** A fresh settings object and empty command queue for each test. */
function setup() {
    return { state: frameRules.streamFrameDefaults(), queue: { seq: 0, list: [] } };
}

test('defaults react to every event type and keep independent reaction lists', () => {
    const a = setup().state;
    const b = setup().state;
    a.reactions.raid = false;
    assert.equal(b.reactions.raid, true);
    for (const type of frameRules.REACTION_TYPES) assert.equal(b.reactions[type], true);
    assert.equal(b.colorMode, 'off');
    assert.equal(b.art, 'overlay.png');
});

test('number settings clamp to their limits and ignore non-numbers', () => {
    const { state } = setup();
    frameRules.applySettings(state, {
        glowStrength: 500,
        chaserSpeed: 0,
        chaserCount: 7,
        cycleSpeed: 'fast',
        sunR: 0.2,
        reactionStrength: 1.04
    });
    assert.equal(state.glowStrength, 100);
    assert.equal(state.chaserSpeed, 0.2);
    assert.equal(state.chaserCount, 2);
    assert.equal(state.cycleSpeed, 12);
    assert.equal(state.sunR, 1);
    assert.equal(state.reactionStrength, 1);
});

test('only real booleans, listed colour modes, and hex colours are accepted', () => {
    const { state } = setup();
    frameRules.applySettings(state, {
        glow: 'off',
        chaser: false,
        colorMode: 'disco',
        chaserColor: 'red',
        reactions: { follow: false, raid: 'no', chat: true }
    });
    assert.equal(state.glow, true);
    assert.equal(state.chaser, false);
    assert.equal(state.colorMode, 'off');
    assert.equal(state.chaserColor, '#ffd36b');
    assert.equal(state.reactions.follow, false);
    assert.equal(state.reactions.raid, true);
    assert.equal(state.reactions.chat, undefined);
    frameRules.applySettings(state, { colorMode: 'cycle', chaserColor: '#4EF2FF' });
    assert.deepEqual([state.colorMode, state.chaserColor], ['cycle', '#4EF2FF']);
});

test('stream events queue sized reactions; chat and switched-off events do not', () => {
    const { state, queue } = setup();
    assert.equal(frameRules.eventReaction(state, queue, 'chat', { username: 'a' }), null);
    const gifts = frameRules.eventReaction(
        state,
        queue,
        'gifts',
        { username: 'Moon', count: 10 },
        7
    );
    assert.deepEqual(
        [gifts.n, gifts.action, gifts.size, gifts.name, gifts.at],
        [1, 'gifts', 10, 'Moon', 7]
    );
    assert.equal(frameRules.eventReaction(state, queue, 'bits', { amount: 250 }).size, 250);
    assert.equal(frameRules.eventReaction(state, queue, 'raid', { viewers: 'lots' }).size, 1);
    assert.equal(frameRules.eventReaction(state, queue, 'follow', {}).size, 1);
    state.reactions.sub = false;
    assert.equal(frameRules.eventReaction(state, queue, 'sub', { username: 'x' }), null);
    assert.equal(queue.seq, 4);
});

test('the command queue keeps only the latest twelve and numbers keep rising', () => {
    const { state, queue } = setup();
    for (let i = 0; i < 30; i++) frameRules.eventReaction(state, queue, 'follow', {});
    assert.equal(queue.list.length, 12);
    assert.equal(queue.list[11].n, 30);
    assert.equal(queue.list[0].n, 19);
});

test('dashboard test buttons and power-on queue commands; other requests do not', () => {
    const { queue } = setup();
    assert.equal(frameRules.dashboardCommand(queue, { glow: true }), 0);
    frameRules.dashboardCommand(queue, { test: 'bits' });
    frameRules.dashboardCommand(queue, { intro: true });
    frameRules.dashboardCommand(queue, { test: 'chat' });
    assert.deepEqual(
        queue.list.map((c) => [c.action, c.size]),
        [
            ['bits', 500],
            ['intro', 1]
        ]
    );
});

test('the Meld overlay scripts stay plain ES5 and poll without EventSource', () => {
    const files = ['stream-frame.js', 'stream-frame/art-maps.js', 'stream-frame/effects.js'];
    for (const file of files) {
        // Comments may mention these words; only the code itself must avoid them.
        const code = fs
            .readFileSync(path.join(root, 'ui', 'js', file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
        assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|`|\bclass\b/, file);
        assert.doesNotMatch(code, /EventSource/, file);
    }
    const html = fs.readFileSync(path.join(root, 'ui', 'html', 'stream-frame.html'), 'utf8');
    assert.ok(html.indexOf('stream-frame/effects.js') < html.indexOf('/js/client/stream-frame.js'));
});
