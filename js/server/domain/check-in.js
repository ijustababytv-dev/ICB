'use strict';

// Stream-day check-in for the fluffy unicorn giveaway (Baby, 2026-10-30):
// only viewers who chat on the current stream day are in the jar and the
// drawing, and their saved-up unicorns all come out the first time they chat.
// Pure rules - the server decides what "today" is and passes it in.

/** Lower-case a chat name and drop a leading @ so "@Bob" and "bob" are one viewer. */
function keyOf(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/^@/, '');
}

/** Return the check-in record for this night; a new night starts with nobody here. */
function forNight(checkIn, night) {
    const old = checkIn && typeof checkIn === 'object' ? checkIn : {};
    const required = old.required !== false;
    if (old.night === night && old.users && typeof old.users === 'object')
        return { required, night, users: old.users };
    return { required, night, users: {} };
}

/** True when check-in is off, or the viewer has chatted this stream day. */
function isEligible(checkIn, name) {
    if (!checkIn || checkIn.required === false) return true;
    return Boolean(checkIn.users && checkIn.users[keyOf(name)]);
}

/** Mark a viewer as here today. Returns true only the first time. */
function markCheckedIn(checkIn, name) {
    const key = keyOf(name);
    if (!key || checkIn.users[key]) return false;
    checkIn.users[key] = true;
    return true;
}

/** Forget everyone checked in (second stream the same day). */
function clearCheckedIn(checkIn) {
    checkIn.users = {};
    return checkIn;
}

Object.assign(exports, { keyOf, forNight, isEligible, markCheckedIn, clearCheckedIn });
