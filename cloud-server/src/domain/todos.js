'use strict';

const mDomainValidation = require('./validation');
const crypto = require('node:crypto');
const mStorage = require('./json');

// Dashboard-only Daily / Weekly to-do lists (added 2026-08-25). Nothing to do with Palia logs -
// Baby types these herself. Confirmed with her: NO auto-reset, items stay until she deletes them.
// Each item is either 'check' (plain done/not-done) or 'goal' (a running count toward a target,
// e.g. "1/100"). "daily" and "weekly" are just two independent lists/labels she manages herself -
// the server never clears either one on any schedule.
const DEFAULT_TODOS = {
    schemaVersion: 1,
    daily: [],
    weekly: [],
    updatedAt: null
};

/** Reject blank todos and normalize checkmarks or nonnegative integer goal progress. */
function normalizeTodoItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = mDomainValidation.cleanString(raw.text);
    if (!text) return null;
    const id =
        mDomainValidation.cleanString(raw.id) ||
        `todo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = mDomainValidation.cleanString(raw.createdAt) || new Date().toISOString();
    if (raw.kind === 'goal') {
        const target = Math.trunc(Number(raw.target));
        const current = Math.trunc(Number(raw.current));
        return {
            id,
            text,
            kind: 'goal',
            createdAt,
            target: Number.isFinite(target) && target > 0 ? target : 1,
            current: Number.isFinite(current) && current >= 0 ? current : 0
        };
    }
    return { id, text, kind: 'check', createdAt, done: Boolean(raw.done) };
}

/** Keep daily and weekly lists independent; their labels never trigger automatic resets. */
function normalizeTodos(value) {
    const out = mStorage.clone(DEFAULT_TODOS);
    if (value && typeof value === 'object') {
        if (Array.isArray(value.daily))
            out.daily = value.daily.map(normalizeTodoItem).filter(Boolean);
        if (Array.isArray(value.weekly))
            out.weekly = value.weekly.map(normalizeTodoItem).filter(Boolean);
        if (value.updatedAt) out.updatedAt = value.updatedAt;
    }
    return out;
}

Object.assign(exports, { normalizeTodos, DEFAULT_TODOS, normalizeTodoItem });
