'use strict';
let offset = 0;

/** A transport-time estimate is shared by local DTO adapters without importing the state feed back into itself. */
function observe(timestamp) {
    const value = Date.parse(timestamp);
    if (Number.isFinite(value)) offset = value - Date.now();
}

module.exports = { observe, now: () => Date.now() + offset, offset: () => offset };
