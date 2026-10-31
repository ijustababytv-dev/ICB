'use strict';
const { createHash } = require('node:crypto');

/** Transport clock fields do not make an unchanged overlay DTO require another full download. */
function viewDigest(value) {
    return createHash('sha256')
        .update(JSON.stringify(value, (key, item) => (key === 'now' ? undefined : item)))
        .digest('hex');
}

module.exports = { viewDigest };
