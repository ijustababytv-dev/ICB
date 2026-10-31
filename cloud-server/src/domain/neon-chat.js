'use strict';

// Pure Neon Chat rules: settings limits, which chat lines show, who counts as streamer / mod /
// VIP / sub, name colours, stream-event lines, and the message list the overlay polls.
// No file or network access here so every rule can be unit tested.

const MAX_KEPT = 60; // messages kept for overlays that (re)connect
const ROLES = ['streamer', 'mod', 'vip', 'sub', 'viewer'];
const EVENT_TYPES = ['follow', 'sub', 'gifts', 'bits', 'raid'];
// Neon name colours for chatters without a Twitch colour; each name always gets the same one.
const NEON_PALETTE = ['#ff8fd8', '#ffb36b', '#7af3ff', '#c99bff', '#ff6fa8', '#ffe27a', '#8dffb5'];

const NUMBER_LIMITS = {
    textSize: [12, 48, 1, 22],
    maxMessages: [1, 30, 1, 8],
    fadeSec: [0, 600, 5, 60], // 0 = messages stay
    glow: [0, 100, 1, 60],
    bgOpacity: [0, 100, 1, 88], // 0 = see-through background (only the neon frame shows)
    hueShift: [-180, 180, 1, 0]
};
const BOOLEAN_FIELDS = [
    'visible',
    'showFrame',
    'frameOnlyWithChat',
    'showTitle',
    'hideCommands',
    'hideMe',
    'useTwitchColors',
    'showBadges',
    'sparkles',
    'newestOnTop'
];

/** Create independent initial settings for first run or missing saved fields. */
function neonChatDefaults() {
    return {
        visible: true,
        showFrame: true,
        frameOnlyWithChat: false, // hide the neon box when no messages are showing
        showTitle: true,
        title: 'CHAT',
        streamerName: 'IJustABabyTv',
        textSize: 22,
        maxMessages: 8,
        fadeSec: 60,
        glow: 60,
        bgColor: '#24063a', // inside of the neon box
        bgOpacity: 88,
        hueShift: 0,
        nameFont: 'script', // 'script' (brush lettering like the logo) or 'bold'
        hideCommands: true, // lines starting with "!"
        hideMe: false, // /me action lines (e.g. timed bot announcements)
        hideNames: [], // bot accounts, lower-case
        useTwitchColors: false,
        showBadges: true,
        sparkles: true,
        newestOnTop: false,
        roleColors: {
            streamer: '#ffd36b',
            mod: '#7af3ff',
            vip: '#ff6fa8',
            sub: '#c99bff',
            viewer: ''
        },
        events: { follow: true, sub: true, gifts: true, bits: true, raid: true }
    };
}

/** Clamp a number into a range on the given step; non-numbers use the fallback. */
function clampNumber(value, min, max, step, fallback) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n)) return fallback;
    return Number(Math.max(min, Math.min(max, Math.round(n / step) * step)).toFixed(2));
}

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

const cleanText = (v, max) =>
    String(v == null ? '' : v)
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, max);

/** Copy only supported, valid settings from a dashboard request onto the state. */
function applySettings(state, body) {
    for (const key of BOOLEAN_FIELDS) if (typeof body[key] === 'boolean') state[key] = body[key];
    for (const [key, [min, max, step, fallback]] of Object.entries(NUMBER_LIMITS))
        if (body[key] !== undefined) state[key] = clampNumber(body[key], min, max, step, fallback);
    if (typeof body.title === 'string') state.title = cleanText(body.title, 30);
    if (typeof body.streamerName === 'string')
        state.streamerName = cleanText(body.streamerName, 40);
    if (['script', 'bold'].includes(body.nameFont)) state.nameFont = body.nameFont;
    if (isHex(body.bgColor)) state.bgColor = body.bgColor;
    if (Array.isArray(body.hideNames) || typeof body.hideNames === 'string') {
        const list = Array.isArray(body.hideNames)
            ? body.hideNames
            : body.hideNames.split(/[\s,]+/);
        state.hideNames = [
            ...new Set(
                list.map((n) => cleanText(n, 40).replace(/^@/, '').toLowerCase()).filter(Boolean)
            )
        ].slice(0, 50);
    }
    if (body.roleColors && typeof body.roleColors === 'object') {
        state.roleColors = { ...state.roleColors };
        for (const role of ROLES) {
            const c = body.roleColors[role];
            if (c === '' && role === 'viewer') state.roleColors.viewer = '';
            else if (isHex(c)) state.roleColors[role] = c;
        }
    }
    if (body.events && typeof body.events === 'object') {
        state.events = { ...state.events };
        for (const type of EVENT_TYPES)
            if (typeof body.events[type] === 'boolean') state.events[type] = body.events[type];
    }
    return state;
}

