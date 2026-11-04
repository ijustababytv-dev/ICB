'use strict';
let active = null;

/** Give one updated Meld listener a short renewable lease, preventing duplicate live collection. */
function claim(id, now = Date.now()) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(id)) return false;
    if (active && active.expires > now && active.id !== id) return false;
    active = { id, expires: now + 15000 };
    return true;
}

/** Older running listener pages retain their compatibility path until their normal reload. */
function permits(id, now = Date.now()) {
    if (id === undefined) return true;
    return !!active && active.id === id && active.expires > now;
}

module.exports = { claim, permits };
