'use strict';

// Pure Ocean Fish rules: settings limits, the fish picture list, and the overlay command queue.
// No file or network access here so every rule can be unit tested.

const MAX_FISH = 20;
const MAX_COMMANDS = 10;

/**
 * Number settings as [min, max, step, fallback]. Values outside the range are clamped so a bad
 * dashboard request can never make the overlay unusable (for example a zero jump interval).
 */
const NUMBER_LIMITS = {
    bg: [0, 3, 1, 3],
    waveSpeed: [0.1, 2.5, 0.1, 1],
    waveHeight: [0.4, 2, 0.1, 1],
    sparkles: [0, 150, 1, 60],
    fishSize: [40, 300, 1, 110],
    jumpHeight: [0.1, 0.7, 0.01, 0.32],
    jumpSpeed: [0.4, 2.5, 0.1, 1],
    jumpEvery: [3, 60, 1, 12],
    jumpCount: [1, 8, 1, 1],
    jumpSpread: [0, 3, 0.1, 0.4],
    variety: [0, 1, 0.1, 0.4],
    showSec: [5, 600, 1, 30]
};
const BOOLEAN_FIELDS = [
    'visible',
    'gold',
    'autoJump',
    'splash',
    'onDemand',
    'showOnJump',
    'useDefault'
];

/** Create independent initial settings for first run or missing saved fields. */
function oceanFishDefaults() {
    return {
        visible: true,
        waveSpeed: 1,
        waveHeight: 1,
        sparkles: 60,
        gold: true,
        bg: 3, // 0 dark, 1 navy, 2 chroma green, 3 transparent (Meld default)
        fishSize: 110,
        jumpHeight: 0.32,
        jumpSpeed: 1,
        jumpEvery: 12,
        jumpCount: 1, // how many fish jump together
        jumpSpread: 0.4, // seconds between each fish in a group; 0 = all at once
        variety: 0.4,
        autoJump: true,
        splash: true,
        directions: 'both',
        onDemand: false,
        showSec: 30,
        showOnJump: false,
        useDefault: true, // the built-in teal fish is one of the choices
        pick: 'random', // 'random' or 'order'
        fish: [], // { id, name, file, on, scale, facesLeft }
        seq: 1
    };
}

/** Clamp a number into a range on the given step; non-numbers use the fallback. */
function clampNumber(value, min, max, step, fallback) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n)) return fallback;
    return Number(Math.max(min, Math.min(max, Math.round(n / step) * step)).toFixed(2));
}

/** Copy only supported, valid look and timing fields from a dashboard request onto the state. */
function applySettings(state, body) {
    for (const key of BOOLEAN_FIELDS) if (typeof body[key] === 'boolean') state[key] = body[key];
    if (['both', 'left', 'right'].includes(body.directions)) state.directions = body.directions;
    if (['random', 'order'].includes(body.pick)) state.pick = body.pick;
    for (const [key, [min, max, step, fallback]] of Object.entries(NUMBER_LIMITS))
        if (body[key] !== undefined) state[key] = clampNumber(body[key], min, max, step, fallback);
    return state;
}

/** Trim a fish name to 40 characters and drop a file extension; empty names become "Fish". */
function cleanFishName(value) {
    return (
        String(value == null ? '' : value)
            .replace(/[\u0000-\u001f]/g, '')
            .trim()
            .replace(/\.[a-z0-9]+$/i, '')
            .slice(0, 40) || 'Fish'
    );
}

/** Add a fish whose picture is already saved as `file`. Throws when the list is full. */
function addFish(state, name, file, facesLeft) {
    if (state.fish.length >= MAX_FISH) throw new Error(`That's the most fish (${MAX_FISH}).`);
    const fish = {
        id: `f${state.seq++}`,
        name: cleanFishName(name),
        file,
        on: true,
        scale: 1,
        facesLeft: !!facesLeft
    };
    state.fish.push(fish);
    return fish;
}

/** Edit, reorder, or remove fish. Unknown ids change nothing; removing keeps the picture file. */
function applyFishEdits(state, body) {
    const edit = body.editFish;
    if (edit && edit.id) {
        const fish = state.fish.find((f) => f.id === edit.id);
        if (fish) {
            if (typeof edit.on === 'boolean') fish.on = edit.on;
            if (typeof edit.facesLeft === 'boolean') fish.facesLeft = edit.facesLeft;
            if (edit.scale !== undefined) fish.scale = clampNumber(edit.scale, 0.3, 3, 0.05, 1);
            if (typeof edit.name === 'string' && edit.name.trim())
                fish.name = cleanFishName(edit.name);
        }
    }
    const move = body.moveFish;
    if (move && move.id) {
        const i = state.fish.findIndex((f) => f.id === move.id);
        const j = i + (Number(move.dir) < 0 ? -1 : 1);
        if (i >= 0 && j >= 0 && j < state.fish.length)
            [state.fish[i], state.fish[j]] = [state.fish[j], state.fish[i]];
    }
    if (body.removeFish) state.fish = state.fish.filter((f) => f.id !== body.removeFish);
    return state;
}

/**
 * Queue one-off overlay actions (jump / show / hide). Overlays poll every two seconds, so
 * commands carry an increasing number and the overlay runs every command newer than the last
 * one it saw. Only the latest few are kept; a freshly opened overlay skips old ones.
 */
function queueCommands(queue, body, now = Date.now()) {
    const actions = [];
    if (body.jumpNow) actions.push({ action: 'jump', fishId: String(body.fishId || '') });
    if (body.showNow) actions.push({ action: 'show', fishId: '' });
    if (body.hideNow) actions.push({ action: 'hide', fishId: '' });
    for (const a of actions) {
        queue.seq += 1;
        queue.list.push({ n: queue.seq, at: now, ...a });
    }
    queue.list = queue.list.slice(-MAX_COMMANDS);
    return actions.length;
}

module.exports = {
    MAX_FISH,
    NUMBER_LIMITS,
    oceanFishDefaults,
    clampNumber,
    applySettings,
    cleanFishName,
    addFish,
    applyFishEdits,
    queueCommands
};
