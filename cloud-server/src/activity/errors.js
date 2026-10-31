'use strict';

/** Carry only a safe machine code across the public error boundary. */
function fail(status, code) {
    return Object.assign(new Error(code), { status, code });
}

module.exports = { fail };
