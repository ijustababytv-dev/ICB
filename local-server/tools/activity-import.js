'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const { envelope } = require('../src/domain/activity-normalize');
const { normalizeSupport } = require('../src/domain/support-normalize');
const VERSION = 1;

/** Derive restartable UUIDs from source bytes and explicit importer keys, never message text. */
function stableId(source, key) {
    const hex = createHash('sha256')
        .update(source + ':' + VERSION + ':' + key)
        .digest('hex');
    return (
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-5' +
        hex.slice(13, 16) +
        '-a' +
        hex.slice(17, 20) +
        '-' +
        hex.slice(20, 32)
    );
}

/** Read JSONL incrementally; malformed records are counted and never echoed. */
async function scan(file, visit) {
    const lines = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity
    });
    let index = 0;
    for await (const line of lines) {
        index++;
        if (!line.trim()) continue;
        let entry;
        try {
            entry = JSON.parse(line.replace(/^\uFEFF/, ''));
        } catch (_error) {
            await visit(null, index);
            continue;
        }
        await visit(entry, index);
    }
}

/** Hash the original file by streaming its bytes instead of loading chat history into memory. */
async function hashFile(file) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

/** Interpret only provider shapes verified in Meld and existing archives; missing data stays unknown. */
function rawSupport(entry) {
    const data = entry.data || {};
    const name = (value) =>
        typeof value === 'string' ? value : value?.displayname || value?.username || '';

    const base = { at: entry.at, source_id: typeof data.id === 'string' ? data.id : null };
    if (entry.kind === 'sub' && !/GIFT/.test(data.sub_type || ''))
        return [
            {
                ...base,
                type: 'sub',
                username: name(data.subscriber),
                months: data.months_purchased,
                tier: data.sub_level,
                subType: data.sub_type
            }
        ];
    if (entry.kind === 'gifts')
        return [
            {
                ...base,
                type: 'gifts',
                username: name(data.gifter),
                anonymous: !!data.anonymous,
                count: data.count,
                tier: data.sub_level
            }
        ];
    if (entry.kind === 'follow')
        return [{ ...base, type: 'follow', username: name(data.follower) }];
    if (entry.kind === 'raid')
        return [{ ...base, type: 'raid', username: name(data.host), viewers: data.viewers }];
    if (entry.kind === 'purchase')
        return [
            {
                ...base,
                type: 'purchase',
                username: name(data.purchaser),
                amount: data.total_amount,
                currency: data.currency
            }
        ];
    if (entry.kind !== 'chat') return [];
    const result = [];
    let bits = 0;
    for (const [i, donation] of (Array.isArray(data.donations) ? data.donations : []).entries()) {
        const count = Number.isInteger(donation.count) && donation.count > 0 ? donation.count : 1;
        if (
            donation.type === 'TWITCH_BITS' &&
            !(data.attributes || []).some((value) =>
                ['HIGHLIGHTED', 'ANNOUNCEMENT'].includes(value)
            )
        ) {
            if (Number.isFinite(donation.amount) && donation.amount > 0)
                bits += Math.round(donation.amount) * count;
        } else if (
            ['YOUTUBE_SUPER_CHAT', 'YOUTUBE_SUPER_STICKER', 'FOURTHWALL_DONATION'].includes(
                donation.type
            )
        )
            result.push({
                ...base,
                type: 'tip',
                username: name(data.sender),
                amount: donation.amount,
                count,
                currency: donation.currency,
                source_id: base.source_id ? base.source_id + ':tip:' + i : null
            });
    }
    if (bits) result.push({ ...base, type: 'bits', username: name(data.sender), amount: bits });
    return result;
}