/**
 * Work out a chatter's role. Badge names come from the Meld listener when it can read them
 * (e.g. "moderator", "vip", "subscriber", "broadcaster"); the streamer is also recognised by
 * name so her own lines are always gold even if no badges arrive.
 */
function chatterRole(name, info, streamerName) {
    const badges = (info && Array.isArray(info.badges) ? info.badges : []).map((b) =>
        String(b).toLowerCase()
    );
    const has = (word) => badges.some((b) => b.indexOf(word) >= 0);

    if (has('broadcaster') || (streamerName && name.toLowerCase() === streamerName.toLowerCase()))
        return 'streamer';
    if (has('moderator') || has('mod')) return 'mod';
    if (has('vip')) return 'vip';
    if (has('subscriber') || has('founder')) return 'sub';
    return 'viewer';
}

/** Pick a stable neon colour for a name (the same name always gets the same colour). */
function paletteColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return NEON_PALETTE[h % NEON_PALETTE.length];
}

/** The colour a chatter's name is shown in. */
function nameColor(state, name, role, info) {
    if (role !== 'viewer' && isHex(state.roleColors[role])) return state.roleColors[role];
    if (state.useTwitchColors && info && isHex(info.color)) return info.color;
    if (isHex(state.roleColors.viewer)) return state.roleColors.viewer;
    return paletteColor(name.toLowerCase());
}

/**
 * Turn a relayed chat message into a display line, or null when it should be hidden:
 * empty messages, hidden accounts (bots), "!commands" (when hidden), and /me action lines
 * (when hidden). `parts` are text and emote pieces from the walkers parser.
 */
function chatLine(state, name, parts, info = {}, now = Date.now()) {
    name = cleanText(name, 40).replace(/^@/, '');
    if (!name) return null;
    if (state.hideNames.includes(name.toLowerCase())) return null;
    const clean = (Array.isArray(parts) ? parts : [])
        .slice(0, 40)
        .map((p) =>
            p && p.t === 'emote' && /^https:\/\/[^\s"'<>]+$/i.test(String(p.url || ''))
                ? { t: 'emote', url: p.url, name: cleanText(p.name, 40) }
                : { t: 'text', v: cleanText(p && p.v, 300) }
        )
        .filter((p) => p.t === 'emote' || p.v);
    if (!clean.length) return null;
    const plain = clean
        .filter((p) => p.t === 'text')
        .map((p) => p.v)
        .join(' ')
        .trim();
    if (state.hideCommands && plain.startsWith('!')) return null;
    if (state.hideMe && info.action) return null;
    const role = chatterRole(name, info, state.streamerName);
    return {
        kind: 'chat',
        at: now,
        name,
        role,
        color: nameColor(state, name, role, info),
        parts: clean
    };
}

/** A highlighted line for a follow, sub, gifted subs, bits or raid, or null if switched off. */
function eventLine(state, type, name, body = {}, now = Date.now()) {
    if (!EVENT_TYPES.includes(type) || !state.events[type]) return null;
    name = cleanText(name, 40) || 'Someone';
    const n = (v) => Math.max(1, Math.trunc(Number(v)) || 1);

    const text = {
        follow: `${name} just followed!`,
        sub:
            n(body.months) > 1
                ? `${name} subscribed for ${n(body.months)} months!`
                : `${name} just subscribed!`,
        gifts: `${name} gifted ${n(body.count)} sub${n(body.count) === 1 ? '' : 's'}!`,
        bits: `${name} cheered ${n(body.amount)} bits!`,
        raid: `${name} is raiding with ${Math.max(
            0,
            Math.trunc(Number(body.viewers)) || 0
        )} viewers!`
    }[type];
    return { kind: 'event', at: now, event: type, name, text };
}

/** Add a line to the kept list with an increasing number; keeps the latest few only. */
function pushLine(store, line) {
    if (!line) return 0;
    store.seq += 1;
    store.lines.push({ n: store.seq, ...line });
    store.lines = store.lines.slice(-MAX_KEPT);
    return store.seq;
}

module.exports = {
    ROLES,
    EVENT_TYPES,
    NUMBER_LIMITS,
    neonChatDefaults,
    clampNumber,
    applySettings,
    chatterRole,
    paletteColor,
    nameColor,
    chatLine,
    eventLine,
    pushLine
};
