'use strict';

// Pure Turn Line rules (Baby, 2026-10-29): viewers join a line to take turns starting the same
// dish. The first person waiting is "current" (green); when Done is clicked they turn "done"
// (red) and the next person becomes current. No file or network access, so every rule is unit tested.

const MAX_PEOPLE = 60;
const NUMBER_LIMITS = {
    turnsEach: [1, 99, 1, 10], // how many starts each person does (shown on screen; not counted)
    font: [14, 60, 1, 28],
    bgOpacity: [0, 100, 1, 85], // background strength, 0 = see-through
    bgRadius: [0, 60, 1, 18] // rounded corners
};
const BG_MODES = ['none', 'color', 'image'];
const BG_FITS = ['cover', 'contain', 'stretch'];
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}\.(png|jpe?g|webp|gif)$/i;
const BOOLEAN_FIELDS = ['visible', 'open', 'showHeader'];
const COLOR_FIELDS = ['goColor', 'doneColor', 'waitColor', 'accent', 'bgColor'];

/** Independent initial settings and an empty line. */
function turnLineDefaults() {
    return {
        visible: true,
        open: true, // chat sign-ups accepted
        showHeader: true,
        title: 'Dish Turns',
        dish: '',
        turnsEach: 10,
        font: 28,
        joinWord: 'turn', // !turn adds the chatter; !leave removes them
        goColor: '#3ddc84',
        doneColor: '#ff4d5e',
        waitColor: '#ffffff',
        accent: '#ff8fd8',
        bgMode: 'none', // 'none' (see-through), 'color' (panel) or 'image' (picture from assets/turn-line)
        bgColor: '#24063a',
        bgOpacity: 85,
        bgRadius: 18,
        bgImage: '', // file name inside assets/turn-line
        bgFit: 'cover',
        seq: 0,
        people: [] // { id, name, state: 'wait' | 'go' | 'done' }
    };
}

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

const cleanText = (v, max) =>
    String(v == null ? '' : v)
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, max);

/** Clamp a number into a range on the given step; non-numbers use the fallback. */
function clampNumber(value, min, max, step, fallback) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n / step) * step));
}

/** Copy only supported, valid settings from a dashboard request onto the state. */
function applySettings(state, body) {
    for (const key of BOOLEAN_FIELDS) if (typeof body[key] === 'boolean') state[key] = body[key];
    for (const [key, [min, max, step, fallback]] of Object.entries(NUMBER_LIMITS))
        if (body[key] !== undefined) state[key] = clampNumber(body[key], min, max, step, fallback);
    for (const key of COLOR_FIELDS) if (isHex(body[key])) state[key] = body[key];
    if (typeof body.title === 'string') state.title = cleanText(body.title, 40);
    if (typeof body.dish === 'string') state.dish = cleanText(body.dish, 40);
    if (typeof body.joinWord === 'string') {
        const word = cleanText(body.joinWord, 20)
            .toLowerCase()
            .replace(/^!/, '')
            .replace(/[^a-z0-9]/g, '');
        if (word) state.joinWord = word;
    }
    if (BG_MODES.includes(body.bgMode)) state.bgMode = body.bgMode;
    if (BG_FITS.includes(body.bgFit)) state.bgFit = body.bgFit;
    if (typeof body.bgImage === 'string')
        state.bgImage = isImageFile(body.bgImage) ? body.bgImage : '';
    return state;
}

/** True for a plain picture file name (no folders), as saved in assets/turn-line. */
function isImageFile(name) {
    return IMAGE_FILE.test(String(name || '')) && !String(name).includes('..');
}

/** The person whose turn it is now, or null. */
function current(state) {
    return state.people.find((p) => p.state === 'go') || null;
}

/** Make the first waiting person current when nobody is (called after every change). */
function settle(state) {
    if (!current(state)) {
        const next = state.people.find((p) => p.state === 'wait');
        if (next) next.state = 'go';
    }
    return state;
}

/** Add a name to the end of the line; false if blank, a duplicate, or the line is full. */
function addPerson(state, name) {
    name = cleanText(name, 40).replace(/^@/, '');
    if (!name || state.people.length >= MAX_PEOPLE) return false;
    const key = name.toLowerCase();
    if (state.people.some((p) => p.name.toLowerCase() === key)) return false;
    state.seq += 1;
    state.people.push({ id: state.seq, name, state: 'wait' });
    settle(state);
    return true;
}

/** Remove a person (current or not); the next in line becomes current if needed. */
function removePerson(state, id) {
    const before = state.people.length;
    state.people = state.people.filter((p) => p.id !== Number(id));
    settle(state);
    return state.people.length < before;
}

/** Remove a chatter by name (for !leave). */
function removeByName(state, name) {
    const p = state.people.find(
        (x) => x.name.toLowerCase() === cleanText(name, 40).replace(/^@/, '').toLowerCase()
    );
    return p ? removePerson(state, p.id) : false;
}

/** The current person is finished (turns red) and the next waiting person becomes current (green). */
function finishCurrent(state) {
    const now = current(state);
    if (!now) return false;
    now.state = 'done';
    settle(state);
    return true;
}

/** Undo the last Done: the most recently finished person becomes current again. */
function undoDone(state) {
    let last = null;
    for (const p of state.people) if (p.state === 'done') last = p;
    if (!last) return false;
    const now = current(state);
    if (now) now.state = 'wait'; // they go back to waiting, still first in line
    last.state = 'go';
    return true;
}

/** Put everyone back to waiting (a new round); the first becomes current. */
function newRound(state) {
    for (const p of state.people) p.state = 'wait';
    return settle(state);
}

/** Move a waiting person up or down in the line (-1 / +1), staying among the waiting people. */
function movePerson(state, id, dir) {
    const i = state.people.findIndex((p) => p.id === Number(id));
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= state.people.length) return false;
    [state.people[i], state.people[j]] = [state.people[j], state.people[i]];
    return true;
}

/** Skip the current person without marking them done: they go to the back of the waiting line. */
function skipCurrent(state) {
    const now = current(state);
    if (!now || !state.people.some((p) => p.state === 'wait')) return false;
    state.people = state.people.filter((p) => p !== now);
    now.state = 'wait';
    state.people.push(now);
    settle(state);
    return true;
}

/**
 * Read a chat message as a Turn Line command: returns 'join', 'leave' or null.
 * Only the exact commands count (!turn / !leave), nothing else in the message.
 */
function chatCommand(state, text) {
    const t = String(text == null ? '' : text)
        .trim()
        .toLowerCase();
    if (t === '!' + state.joinWord) return 'join';
    if (t === '!leave' || t === '!' + state.joinWord + 'leave') return 'leave';
    return null;
}

module.exports = {
    MAX_PEOPLE,
    NUMBER_LIMITS,
    turnLineDefaults,
    isImageFile,
    clampNumber,
    applySettings,
    current,
    settle,
    addPerson,
    removePerson,
    removeByName,
    finishCurrent,
    undoDone,
    newRound,
    movePerson,
    skipCurrent,
    chatCommand
};
