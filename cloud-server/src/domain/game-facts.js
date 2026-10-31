'use strict';

/** Accept normalized incremental facts only; raw lines and Primary resyncs never enter cloud rules. */
function valid(event) {
    return (
        event &&
        ['inventory', 'lockbox'].includes(event.source) &&
        ['gained', 'lost'].includes(event.direction) &&
        Array.isArray(event.items) &&
        event.items.every(
            (item) =>
                /^itemtype_[a-z0-9_]+$/.test(item.token) &&
                Number.isSafeInteger(item.quantity) &&
                item.quantity > 0 &&
                typeof item.star === 'boolean'
        )
    );
}

/** Sum a verified token's quantities from an already-parsed source event. */
function quantityFor(event, token) {
    return event.items.find((item) => item.token === token.toLowerCase())?.quantity || 0;
}

/** Collection cards may opt into a verified token prefix. */
function quantityForPrefix(event, prefix) {
    return event.items
        .filter((item) => item.token.startsWith(prefix.toLowerCase()))
        .reduce((sum, item) => sum + item.quantity, 0);
}

module.exports = { valid, quantityFor, quantityForPrefix };
