'use strict';
const { randomUUID } = require('node:crypto');
const session = require('./session');
const feed = require('./state-feed');
const collector = require('../activity/collector');
const { normalizeSupport } = require('../domain/support-normalize');
const presence = new Map();
const pendingPresence = new Map();
const boot = randomUUID();
let bootOwner = null;
let bootCommand = null;
let bootReady = false;
collector.onAcknowledged((item) => {
    if (item.id === bootCommand && item.owner_id === bootOwner) bootReady = true;
});

/** Seal minimal collector operands before the first request; no raw body or chat text enters retries. */
function enqueue(feature, action, operands) {
    const active = session.current();
    if (!active || !collector.canCollect(active)) throw new Error('cloud_collector_required');
    if (
        feed.authority(feature)?.mode !== 'cloud' ||
        feed.authority(feature)?.protocol_version !== 2
    )
        throw new Error('feature_not_migrated');
    const id = collector.queue().enqueueFeature(
        active.account.id,
        feature,
        action,
        {
            at: new Date(Date.now() + (Number(feed.status().clock_offset_ms) || 0)).toISOString(),
            source_key: 'input:' + randomUUID(),
            ...operands
        },
        feed.watchedPaths()
    );
    collector.sync();
    return id;
}

/** Estimate collection time from the authenticated cloud clock without retaining a message. */
function timestamp() {
    return new Date(Date.now() + (Number(feed.status().clock_offset_ms) || 0)).toISOString();
}

/** One presence per anchored window is batched separately from prompt interactive commands. */
function notePresence(body) {
    const active = session.current();
    const document = feed.document('giveaway.json') || feed.watch('/api/giveaway/state')?.giveaway;
    if (!active || !collector.canCollect(active) || !document?.windowStartedAt)
        throw new Error('cloud_loading');
    const sender = String(body.username || '')
        .trim()
        .replace(/^@/, '')
        .slice(0, 80);
    if (!sender) return;
    const at = timestamp();
    const anchor = Date.parse(document.windowStartedAt);
    const window = anchor + Math.floor((Date.parse(at) - anchor) / 600000) * 600000;
    const key = [active.account.id, window, sender.toLowerCase()].join(':');
    if (presence.has(key)) return;
    if (pendingPresence.size >= 50000) throw new Error('outbox_full');
    pendingPresence.set(key, { owner: active.account.id, sender, at });
    presence.set(key, Date.now());
    for (const [id, time] of presence) if (time < Date.now() - 1200000) presence.delete(id);
}

/** Freeze timestamped presence in bounded batches; failed disk writes leave the captured facts pending. */
function flushPresence() {
    const grouped = new Map();
    for (const [key, value] of pendingPresence) {
        const group = grouped.get(value.owner) || [];
        group.push([key, value]);
        grouped.set(value.owner, group);
    }
    for (const [owner, entries] of grouped)
        for (let index = 0; index < entries.length; index += 100) {
            const part = entries.slice(index, index + 100);
            collector.queue().enqueueFeature(owner, 'giveaway', 'intent', {
                kind: 'presence_batch',
                source_key: 'presence-batch:' + randomUUID(),
                at: timestamp(),
                viewers: part.map(([, entry]) => ({ sender: entry.sender, at: entry.at }))
            });
            for (const [key] of part) pendingPresence.delete(key);
        }
    collector.sync();
}

/** Startup stock is reset once per explicit Node collector boot, not per Lambda invocation. */
function startSession() {
    const active = session.current();
    if (
        !active ||
        bootOwner === active.account.id ||
        !collector.canCollect(active) ||
        ['live', 'resource-trackers', 'tradeup-state'].some(
            (feature) => feed.authority(feature)?.mode !== 'cloud'
        )
    )
        return;
    bootReady = false;
    bootCommand = enqueue('live', 'collector_start', {
        source_key: 'boot:' + boot,
        session_id: boot
    });
    bootOwner = active.account.id;
}

/** A reader cannot overtake its queued startup boundary. */
function ready() {
    return bootReady && !!bootOwner && bootOwner === session.current()?.account.id;
}

/** Parsed game batches have stable per-line source identities independent of transport retries. */
function game(facts) {
    if (!ready()) throw new Error('game_session_required');
    return enqueue('live', 'game', { session_id: boot, facts });
}

/** Support transport retains units and identity only; ticket amounts are decided by cloud rules. */
function support(body) {
    const active = session.current();
    const record = normalizeSupport(body, active?.account.timezone);
    if (!record) throw new Error('unsupported_support_shape');
    const fact = Object.fromEntries(
        [
            'type',
            'months',
            'quantity',
            'bits',
            'currency',
            'money_minor',
            'raid_size',
            'tier',
            'subtype',
            'platform'
        ]
            .filter((key) => record[key] !== undefined)
            .map((key) => [key, record[key]])
    );
    if (record.viewer?.platform_user_id) fact.platform_user_id = record.viewer.platform_user_id;
    return enqueue('giveaway', 'intent', {
        kind: 'support',
        sender: record.viewer?.display_name || '',
        support: fact,
        source_key: record.source_id
            ? [record.platform, record.type, record.source_id].join(':')
            : 'support:' + record.id
    });
}

module.exports = {
    enqueue,
    notePresence,
    flushPresence,
    support,
    startSession,
    ready,
    game,
    timestamp
};
