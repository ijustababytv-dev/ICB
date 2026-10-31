'use strict';
const { createHash } = require('node:crypto');

/** Preserve a legacy entity's identity across position changes without replacing its existing public ID. */
function stableId(...parts) {
    const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    return (
        hash.slice(0, 8) +
        '-' +
        hash.slice(8, 12) +
        '-5' +
        hash.slice(13, 16) +
        '-a' +
        hash.slice(17, 20) +
        '-' +
        hash.slice(20, 32)
    );
}

module.exports = { stableId };
