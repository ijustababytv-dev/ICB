'use strict';
const { envelope } = require('./activity-normalize');
const SUPPORT = ['sub', 'gifts', 'bits', 'tip', 'purchase', 'follow', 'raid'];
const AUDIT = [
    'chat_window',
    'manual',
    'winner',
    'winners_reset',
    'reset',
    'jar_emptied',
    'backup_restored'
];

/** Convert supported decimal currency amounts to exact minor units; ambiguous precision is uncounted. */
function minorUnits(amount, currency) {
    if (
        !/^[A-Z]{3}$/.test(currency || '') ||
        !Intl.supportedValuesOf('currency').includes(currency)
    )
        return null;
    const precision = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits;
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(amount));
    if (!match || (match[2] || '').length > precision) return null;
    const result =
        BigInt(match[1]) * BigInt(10) ** BigInt(precision) +
        BigInt((match[2] || '').padEnd(precision, '0') || '0');
    return result > BigInt(0) && result <= BigInt(1000000000) ? Number(result) : null;
}

/** Bound integer contributions before performing any existing local ticket math. */
function whole(value, min = 0, max = 1000000000) {
    const result = Number(value);
    return Number.isSafeInteger(result) && result >= min && result <= max ? result : null;
}

/** Allowlist supporter fields and actual historical ticket deltas; omit recipients and text. */
function normalizeSupport(body, timezone = 'America/Chicago', at) {
    if (![...SUPPORT, ...AUDIT].includes(body.type)) return null;
    const out = envelope(body.type, body, timezone, at);
    if (
        ['sub', 'bits', 'follow', 'chat_window', 'manual', 'winner'].includes(body.type) &&
        !out.viewer
    )
        return null;
    if (['sub', 'gifts', 'bits', 'chat_window', 'manual'].includes(body.type))
        out.ticket_delta = whole(body.unicorns ?? body.ticket_delta ?? 0, -1000000000);
    if (body.type === 'sub') {
        out.months = whole(body.months ?? 1, 1, 24);
        if (body.tier) out.tier = String(body.tier).slice(0, 40);
        if (body.subType || body.subtype)
            out.subtype = String(body.subType || body.subtype).slice(0, 40);
    }
    if (body.type === 'gifts') {
        out.quantity = whole(body.count ?? body.quantity, 1);
        out.anonymous = !out.viewer;
        if (body.tier) out.tier = String(body.tier).slice(0, 40);
    }
    if (body.type === 'bits') out.bits = whole(body.amount ?? body.bits, 1);
    if (body.type === 'raid') out.raid_size = whole(body.viewers ?? body.raid_size ?? 0);
    if (['tip', 'purchase'].includes(body.type)) {
        out.currency = String(body.currency || '').toUpperCase();
        out.money_minor =
            body.money_minor === undefined
                ? minorUnits(body.amount, out.currency)
                : whole(body.money_minor, 1);
        if (out.money_minor !== null && body.count !== undefined) {
            const count = whole(body.count, 1, 10000);
            out.money_minor = count === null ? null : whole(out.money_minor * count, 1);
        }
        out.anonymous = !out.viewer;
    }
    return ['months', 'quantity', 'bits', 'raid_size', 'ticket_delta', 'money_minor'].some(
        (key) => key in out && out[key] === null
    )
        ? null
        : out;
}

module.exports = { normalizeSupport, minorUnits, whole, SUPPORT, AUDIT };
