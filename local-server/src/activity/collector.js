'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const config = require('../config');
const session = require('../cloud/session');
const { createOutbox } = require('./outbox');
const { envelope } = require('../domain/activity-normalize');
const { normalizeSupport } = require('../domain/support-normalize');
let outbox;
let problem = null;
const counts = new Map();
const seen = new Map();
let inFlight = false;
let nextAttempt = 0;
let failures = 0;
let leaseUntil = 0;
let leaseOwner = null;
let leaseDenied = false;
let uncountedEvents = 0;

/** Lazily open the checkpoint so imports and unit tests do not start jobs or write live state. */
function queue() {
    if (!outbox) outbox = createOutbox(path.join(config.DATA_DIR, 'activity-outbox.json'));
    return outbox;
}

/** Keep shared-PC account changes from copying another owner's local balances or saved state. */
function canCollect(active = session.current()) {
    if (!active) return false;
    if (leaseDenied && leaseOwner === active.account.id) {
        problem = 'collector_in_use';
        return false;
    }
    const allowed = queue().bindOwner(active.account.id);
    if (!allowed) problem = 'local_data_belongs_to_another_account';
    return allowed;
}

/** Expose sync health without tokens, raw payloads, or passwords. */
function status() {
    try {
        const state = queue().get();
        return {
            signed_in: !!session.current(),
            account: session.current()?.account || null,
            pending: state.pending.length,
            quarantined: state.quarantine.length,
            last_ack: state.last_ack,
            code: state.quarantine.length
                ? 'quarantined_records'
                : problem || (!session.current() ? 'login_required' : null),
            collector_id: state.collector_id,
            uncounted_events: uncountedEvents
        };
    } catch (_error) {
        return {
            signed_in: !!session.current(),
            pending: null,
            quarantined: null,
            code: 'outbox_unreadable'
        };
    }
}

/** Drop upstream duplicates only when a real source ID exists; never hash message text. */
function acceptSource(platform, id, type) {
    const now = Date.now();
    for (const [key, expires] of seen) {
        if (expires <= now) seen.delete(key);
        else break;
    }
    if (!id) return true;
    const key =
        String(session.current()?.account.id || '') + ':' + platform + ':' + type + ':' + id;
    if (seen.has(key)) return false;
    seen.set(key, now + 300000);
    if (seen.size > 10000) seen.delete(seen.keys().next().value);
    return true;
}

/** Count every live message, including commands and blocked giveaway users, without retaining text. */
function chat(body) {
    const active = session.current();
    if (!active) {
        problem = 'login_required';
        return;
    }
    if (!canCollect(active)) return;
    if (!queue().canAccept()) {
        problem = 'outbox_full';
        return;
    }
    const record = envelope('chat_count', body, active.account.timezone);
    if (!record.viewer) return;
    const owner = active.account.id;
    if (
        [...counts.values()].some(
            (item) => item.owner_id === owner && item.record.day !== record.day
        )
    )
        flushCounts();
    const key = [
        owner,
        record.day,
        record.platform,
        record.viewer.platform_user_id || record.viewer.username
    ].join(':');
    const existing = counts.get(key);
    if (!existing && counts.size >= 50000) {
        problem = 'outbox_full';
        return;
    }
    if (existing) existing.record.message_delta++;
    else
        counts.set(key, {
            owner_id: owner,
            record: { ...record, source_id: null, message_delta: 1 }
        });
}

/** Enqueue already normalized minimal events with their original owner. */
function sealRecords(owner, records) {
    let pending = [];
    /** Freeze one bounded envelope before its first network request. */
    function flush() {
        if (!pending.length) return;
        queue().enqueue({
            owner_id: owner,
            kind: 'activity',
            body: {
                schema_version: 1,
                batch_id: randomUUID(),
                collector_id: queue().get().collector_id,
                sealed_at: new Date().toISOString(),
                migration_id: null,
                records: pending
            }
        });
        pending = [];
    }

    for (const record of records) {
        if (
            pending.length >= 500 ||
            Buffer.byteLength(JSON.stringify([...pending, record])) > 245000
        )
            flush();
        pending.push(record);
    }
    flush();
}

/** Make only minimal supporter/audit data eligible for a durable local award checkpoint. */
function prepare(body) {
    const active = session.current();
    if (!active) {
        problem = 'login_required';
        return null;
    }
    if (!canCollect(active)) return null;
    const record = normalizeSupport(body, active.account.timezone);
    if (!record) {
        problem = 'unsupported_event';
        return null;
    }
    return { owner_id: active.account.id, record };
}

