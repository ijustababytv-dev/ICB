'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const config = require('../config');
const session = require('../cloud/session');
const collector = require('./collector');
const { byFile } = require('../../../cloud-server/src/features/catalog');
const manifest = JSON.parse(
    fs.readFileSync(path.join(config.APP_DIR, 'database/state-manifest.json'), 'utf8')
);
const dirty = new Set();
const hashes = new Map();
const FORBIDDEN =
    /^(?:__proto__|prototype|constructor|password|token|secret|authorization|raw|line|lastEvent|message|lastMessage|parts|fragments|senderInfo|bubble)$/i;
let revision = 0;

/** Copy allowlisted saved settings/progress, excluding transient chat fields and credentials. */
function sanitize(value, depth = 0) {
    if (depth > 15) throw new Error('state_too_deep');
    if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !FORBIDDEN.test(key))
                .map(([key, child]) => [key, sanitize(child, depth + 1)])
        );
    return value;
}

/** Observe atomic writes without retaining their contents or introducing dependencies on feature modules. */
function mark(file) {
    const key = path.basename(file);
    if (path.resolve(path.dirname(file)) === path.resolve(config.DATA_DIR) && manifest[key])
        dirty.add(key);
}

/** Queue only changed, relevant files as owner-scoped recoverable snapshots. */
function captureAll() {
    Object.keys(manifest).forEach((key) => dirty.add(key));
    return flush();
}

/** Coalesce disk changes into latest snapshots; source files and recovery backups remain untouched. */
function flush() {
    const active = session.current();
    if (!active || !collector.canCollect(active)) return;
    for (const key of dirty) {
        const entry = byFile.get(key);
        if (!entry || require('../cloud/state-feed').authority(entry.feature)?.mode === 'cloud') {
            dirty.delete(key);
            continue;
        }
        const file = path.join(config.DATA_DIR, key);
        if (!fs.existsSync(file)) {
            dirty.delete(key);
            continue;
        }
        try {
            const source = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
            const selected = Object.fromEntries(
                Object.entries(source).filter(
                    ([field]) => manifest[key].includes(field) && field !== 'reader'
                )
            );
            const payload = sanitize(selected);
            const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
            const identity = active.account.id + ':' + key;
            if (hashes.get(identity) === hash) {
                dirty.delete(key);
                continue;
            }
            revision = Math.max(revision + 1, Date.now() * 1000);
            collector.queue().enqueue({
                owner_id: active.account.id,
                kind: 'state',
                key,
                body: {
                    collector_id: collector.queue().get().collector_id,
                    revision,
                    captured_at: new Date().toISOString(),
                    payload
                }
            });
            hashes.set(identity, hash);
            dirty.delete(key);
        } catch (_error) {
            collector.noteProblem('state_sync_failed');
        }
    }
}

module.exports = { sanitize, mark, captureAll, flush, manifest };
