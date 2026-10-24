'use strict';

/** Chat checks in only the matching signed-up Twitch account and never changes an existing timestamp. */
function checkInViewer(event, twitch, now = Date.now()) {
    const guest = event.guests.find(
        (g) => g.twitch && g.twitch.toLowerCase() === twitch.toLowerCase()
    );
    if (!guest) return { changed: false, reply: `${twitch} isn't signed up` };
    if (guest.checkedIn) return { changed: false, reply: `${guest.name} is already checked in` };
    guest.checkedIn = now;
    return { changed: true, reply: `${guest.name} is here ✅` };
}

/** Dashboard commands toggle or explicitly set one guest; unknown guest numbers change nothing. */
function setCheckin(event, number, on, now = Date.now()) {
    const guest = event.guests.find((g) => g.n === Number(number));
    if (!guest) return;
    guest.checkedIn = typeof on === 'boolean' ? (on ? now : null) : guest.checkedIn ? null : now;
}

/** Reset attendance while preserving signups, roles, and remembered viewer names. */
function resetCheckins(event) {
    for (const guest of event.guests) guest.checkedIn = null;
}

module.exports = { checkInViewer, setCheckin, resetCheckins };