/** Seal accumulated counts, preserving unsaved deltas when an atomic write fails. */
function flushCounts() {
    const chunks = [];
    for (const [key, item] of counts) {
        let chunk = chunks[chunks.length - 1];
        if (
            !chunk ||
            chunk.owner !== item.owner_id ||
            chunk.records.length >= 500 ||
            Buffer.byteLength(JSON.stringify([...chunk.records, item.record])) > 245000
        ) {
            chunk = { owner: item.owner_id, records: [], keys: [] };
            chunks.push(chunk);
        }
        chunk.records.push(item.record);
        chunk.keys.push(key);
    }
    for (const chunk of chunks) {
        try {
            sealRecords(chunk.owner, chunk.records);
            chunk.keys.forEach((key) => counts.delete(key));
        } catch (error) {
            problem = error.message;
            break;
        }
    }
}

/** Use one in-flight HTTPS operation and bounded retry backoff; bad requests remain visible. */
async function sync() {
    if (inFlight || Date.now() < nextAttempt || !session.current()) return;
    inFlight = true;
    const active = session.current();
    try {
        if (!queue().bindOwner(active.account.id)) {
            problem = 'local_data_belongs_to_another_account';
            return;
        }
        if (leaseOwner !== active.account.id) {
            leaseUntil = 0;
            leaseOwner = active.account.id;
        }
        if (Date.now() > leaseUntil - 30000) {
            const claim = await session.call(
                '/v1/collectors/claim',
                'POST',
                { collector_id: queue().get().collector_id },
                active.account.id
            );
            if (claim.status === 409) {
                leaseDenied = true;
                leaseUntil = 0;
            }
            if (claim.status !== 200) throw new Error(claim.data.code || 'collector_unavailable');
            leaseDenied = false;
            leaseUntil = Date.parse(claim.data.expires_at);
        }
        const item = queue()
            .get()
            .pending.find((entry) => entry.owner_id === active.account.id);
        if (!item) {
            problem = null;
            failures = 0;
            return;
        }
        const response = await session.call(
            item.kind === 'state'
                ? '/v1/state/' + encodeURIComponent(item.key)
                : '/v1/activity/batches',
            item.kind === 'state' ? 'PUT' : 'POST',
            item.body,
            active.account.id
        );
        if (response.status >= 200 && response.status < 300) {
            if (item.kind === 'activity' && response.data.batch_id !== item.body.batch_id)
                throw new Error('invalid_acknowledgment');
            queue().acknowledge(item);
            problem = null;
            failures = 0;
        } else if (response.status === 401) {
            problem = 'login_required';
        } else if (response.status === 429 || response.status >= 500)
            throw new Error('cloud_unavailable');
        else {
            queue().quarantine(item, response.data.code || 'batch_rejected');
            problem = 'quarantined_records';
        }
    } catch (error) {
        problem = [
            'outbox_full',
            'outbox_unreadable',
            'collector_in_use',
            'collector_lease_expired'
        ].includes(error.message)
            ? error.message
            : 'cloud_unavailable';
        failures++;
        nextAttempt =
            Date.now() +
            Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) * (0.5 + Math.random() * 0.5);
    } finally {
        inFlight = false;
    }
}

/** Run collection timers only from the explicit local server lifecycle. */
function start() {
    const flush = setInterval(flushCounts, 10000);
    const send = setInterval(sync, 1000);
    flush.unref();
    send.unref();
    return () => {
        clearInterval(flush);
        clearInterval(send);
        flushCounts();
    };
}

/** Preserve an operator-visible collection error without exposing event content. */
function noteProblem(code) {
    problem = code;
    if (code === 'unsupported_money_uncounted' || code === 'unsupported_event') uncountedEvents++;
}

/** Pause additional cloud-bound supporter work before local balances mutate when storage is full. */
function requireCapacity() {
    if (session.current() && canCollect() && !queue().canAccept()) {
        problem = 'outbox_full';
        throw new Error('outbox_full');
    }
}

module.exports = {
    status,
    queue,
    chat,
    acceptSource,
    prepare,
    sealRecords,
    flushCounts,
    sync,
    start,
    noteProblem,
    canCollect,
    requireCapacity
};
