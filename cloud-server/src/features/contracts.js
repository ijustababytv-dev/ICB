'use strict';
const { createHash } = require('node:crypto');
const { fields, uuid, integer } = require('../activity/validation');
const { canonical } = require('../domain/canonical');
const { fail } = require('../activity/errors');

const PRIVATE =
    /^(?:__proto__|prototype|constructor|password|token|apiKey|secret|authorization|raw|line|lastEvent|lastMessage|parts|fragments|senderInfo|bubble|cloudAuditPending)$/i;

/** Feature state contains intentional settings/semantic entries, never chat transcripts or credentials. */
function safeValue(value, depth = 0) {
    if (depth > 18) throw fail(400, 'feature_too_deep');
    if (typeof value === 'string' && (value.length > 6000 || /^data:.*;base64,/i.test(value)))
        throw fail(400, 'invalid_feature_string');
    if (typeof value === 'number' && !Number.isFinite(value))
        throw fail(400, 'invalid_feature_number');
    if (value && typeof value === 'object') {
        if (Object.keys(value).length > 12000) throw fail(413, 'feature_too_large');
        for (const [key, child] of Object.entries(value)) {
            if (PRIVATE.test(key)) throw fail(400, 'private_feature_field');
            safeValue(child, depth + 1);
        }
    }
    return value;
}

/** Imports explicitly discard old diagnostic/chat fields; live commands reject them instead. */
function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !PRIVATE.test(key) && key !== 'reader')
                .map(([key, child]) => [key, sanitize(child)])
        );
    return value;
}

/** Authenticate before validating a bounded, retry-stable mutation envelope. */
function command(body) {
    fields(body, [
        'protocol_version',
        'command_id',
        'expected_revision',
        'action',
        'operands',
        'collector_id'
    ]);
    if (body.protocol_version !== 2) throw fail(409, 'feature_protocol_required');
    uuid(body.command_id);
    integer(body.expected_revision, 0, Number.MAX_SAFE_INTEGER);
    if (!['request', 'intent', 'game', 'collector_start', 'refresh'].includes(body.action))
        throw fail(400, 'invalid_feature_action');
    if (body.collector_id !== undefined) uuid(body.collector_id);
    safeValue(body.operands);
    if (Buffer.byteLength(JSON.stringify(body)) > 250000) throw fail(413, 'body_too_large');
    return body;
}

/** One command ID can acknowledge only one canonical payload, regardless of JSON key order. */
function digest(body) {
    return createHash('sha256').update(canonical(body)).digest('hex');
}

module.exports = { safeValue, sanitize, command, digest };
