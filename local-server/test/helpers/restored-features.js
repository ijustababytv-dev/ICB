'use strict';
const assert = require('node:assert/strict');

/** Verify migrated features through real routes, shared events and isolated persisted state. */
async function verifyRestoredFeatures(json, listenForSseEvent) {
    /** Send JSON mutations to the temporary server only. */
    async function post(route, body) {
        const result = await json(route, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        assert.equal(result.response.status, 200, result.payload.error);
        return result.payload;
    }

    const initial = (await json('/api/sprite-tv')).payload;
    assert.equal(initial.settings.mode, 'last');
    assert.equal(initial.display, null);
    const sprite = (await json('/api/sprites/admin')).payload.sprites[0];
    assert.ok(sprite, 'fixture has a season roster');
    const listener = listenForSseEvent('spritetv', (state) => state.display?.id === sprite.id);
    await listener.ready;
    await post('/api/sprites', { catch: { id: sprite.id, variant: sprite.variants[0] } });
    assert.equal((await listener.event).display.name, sprite.name);
    await post('/api/sprite-tv', {
        set: {
            mode: 'pinned',
            pinnedId: sprite.id,
            pinnedVariant: sprite.variants[0],
            flashMs: -1,
            textSize: 999,
            ssPool: 'all'
        }
    });
    const tv = (await json('/api/sprite-tv')).payload;
    assert.equal(tv.display.id, sprite.id);
    assert.equal(tv.settings.flashMs, 0);
    assert.equal(tv.settings.textSize, 200);
    assert.ok((await json('/api/sprite-tv/slideshow')).payload.sprites.length > 1);
    await post('/api/sprite-tv', { set: { ssPool: 'uncaught' } });
    assert.ok(
        !(await json('/api/sprite-tv/slideshow')).payload.sprites.some((s) => s.id === sprite.id)
    );
    // Replacement season state must reach the TV instead of leaving a stale collection reference.
    await post('/api/sprites', { newSeason: 'TV Test Season', keepSprites: true });
    await post('/api/sprite-tv', { set: { mode: 'last', ssPool: 'caught' } });
    assert.equal((await json('/api/sprite-tv')).payload.display, null);
    assert.deepEqual((await json('/api/sprite-tv/slideshow')).payload.sprites, []);

    await post('/api/sashimi', { newEvent: 'Attendance Test', roles: [], open: true });
    await post('/api/sashimi/test', { name: 'Viewer', text: '!Moon Pie' });
    await post('/api/sashimi', { open: false });
    for (const text of ['!here', '!CHECKIN', '!signin']) {
        const result = await post('/api/sashimi/test', { name: 'VIEWER', text });
        assert.match(result.reply, /Moon Pie is (here|already checked in)/);
    }
    let state = (await json('/api/sashimi')).payload;
    assert.equal(state.checkedIn, 1);
    assert.equal(state.total, 1);
    assert.ok(state.event.guests[0].checkedIn > 0);
    assert.match(
        (await post('/api/sashimi/test', { name: 'Stranger', text: '!here' })).reply,
        /isn't signed up/
    );
    await post('/api/sashimi', { checkin: { n: 1, on: false } });
    assert.equal((await json('/api/sashimi')).payload.checkedIn, 0);
    await post('/api/sashimi', { checkin: { n: 1 } });
    assert.equal((await json('/api/sashimi')).payload.checkedIn, 1);
    await post('/api/sashimi', { resetCheckins: true });
    state = (await json('/api/sashimi')).payload;
    assert.equal(state.checkedIn, 0);
    assert.equal(state.total, 1);
    await post('/api/sashimi', { checkin: { n: 1, on: true } });
    console.log('Sprite TV and Poke Bowl check-in integration checks passed.');
}

/** Confirm both extracted feature stores survive the normal E2E server restart. */
async function verifyRestoredPersistence(json) {
    const tv = (await json('/api/sprite-tv')).payload;
    assert.equal(tv.settings.textSize, 200);
    assert.equal(tv.settings.mode, 'last');
    assert.equal(tv.display, null);
    const signup = (await json('/api/sashimi')).payload;
    assert.equal(signup.event.name, 'Attendance Test');
    assert.equal(signup.checkedIn, 1);
    assert.equal(signup.event.guests[0].name, 'Moon Pie');
}

module.exports = { verifyRestoredFeatures, verifyRestoredPersistence };
