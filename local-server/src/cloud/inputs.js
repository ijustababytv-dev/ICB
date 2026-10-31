'use strict';
const { randomUUID } = require('node:crypto');
const session = require('./session');
const feed = require('./state-feed');
const collector = require('../activity/collector');
const { normalizeSupport } = require('../domain/support-normalize');
const presence = new Map();

/** Seal minimal collector operands before the first request; no raw body or chat text enters retries. */
function enqueue(feature, action, operands) {
    const active = session.current();
    if (!active || !collector.canCollect(active)) throw new Error('cloud_collector_required');
    if (feed.authority(feature)?.mode !== 'cloud') throw new Error('feature_not_migrated');
    const id = collector.queue().enqueueFeature(active.account.id, feature, action, {
        at: new Date().toISOString(),
        source_key: 'input:' + randomUUID(),
        ...operands
    });
    collector.sync();
    return id;
}

/** One presence fact per actual cloud-anchored window is independent of report message counts. */
function notePresence(body) {
    const active = session.current();
    const document = feed.document('giveaway.json');
    if (!active || !document?.windowStartedAt) throw new Error('cloud_loading');
    const sender = String(body.username || '')
        .trim()
        .replace(/^@/, '')
        .slice(0, 80);
    if (!sender) return;
    const anchor = Date.parse(document.windowStartedAt);
    const window = anchor + Math.floor((Date.now() - anchor) / 600000) * 600000;
    const key = [active.account.id, window, sender.toLowerCase()].join(':');
    if (presence.has(key)) return;
    enqueue('giveaway', 'intent', { kind: 'presence', sender, source_key: 'presence:' + key });
    presence.set(key, Date.now());
    for (const [id, at] of presence) if (at < Date.now() - 1200000) presence.delete(id);
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

module.exports = { enqueue, notePresence, support };
