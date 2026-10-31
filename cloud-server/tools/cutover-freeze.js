'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { featureSources } = require('./feature-source');

/** Reuse the original bytes/collector on partial retries, including defaults for files that never existed locally. */
function freezeSources(root, owner, fresh, collector, watermark) {
    const file = path.join(root, 'data/.feature-cutover.json');
    let frozen;
    if (fs.existsSync(file)) {
        frozen = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (frozen.owner !== owner) throw new Error('Another owner owns the cutover lock.');
        if (!frozen.backup || !Array.isArray(frozen.sources))
            throw new Error('Recover the original frozen cutover manifest before retrying.');
    } else {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        frozen = {
            owner,
            started_at: new Date().toISOString(),
            collector_id: collector || randomUUID(),
            watermark,
            steam_command_id: randomUUID(),
            backup: 'backups/feature-cutover-' + stamp,
            sources: fresh.map((source) => ({
                feature: source.entry.feature,
                file: path.relative(root, source.file),
                exists: source.exists,
                sha256: source.sha256
            }))
        };
        fs.writeFileSync(file, JSON.stringify(frozen, null, 2), { flag: 'wx' });
        const backup = path.resolve(root, frozen.backup);
        fs.mkdirSync(backup, { recursive: true });
        for (const source of fresh)
            fs.writeFileSync(path.join(backup, source.entry.file), source.source);
        const outbox = path.join(root, 'data/activity-outbox.json');
        if (fs.existsSync(outbox))
            fs.copyFileSync(outbox, path.join(backup, 'activity-outbox.json'));
    }
    const backup = path.resolve(root, frozen.backup);
    if (!backup.startsWith(path.join(root, 'backups', 'feature-cutover-')))
        throw new Error('Invalid frozen backup path.');
    const originals = new Map(fresh.map((source) => [source.entry.feature, source]));
    const snapshots = new Map(
        featureSources(backup, root).map((source) => [source.entry.feature, source])
    );
    const sources = frozen.sources.map((saved) => {
        const original = originals.get(saved.feature);
        const snapshot = snapshots.get(saved.feature);
        if (
            !original ||
            saved.file !== path.relative(root, original.file) ||
            snapshot?.sha256 !== saved.sha256
        )
            throw new Error('Frozen source manifest verification failed.');
        if (
            saved.exists !== original.exists ||
            (saved.exists &&
                createHash('sha256').update(fs.readFileSync(original.file)).digest('hex') !==
                    saved.sha256)
        )
            throw new Error('Original feature source changed while fenced: ' + original.entry.file);
        return { ...snapshot, file: original.file, exists: saved.exists };
    });
    if (sources.length !== fresh.length) throw new Error('Frozen feature inventory differs.');
    return { frozen, sources, backup, lock: file };
}

module.exports = { freezeSources };
