'use strict';
const parser = require('../../src/domain/log-parser');

/** Preserve existing generic unit-fixture tokens while exercising the normalized cloud rule boundary. */
function fixtureFact(line) {
    const match = parser.EVENT_LINE_PATTERN.exec(line);
    if (!match) return null;
    const items = [];
    const tokens = /(itemtype_[a-z0-9_]+)(\s*\(([0-9]+)\*\))?/gi;
    let item;
    while ((item = tokens.exec(line)) !== null)
        items.push({
            token: item[1].toLowerCase(),
            quantity: parser.quantityFor(line.slice(item.index), item[1]),
            star: !!item[2]
        });
    return { source: match[1].toLowerCase(), direction: match[2].toLowerCase(), items };
}

module.exports = { fixtureFact };
