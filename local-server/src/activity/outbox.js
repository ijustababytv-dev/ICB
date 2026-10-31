'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/** Keep immutable owner-bound minimal batches in one atomic, serialized local checkpoint. */
function createOutbox(file, limits = { bytes: 20 * 1024 * 1024, records: 50000 }) {
    let state;
    try {
        state = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('outbox_unreadable');
        state = {
            version: 1,
            collector_id: randomUUID(),
            pending: [],
            quarantine: [],
            last_ack: null
        };
    }
    if (state.version !== 1 || !Array.isArray(state.pending) || !Array.isArray(state.quarantine))
        throw new Error('outbox_unreadable');

    let usedBytes = Buffer.byteLength(JSON.stringify(state));
    let usedRecords = [...state.pending, ...state.quarantine].reduce(
        (sum, item) => sum + (item.kind === 'activity' ? item.body.records.length : 1),
        0
    );

    /** Check cached capacity without serializing the queue on every live chat message. */
    function canAccept(records = 1, bytes = 1024) {
        return usedRecords + records <= limits.records && usedBytes + bytes <= limits.bytes;
    }

    /** Write first, then publish the new in-memory state so disk errors cannot fake a checkpoint. */
    function change(operation) {
        const next = structuredClone(state);
        operation(next);
        const content = JSON.stringify(next);
        const count = [...next.pending, ...next.quarantine].reduce(
            (sum, item) => sum + (item.kind === 'activity' ? item.body.records.length : 1),
            0
        );
        if (Buffer.byteLength(content) > limits.bytes || count > limits.records)
            throw new Error('outbox_full');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', content);
        fs.renameSync(file + '.tmp', file);
        state = next;
        usedBytes = Buffer.byteLength(content);
        usedRecords = count;
    }

    /** Accept one sealed envelope only once; retries reuse its unchanged content and identifier. */
    function enqueue(item) {
        if (!/^[0-9a-f-]{36}$/i.test(item.owner_id || '')) throw new Error('owner_required');
        if (Buffer.byteLength(JSON.stringify(item.body)) > 256 * 1024)
            throw new Error('batch_too_large');
        if (!['state', 'activity', 'feature'].includes(item.kind))
            throw new Error('invalid_envelope_kind');
        const id =
            item.kind === 'state'
                ? item.key + ':' + item.body.revision
                : item.kind === 'feature'
                ? item.body.command_id
                : item.body.batch_id;
        if (
            [...state.pending, ...state.quarantine].some(
                (entry) => entry.id === id && entry.owner_id === item.owner_id
            )
        )
            return;
        change((next) => {
            if (item.kind === 'feature') {
                next.feature_protocol = 2;
                if (item.body.operands.sequence !== (next.feature_sequence || 0) + 1)
                    throw new Error('collector_sequence_gap');
                next.feature_sequence = item.body.operands.sequence;
            }
            if (item.kind === 'state')
                next.pending = next.pending.filter(
                    (entry) =>
                        !(
                            entry.kind === 'state' &&
                            entry.owner_id === item.owner_id &&
                            entry.key === item.key
                        )
                );
            next.pending.push({ ...structuredClone(item), id });
        });
    }

    /** Seal an ordered minimal input and its next sequence in the same atomic checkpoint. */
    function enqueueFeature(owner, feature, action, operands, read_paths = []) {
        const body = {
            protocol_version: 2,
            command_id: randomUUID(),
            expected_revision: 0,
            action,
            read_paths,
            collector_id: state.collector_id,
            operands: { ...operands, sequence: (state.feature_sequence || 0) + 1 }
        };
        enqueue({ owner_id: owner, kind: 'feature', feature, body });
        return body.command_id;
    }

    /** Remove data only after an acknowledgment for the exact queued owner and item. */
    function acknowledge(item) {
        change((next) => {
            next.pending = next.pending.filter(
                (entry) => !(entry.id === item.id && entry.owner_id === item.owner_id)
            );
            next.last_ack = new Date().toISOString();
        });
    }

    /** Retain rejected records visibly instead of silently dropping supporter data. */
    function quarantine(item, code) {
        change((next) => {
            next.pending = next.pending.filter(
                (entry) => !(entry.id === item.id && entry.owner_id === item.owner_id)
            );
            next.quarantine.push({ ...item, code });
        });
    }

    /** Rebind only an empty transport checkpoint; pending records always retain their original owner. */
    function bindOwner(owner) {
        if (
            !state.bound_owner ||
            (state.feature_protocol === 2 &&
                state.bound_owner !== owner &&
                !state.pending.length &&
                !state.quarantine.length)
        )
            change((next) => {
                if (next.bound_owner && next.bound_owner !== owner) {
                    next.collector_id = randomUUID();
                    next.feature_sequence = 0;
                }
                next.bound_owner = owner;
            });
        return state.bound_owner === owner;
    }

    return {
        hasRejectedFeature: (owner) =>
            state.quarantine.some((item) => item.kind === 'feature' && item.owner_id === owner),

        lookup: (id, owner) => ({
            pending: state.pending.some((item) => item.id === id && item.owner_id === owner),
            rejected:
                state.quarantine.find((item) => item.id === id && item.owner_id === owner)?.code ||
                null
        }),

        enqueue,
        enqueueFeature,
        acknowledge,
        quarantine,
        bindOwner,
        canAccept,
        get: () => structuredClone(state)
    };
}

module.exports = { createOutbox };
