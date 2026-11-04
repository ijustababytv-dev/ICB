'use strict';
const { cleanString } = require('./validation');

/** Each installation gets independent Sprite TV settings; old saves receive new defaults. */
function defaults() {
    return {
        visible: true,
        mode: 'last',
        pinnedId: '',
        pinnedVariant: '',
        showName: true,
        showVariant: true,
        showRarity: true,
        flashMs: 500,
        staticMs: 240,
        idleBars: true,
        textPos: 'bottom',
        textSize: 100,
        imgSize: 100,
        slideshow: false,
        ssDelay: 8,
        ssInterval: 5,
        ssPool: 'caught',
        ssMessage: 'WE INTERRUPT THIS BROADCAST...',
        ssSubMessage: 'HAVE YOU SEEN THESE SPRITES?',
        ssShowInterrupt: true,
        seq: 1
    };
}

/** Whitelist operator settings and clamp numeric controls without accepting non-finite values. */
function updateSettings(current, input = {}) {
    const next = { ...current };
    for (const key of [
        'visible',
        'showName',
        'showVariant',
        'showRarity',
        'idleBars',
        'slideshow',
        'ssShowInterrupt'
    ]) {
        if (typeof input[key] === 'boolean') next[key] = input[key];
    }
    for (const [key, choices] of Object.entries({
        mode: ['last', 'pinned'],
        textPos: ['bottom', 'top', 'overlay'],
        ssPool: ['caught', 'uncaught', 'all']
    })) {
        if (choices.includes(input[key])) next[key] = input[key];
    }
    for (const [key, length] of [
        ['pinnedId', 60],
        ['pinnedVariant', 40],
        ['ssMessage', 120],
        ['ssSubMessage', 120]
    ]) {
        if (typeof input[key] === 'string') next[key] = cleanString(input[key]).slice(0, length);
    }
    for (const [key, lo, hi] of [
        ['flashMs', 0, 2000],
        ['staticMs', 0, 2000],
        ['textSize', 50, 200],
        ['imgSize', 30, 200],
        ['ssDelay', 1, 120],
        ['ssInterval', 2, 60]
    ]) {
        if (input[key] !== undefined && Number.isFinite(Number(input[key])))
            next[key] = Math.max(lo, Math.min(hi, Math.round(Number(input[key]))));
    }
    next.seq++;
    return next;
}

/** Prefer a valid pinned sprite, otherwise use the latest catch; variant artwork overrides base art. */
function displaySprite(settings, collection, art, imageFor) {
    const last = collection.recent[0];
    const pinned =
        settings.mode === 'pinned' && collection.sprites.find((s) => s.id === settings.pinnedId);
    const selected = pinned || (last && collection.sprites.find((s) => s.id === last.id));
    const display = pinned
        ? {
              id: pinned.id,
              name: pinned.name,
              variant: settings.pinnedVariant || 'Base',
              rarity: pinned.rarity,
              img: imageFor(pinned)
          }
        : last
        ? {
              id: last.id,
              name: last.name,
              variant: last.variant,
              rarity: selected ? selected.rarity : '',
              img: last.img || imageFor(selected)
          }
        : null;
    if (display && art[display.id]?.[display.variant])
        display.variantImg = art[display.id][display.variant];
    return display;
}

/** Recent catches stay ordered and unique; all/uncaught pools use the actual season roster. */
function slideshowSprites(settings, collection, art, imageFor) {
    if (settings.ssPool === 'caught') {
        const seen = new Set();
        return collection.recent
            .filter((entry) => {
                const key = entry.id + '|' + entry.variant;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map((entry) => {
                const sprite = collection.sprites.find((s) => s.id === entry.id);
                return {
                    id: entry.id,
                    name: entry.name,
                    variant: entry.variant,
                    rarity: sprite ? sprite.rarity : '',
                    img: art[entry.id]?.[entry.variant] || (sprite ? imageFor(sprite) : entry.img)
                };
            });
    }
    // A catch remains owned after it falls out of the recent-30 list.
    const caught = new Set(collection.recent.map((entry) => entry.id));
    for (const sprite of collection.sprites) {
        if (sprite.variants.some((variant) => collection.caught[sprite.id + '|' + variant]))
            caught.add(sprite.id);
    }
    return collection.sprites
        .filter((sprite) => settings.ssPool !== 'uncaught' || !caught.has(sprite.id))
        .map((sprite) => ({
            id: sprite.id,
            name: sprite.name,
            variant: 'Base',
            rarity: sprite.rarity || '',
            img: art[sprite.id]?.Base || imageFor(sprite)
        }));
}

module.exports = { defaults, updateSettings, displaySprite, slideshowSprites };
