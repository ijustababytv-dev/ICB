'use strict';
const parser = require('./log-parser');
const resources = require('../../config/resource-trackers.json');
const weekly = require('../../config/weekly-accomplishments.json');
const { RESOURCE_META } = require('./resources');
const tokens = new Set(Object.values(RESOURCE_META).map((entry) => entry.token));
const prefixes = new Set();
const tokenPatterns = [];

/** Only already verified tracker tokens/prefixes are eligible for transport. */
function collect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        if (key === 'tokens' && Array.isArray(item))
            item.forEach((token) => tokens.add(token.toLowerCase()));
        else if (key === 'token' && typeof item === 'string' && item.startsWith('itemtype_'))
            tokens.add(item.toLowerCase());
        else if (key === 'tokenPrefix' && typeof item === 'string')
            prefixes.add(item.toLowerCase());
        else if (key === 'tokenPattern' && typeof item === 'string')
            tokenPatterns.push(new RegExp(item, 'i'));
        else if (item && typeof item === 'object') collect(item);
    }
}

collect(resources);
collect(weekly);

/** Parse source text on this PC; cloud contracts contain only incremental quantities and quality flags. */
function gameFact(line) {
    if (/MAP_IntroMovie|MAP_PreGame/.test(line)) return { kind: 'login' };
    const event = parser.EVENT_LINE_PATTERN.exec(line);
    if (!event) return null;
    const items = [];
    const pattern = /(itemtype_[a-z0-9_]+)(\s*\(([0-9]+)\*\))?/gi;
    let match;
    while ((match = pattern.exec(line)) !== null) {
        const token = match[1].toLowerCase();
        if (
            !tokens.has(token) &&
            ![...prefixes].some((prefix) => token.startsWith(prefix)) &&
            !tokenPatterns.some((pattern) => pattern.test(token))
        )
            continue;
        const quantity = parser.quantityFor(line.slice(match.index), token);
        if (Number.isSafeInteger(quantity) && quantity > 0)
            items.push({ token, quantity, star: !!match[2] });
    }
    return items.length
        ? { source: event[1].toLowerCase(), direction: event[2].toLowerCase(), items }
        : null;
}

module.exports = { gameFact };
