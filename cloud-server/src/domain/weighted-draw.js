'use strict';
const { randomInt } = require('node:crypto');

/** Draw without allocating one array element per ticket; all weights remain exact integers. */
function weightedDraw(entries) {
    const total = entries.reduce((sum, item) => sum + item.tickets, 0);
    if (!Number.isSafeInteger(total) || total <= 0 || total >= 2 ** 48)
        throw new Error('invalid_drawing_weight');
    let choice = randomInt(total);
    for (const entry of entries) {
        if (choice < entry.tickets) return { name: entry.name, total };
        choice -= entry.tickets;
    }
    throw new Error('invalid_drawing_weight');
}

module.exports = { weightedDraw };
