'use strict';

// Pure Stream Frame rules: settings limits, which stream events make the overlay react, and
// the numbered command queue the Meld overlay polls. No file or network access here.

const MAX_COMMANDS = 12;
const REACTION_TYPES = ['follow', 'sub', 'gifts', 'bits', 'raid'];
const COLOR_MODES = ['off', 'fixed', 'cycle'];

/**
 * Number settings as [min, max, step, fallback]. Out-of-range values are clamped so a bad
 * dashboard request can never freeze or blind the overlay (for example a zero-length chaser).
 */
const NUMBER_LIMITS = {
    glowStrength: [0, 100, 1, 55],
    glowSpeed: [0.2, 3, 0.1, 1],
    flickerRate: [0, 10, 1, 3],
    chaserSpeed: [0.2, 4, 0.1, 1],
    chaserLength: [5, 60, 1, 22],
    chaserOffset: [-80, 80, 1, -21],
    chaserCount: [1, 2, 1, 1],
    chamfer: [0, 80, 1, 26],
    sunShimmer: [0, 100, 1, 50],
    starTwinkle: [0, 100, 1, 70],
    sparkles: [0, 100, 1, 30],
    hueShift: [-180, 180, 1, 0],
    cycleSpeed: [1, 60, 1, 12],
    reactionStrength: [0.2, 2, 0.1, 1],
    sunX: [0, 100, 0.1, 51.4],
    sunY: [0, 100, 0.1, 16.2],
    sunR: [1, 30, 0.1, 8.6]
};
const BOOLEAN_FIELDS = ['visible', 'glow', 'flicker', 'chaser', 'sun', 'stars', 'introOnLoad'];

/** Create independent initial settings for first run or missing saved fields. */
function streamFrameDefaults() {
    return {
        visible: true,
        art: 'overlay.png', // file in assets/stream-frame/
        glow: true,
        glowStrength: 55,
        glowSpeed: 1,
        flicker: true,
        flickerRate: 3, // quick neon flickers per minute
        chaser: true,
        chaserSpeed: 1,
        chaserLength: 22, // percent of a lap the light trail covers
        chaserColor: '#ffd36b',
        chaserOffset: -21, // art pixels from the camera hole edge to the neon tube (minus = outside)
        chaserCount: 1, // 2 = a second light running the other way
        chamfer: 26, // size of the cut corners on the frame, in art pixels
        sun: true,
        sunShimmer: 50,
        sunX: 51.4, // sun centre and radius as percent of the art (measured on her overlay)
        sunY: 16.2,
        sunR: 8.6,
        stars: true,
        starTwinkle: 70,
        sparkles: 30,
        colorMode: 'off',
        hueShift: 0,
        cycleSpeed: 12, // seconds for one full colour cycle
        introOnLoad: true,
        reactionStrength: 1,
        reactions: { follow: true, sub: true, gifts: true, bits: true, raid: true }
    };
}

/** Clamp a number into a range on the given step; non-numbers use the fallback. */
function clampNumber(value, min, max, step, fallback) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n)) return fallback;
    return Number(Math.max(min, Math.min(max, Math.round(n / step) * step)).toFixed(2));
}

/** Copy only supported, valid settings from a dashboard request onto the state. */
function applySettings(state, body) {
    for (const key of BOOLEAN_FIELDS) if (typeof body[key] === 'boolean') state[key] = body[key];
    for (const [key, [min, max, step, fallback]] of Object.entries(NUMBER_LIMITS))
        if (body[key] !== undefined) state[key] = clampNumber(body[key], min, max, step, fallback);
    if (COLOR_MODES.includes(body.colorMode)) state.colorMode = body.colorMode;
    if (/^#[0-9a-f]{6}$/i.test(String(body.chaserColor || '')))
        state.chaserColor = body.chaserColor;
    if (body.reactions && typeof body.reactions === 'object') {
        state.reactions = { ...state.reactions };
        for (const type of REACTION_TYPES)
            if (typeof body.reactions[type] === 'boolean')
                state.reactions[type] = body.reactions[type];
    }
    return state;
}

/** Add one command to the queue, keeping only the latest few. */
function pushCommand(queue, command, now = Date.now()) {
    queue.seq += 1;
    queue.list.push({ n: queue.seq, at: now, ...command });
    queue.list = queue.list.slice(-MAX_COMMANDS);
    return queue.seq;
}

/**
 * Turn a stream event (from the Meld listener) into an overlay reaction, if that reaction is
 * switched on. `size` scales the effect: gifted sub count, bits amount, or raid viewers.
 * Chat and unknown event types never react. Returns the queued command or null.
 */
function eventReaction(state, queue, type, body = {}, now = Date.now()) {
    if (!REACTION_TYPES.includes(type) || !state.reactions || !state.reactions[type]) return null;
    let size = 1;
    if (type === 'gifts') size = Math.max(1, Math.trunc(Number(body.count)) || 1);
    if (type === 'bits') size = Math.max(1, Math.trunc(Number(body.amount)) || 1);
    if (type === 'raid') size = Math.max(1, Math.trunc(Number(body.viewers)) || 1);
    const command = { action: type, size, name: String(body.username || '').slice(0, 40) };
    pushCommand(queue, command, now);
    return queue.list[queue.list.length - 1];
}

/** Dashboard buttons: test a reaction, replay the power-on intro, or flash the frame. */
function dashboardCommand(queue, body, now = Date.now()) {
    if (body.test && REACTION_TYPES.includes(body.test)) {
        const sizes = { follow: 1, sub: 1, gifts: 5, bits: 500, raid: 25 };
        return pushCommand(queue, { action: body.test, size: sizes[body.test], name: 'Test' }, now);
    }
    if (body.intro) return pushCommand(queue, { action: 'intro', size: 1, name: '' }, now);
    return 0;
}

module.exports = {
    REACTION_TYPES,
    NUMBER_LIMITS,
    streamFrameDefaults,
    clampNumber,
    applySettings,
    pushCommand,
    eventReaction,
    dashboardCommand
};
