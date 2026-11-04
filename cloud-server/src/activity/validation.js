'use strict';
const { fail } = require('./errors');
const { reportingDay } = require('./reporting-day');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = [
    'chat_count',
    'sub',
    'gifts',
    'bits',
    'tip',
    'purchase',
    'follow',
    'raid',
    'chat_window',
    'manual',
    'winner',
    'winners_reset',
    'reset',
    'jar_emptied',
    'backup_restored'
];
const AUDIT_TYPES = TYPES.slice(8);
const PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'fourthwall', 'meld', 'unknown'];
const FIELDS = {
    chat_count: ['message_delta'],
    sub: ['months', 'tier', 'subtype', 'ticket_delta'],
    gifts: ['quantity', 'tier', 'anonymous', 'ticket_delta'],
    bits: ['bits', 'ticket_delta'],
    tip: ['money_minor', 'currency', 'anonymous'],
    purchase: ['money_minor', 'currency', 'anonymous'],
    follow: [],
    raid: ['raid_size'],
    chat_window: ['ticket_delta'],
    manual: ['ticket_delta'],
    winner: [],
    winners_reset: [],
    reset: [],
    jar_emptied: [],
    backup_restored: []
};

/** Reject unknown properties, including raw data, text, and client-supplied owners. */
function fields(value, allowed) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !allowed.includes(key))
    )
        throw fail(400, 'invalid_fields');
}

/** Validate bounded metadata strings without allowing control characters. */
function text(value, max = 160) {
    if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value))
        throw fail(400, 'invalid_string');
    return value;
}

/** Use one canonical account key for provisioning and login. */
function loginName(value) {
    const result = String(value || '')
        .trim()
        .toLowerCase();
    if (!/^[a-z0-9_]{1,32}$/.test(result)) throw fail(400, 'invalid_login');
    return result;
}

/** Bound arithmetic before values reach BIGINT summary counters. */
function integer(value, min = 0, max = 1000000000) {
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw fail(400, 'invalid_integer');
    return value;
}

/** Validate UUIDs before using them in PostgreSQL typed columns. */
function uuid(value) {
    if (typeof value !== 'string' || !UUID.test(value)) throw fail(400, 'invalid_uuid');
    return value.toLowerCase();
}

/** Require actual calendar dates rather than permissive Date parsing. */
function day(value) {
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value || '') ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
    )
        throw fail(400, 'invalid_date');
    return value;
}

/** Keep owner/platform identity distinct and never merge known IDs by display names. */
function viewer(value) {
    if (value === null) return null;
    fields(value, ['platform', 'platform_user_id', 'username', 'display_name']);
    if (!PLATFORMS.includes(value.platform)) throw fail(400, 'invalid_platform');
    text(value.username, 80);
    text(value.display_name, 80);
    if (value.platform_user_id !== null) text(value.platform_user_id, 160);
    if (value.username !== value.username.trim().toLowerCase()) throw fail(400, 'invalid_viewer');
    return value;
}

/** Accept only minimal records; timestamps and days are verified in the owner's timezone. */
function record(value, timezone, now = Date.now(), allowUnknownAwards = false) {
    if (!TYPES.includes(value?.type)) throw fail(400, 'invalid_type');
    fields(value, [
        'id',
        'type',
        'at',
        'day',
        'timezone',
        'viewer',
        'platform',
        'source_id',
        ...FIELDS[value.type]
    ]);
    uuid(value.id);
    if (!PLATFORMS.includes(value.platform)) throw fail(400, 'invalid_platform');
    const at = Date.parse(value.at);
    if (
        typeof value.at !== 'string' ||
        !Number.isFinite(at) ||
        at < Date.UTC(2020, 0, 1) ||
        at > now + 300000
    )
        throw fail(400, 'invalid_timestamp');
    if (value.timezone !== timezone || day(value.day) !== reportingDay(value.at, timezone))
        throw fail(400, 'invalid_reporting_day');
    viewer(value.viewer);
    if (value.viewer && value.viewer.platform !== value.platform) throw fail(400, 'invalid_viewer');
    if (value.source_id !== null) text(value.source_id);
    if (
        value.viewer === null &&
        ['chat_count', 'sub', 'bits', 'chat_window', 'manual', 'follow', 'winner'].includes(
            value.type
        )
    )
        throw fail(400, 'viewer_required');
    if (['gifts', 'tip', 'purchase'].includes(value.type)) {
        if (typeof value.anonymous !== 'boolean' || value.anonymous !== (value.viewer === null))
            throw fail(400, 'invalid_anonymity');
    }
    for (const key of FIELDS[value.type]) {
        if (['tier', 'subtype'].includes(key)) {
            if (value[key] !== undefined) text(value[key], 40);
        } else if (key === 'currency') {
            if (!/^[A-Z]{3}$/.test(value[key] || '')) throw fail(400, 'invalid_currency');
        } else if (
            key !== 'anonymous' &&
            !(key === 'ticket_delta' && value[key] === null && allowUnknownAwards)
        )
            integer(
                value[key],
                key === 'ticket_delta'
                    ? -1000000000
                    : ['message_delta', 'months', 'quantity', 'bits', 'money_minor'].includes(key)
                    ? 1
                    : 0
            );
    }
    if (value.months > 24) throw fail(400, 'invalid_months');
    return value;
}

/** Bound immutable ingestion envelopes before opening a transaction. */
function batch(value, timezone) {
    fields(value, [
        'schema_version',
        'batch_id',
        'collector_id',
        'sealed_at',
        'migration_id',
        'records'
    ]);
    if (value.schema_version !== 1) throw fail(400, 'invalid_schema');
    uuid(value.batch_id);
    uuid(value.collector_id);
    if (value.migration_id !== null) uuid(value.migration_id);
    if (
        !Number.isFinite(Date.parse(value.sealed_at)) ||
        Date.parse(value.sealed_at) > Date.now() + 300000
    )
        throw fail(400, 'invalid_timestamp');
    if (!Array.isArray(value.records) || !value.records.length || value.records.length > 500)
        throw fail(400, 'invalid_batch_size');
    const eventIds = new Set();
    value.records.forEach((item) => {
        record(item, timezone, Date.now(), value.migration_id !== null);
        const id = item.id.toLowerCase();
        if (eventIds.has(id)) throw fail(400, 'duplicate_event_id');
        eventIds.add(id);
    });
    return value;
}

module.exports = {
    fields,
    text,
    loginName,
    integer,
    uuid,
    day,
    viewer,
    record,
    batch,
    TYPES,
    AUDIT_TYPES
};