/** Build a minimal import with one chat representation/day and conservative support matching. */
async function buildImport(file, cutoff, timezone = 'America/Chicago') {
    if (!Number.isFinite(Date.parse(cutoff))) throw new Error('cutoff_required');
    const hash = await hashFile(file);
    const stats = {
        file: path.basename(file),
        source_sha256: hash,
        malformed: 0,
        raw_chats: 0,
        structured_chats: 0,
        unequal_chat_days: 0,
        ambiguous_support: 0,
        unknown_ticket_deltas: 0,
        ignored_after_cutoff: 0,
        records: 0,
        partial: false
    };
    const days = new Map();
    const structured = [];
    const raw = [];
    const audits = [];
    await scan(file, (entry, index) => {
        if (!entry) {
            stats.malformed++;
            return;
        }
        if (!Number.isFinite(Date.parse(entry.at))) {
            stats.malformed++;
            return;
        }
        if (Date.parse(entry.at) >= Date.parse(cutoff)) {
            stats.ignored_after_cutoff++;
            return;
        }
        if (entry.type === 'chat' || (entry.type === 'raw' && entry.kind === 'chat')) {
            const username = entry.type === 'chat' ? entry.username : entry.data?.sender;
            if (typeof username !== 'string' || !username) return;
            const base = envelope('chat_count', { username }, timezone, entry.at);
            const day = days.get(base.day) || { raw: 0, structured: 0 };
            day[entry.type === 'raw' ? 'raw' : 'structured']++;
            days.set(base.day, day);
            stats[entry.type === 'raw' ? 'raw_chats' : 'structured_chats']++;
        }
        if (entry.type === 'raw')
            rawSupport(entry).forEach((body, offset) =>
                raw.push({
                    body,
                    index: body.type === 'tip' && offset ? index + ':' + offset : index
                })
            );
        else if (['sub', 'gifts', 'bits', 'follow', 'raid', 'tip', 'purchase'].includes(entry.type))
            structured.push({ body: entry, index });
        else if (entry.type === 'chat_unicorns' && Array.isArray(entry.usernames)) {
            entry.usernames.forEach((username, i) =>
                audits.push({
                    body: { type: 'chat_window', username, unicorns: entry.each },
                    at: entry.at,
                    key: index + ':' + i
                })
            );
        } else if (
            [
                'manual',
                'winner',
                'winners_reset',
                'reset',
                'jar_emptied',
                'backup_restored'
            ].includes(entry.type)
        )
            audits.push({ body: entry, at: entry.at, key: index });
    });
    const counts = new Map();
    const seen = new Set();
    await scan(file, (entry) => {
        if (
            !entry ||
            !Number.isFinite(Date.parse(entry.at)) ||
            Date.parse(entry.at) >= Date.parse(cutoff)
        )
            return;
        if (entry.type !== 'chat' && !(entry.type === 'raw' && entry.kind === 'chat')) return;
        const username = entry.type === 'chat' ? entry.username : entry.data?.sender;
        if (typeof username !== 'string' || !username) return;
        const base = envelope('chat_count', { username }, timezone, entry.at);
        const chosen = days.get(base.day).raw > 0 ? 'raw' : 'chat';
        if (entry.type !== chosen) return;
        const source =
            entry.type === 'raw' && typeof entry.data?.id === 'string' ? entry.data.id : null;
        if (source && seen.has(source)) return;
        if (source) seen.add(source);
        const key = base.day + ':' + base.viewer.username;
        if (counts.has(key)) counts.get(key).message_delta++;
        else counts.set(key, { ...base, id: stableId(hash, 'chat:' + key), message_delta: 1 });
    });
    stats.unequal_chat_days = [...days.values()].filter((day) => day.raw !== day.structured).length;
    const records = [...counts.values()];
    const normalized = [];
    for (const item of structured) {
        const record = normalizeSupport(item.body, timezone, item.body.at);
        if (!record) {
            stats.ambiguous_support++;
            continue;
        }
        if (
            ['sub', 'gifts', 'bits'].includes(record.type) &&
            item.body.unicorns === undefined &&
            !item.body.blocked
        ) {
            stats.unknown_ticket_deltas++;
            record.ticket_delta = null;
        }
        normalized.push({ ...item, record });
        records.push({ ...record, id: stableId(hash, 'support:' + item.index) });
    }
    for (const item of raw) {
        const record = normalizeSupport(item.body, timezone, item.body.at);
        if (!record) {
            stats.ambiguous_support++;
            continue;
        }
        const matches = normalized.filter(
            (old) =>
                old.record.type === record.type &&
                old.record.viewer?.username === record.viewer?.username &&
                Math.abs(Date.parse(old.body.at) - Date.parse(item.body.at)) <= 3000 &&
                ['months', 'quantity', 'bits', 'raid_size', 'money_minor', 'currency'].every(
                    (key) => old.record[key] === record[key]
                )
        );
        if (matches.length === 1) continue;
        if (matches.length > 1) {
            stats.ambiguous_support++;
            continue;
        }
        if (['sub', 'gifts', 'bits'].includes(record.type)) {
            stats.unknown_ticket_deltas++;
            record.ticket_delta = null;
        }
        records.push({
            ...record,
            id: stableId(
                hash,
                'raw:' + item.index + ':' + record.type + ':' + (record.source_id || '')
            )
        });
    }
    for (const item of audits) {
        const record = normalizeSupport(item.body, timezone, item.at);
        if (record) records.push({ ...record, id: stableId(hash, 'audit:' + item.key) });
        else stats.ambiguous_support++;
    }
    if ((await hashFile(file)) !== hash) throw new Error('source_changed_during_import');
    stats.records = records.length;
    stats.partial = !!(
        stats.malformed ||
        stats.unequal_chat_days ||
        stats.ambiguous_support ||
        stats.unknown_ticket_deltas
    );
    return { hash, records, stats, version: VERSION };
}

/** Default to read-only aggregate diagnostics; neither message text nor raw bodies are printed. */
async function main() {
    const file = process.argv[2];
    const cutoff = process.argv[3];
    if (!file || !cutoff) throw new Error('Usage: activity-import.js FILE CUTOFF_ISO');
    console.info(JSON.stringify((await buildImport(file, cutoff)).stats, null, 2));
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { buildImport, stableId, hashFile, VERSION };
