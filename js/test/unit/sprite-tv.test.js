'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    defaults,
    updateSettings,
    displaySprite,
    slideshowSprites
} = require('../../server/domain/sprite-tv');

/** Model a current catch, an older owned sprite, and a genuinely uncaught sprite. */
function collection() {
    return {
        sprites: ['a', 'b', 'c'].map((id) => ({
            id,
            name: id.toUpperCase(),
            rarity: 'Rare',
            variants: ['Base', 'Gold']
        })),
        recent: [
            { id: 'a', name: 'A', variant: 'Gold' },
            { id: 'a', name: 'A', variant: 'Gold' },
            { id: 'a', name: 'A', variant: 'Base' }
        ],
        caught: { 'a|Gold': 100, 'b|Base': 10 }
    };
}

/** Return local base art and tolerate a deleted roster entry, as the real resolver does. */
function imageFor(sprite) {
    return sprite ? '/assets/' + sprite.id + '.png' : '';
}

test('TV defaults are independent and setting updates never mutate the original', () => {
    const original = defaults();
    const next = updateSettings(original, {
        visible: false,
        mode: 'pinned',
        ssPool: 'all',
        textPos: 'top',
        seq: 999,
        unknown: true
    });
    assert.equal(next.visible, false);
    assert.equal(next.mode, 'pinned');
    assert.equal(next.ssPool, 'all');
    assert.equal(next.textPos, 'top');
    assert.equal(next.seq, original.seq + 1);
    assert.equal(next.unknown, undefined);
    assert.deepEqual(original, defaults());
});

test('TV settings reject invalid enums and non-boolean flags, and bound text fields', () => {
    const original = defaults();
    const next = updateSettings(original, {
        mode: 'random',
        ssPool: 'none',
        textPos: 'left',
        visible: 'false',
        slideshow: 1
    });
    assert.deepEqual(next, { ...original, seq: original.seq + 1 });
    const text = updateSettings(original, {
        pinnedId: ' a '.repeat(100),
        pinnedVariant: 'v'.repeat(100),
        ssMessage: 'm'.repeat(200),
        ssSubMessage: 's'.repeat(200)
    });
    assert.equal(text.pinnedId.length, 60);
    assert.equal(text.pinnedVariant.length, 40);
    assert.equal(text.ssMessage.length, 120);
    assert.equal(text.ssSubMessage.length, 120);
    assert.equal(updateSettings(original, { pinnedId: '  a  ' }).pinnedId, 'a');
});

test('TV numeric settings clamp, round, and ignore non-finite values', () => {
    const original = defaults();
    for (const [key, lo, hi] of [
        ['flashMs', 0, 2000],
        ['staticMs', 0, 2000],
        ['textSize', 50, 200],
        ['imgSize', 30, 200],
        ['ssDelay', 1, 120],
        ['ssInterval', 2, 60]
    ]) {
        assert.equal(updateSettings(original, { [key]: -100 })[key], lo);
        assert.equal(updateSettings(original, { [key]: 9999 })[key], hi);
        assert.equal(updateSettings(original, { [key]: String(lo + 1.6) })[key], lo + 2);
        for (const invalid of [NaN, Infinity, 'nope'])
            assert.equal(updateSettings(original, { [key]: invalid })[key], original[key]);
    }
});

test('TV shows the latest catch or a valid pin, with per-variant artwork', () => {
    const sprites = collection();
    const art = { a: { Gold: '/assets/a-gold.png' } };
    const latest = displaySprite(defaults(), sprites, art, imageFor);
    assert.equal(latest.id, 'a');
    assert.equal(latest.variantImg, art.a.Gold);
    assert.equal(latest.img, '/assets/a.png');
    const pinned = displaySprite(
        { mode: 'pinned', pinnedId: 'b', pinnedVariant: '' },
        sprites,
        art,
        imageFor
    );
    assert.equal(pinned.id, 'b');
    assert.equal(pinned.variant, 'Base');
    assert.deepEqual(
        displaySprite({ mode: 'pinned', pinnedId: 'missing' }, sprites, art, imageFor),
        latest
    );
    assert.equal(displaySprite(defaults(), { ...sprites, recent: [] }, art, imageFor), null);
    const old = displaySprite(
        defaults(),
        { ...sprites, recent: [{ id: 'removed', img: '/assets/old.png' }] },
        {},
        imageFor
    );
    assert.equal(old.rarity, '');
    assert.equal(old.img, '/assets/old.png');
});

test('caught slideshow keeps recent order and distinct variants without duplicates', () => {
    const list = slideshowSprites(
        { ssPool: 'caught' },
        collection(),
        { a: { Gold: '/gold.png' } },
        imageFor
    );
    assert.deepEqual(
        list.map((s) => s.id + '|' + s.variant),
        ['a|Gold', 'a|Base']
    );
    assert.equal(list[0].img, '/gold.png');
    assert.deepEqual(
        slideshowSprites({ ssPool: 'caught' }, { ...collection(), recent: [] }, {}, imageFor),
        []
    );
});

test('all and uncaught slideshows use the real roster and retain ownership beyond recent catches', () => {
    const sprites = collection();
    const all = slideshowSprites(
        { ssPool: 'all' },
        sprites,
        { b: { Base: '/b-base.png' } },
        imageFor
    );
    assert.deepEqual(
        all.map((s) => s.id),
        ['a', 'b', 'c']
    );
    assert.equal(all[1].img, '/b-base.png');
    assert.deepEqual(
        slideshowSprites({ ssPool: 'uncaught' }, sprites, {}, imageFor).map((s) => s.id),
        ['c']
    );
});
