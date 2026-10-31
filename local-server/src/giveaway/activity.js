'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { reportingDay } = require('../domain/reporting-day');
const collector = require('../activity/collector');
const { SUPPORT, AUDIT } = require('../domain/support-normalize');
const context = new AsyncLocalStorage();
let pending = [];

// Activity archives are retired. Only minimal owner-bound audit markers survive
// until the outbox accepts them; reports read independent PostgreSQL summaries.
/** Group overnight activity by its six-AM Chicago wall-clock reporting date. */
function nightKey(date) {
    return reportingDay(date, 'America/Chicago');
}

/** Stage compact reporting data, never message content or arbitrary provider fields. */
function logActivity(entry) {
    if (entry.type !== 'chat' && !SUPPORT.includes(entry.type) && !AUDIT.includes(entry.type))
        return;
    const body = { ...(context.getStore() || {}), ...entry };
    if (entry.type === 'chat') {
        collector.chat(body);
        return;
    }
    const prepared = collector.prepare(body);
    if (prepared) {
        if (pending.length >= 50000) throw new Error('audit_checkpoint_full');
        pending.push(prepared);
    }
}

/** Recover already-applied minimal awards without replaying ticket rules. */
function recover(entries) {
    pending = Array.isArray(entries) ? entries : [];
}

/** Carry source identity through the award engine without retaining chat text. */
function withEvent(body, operation) {
    return context.run(body, operation);
}

/** Save these owner-bound markers atomically with their applied local ticket balances. */
function checkpoint() {
    return structuredClone(pending);
}

/** Failed outbox writes leave saved markers available for recovery; tickets are never replayed. */
function commit() {
    while (pending.length) {
        const owner = pending[0].owner_id;
        const records = [];
        for (const item of pending) {
            if (
                item.owner_id !== owner ||
                records.length >= 500 ||
                Buffer.byteLength(JSON.stringify([...records, item.record])) > 245000
            )
                break;
            records.push(item.record);
        }
        try {
            collector.sealRecords(owner, records);
            pending.splice(0, records.length);
        } catch (error) {
            collector.noteProblem(
                error.message === 'outbox_full' ? 'outbox_full' : 'audit_checkpoint_failed'
            );
            return false;
        }
    }
    return true;
}

Object.assign(exports, { nightKey, logActivity, recover, withEvent, checkpoint, commit });
