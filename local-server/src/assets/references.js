'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const config = require('../config');
const session = require('../cloud/session');
const collector = require('../activity/collector');
let sent = null;
let inFlight = false;
const inventories = new Map();

/** Send only relative artwork names and metadata; image/audio bytes and absolute paths stay local. */
function scanAssets(root = path.join(config.APP_DIR, 'assets')) {
    if (!fs.existsSync(root)) return [];
    const result = [];
    /** Ignore links and non-artwork/private files while walking the local asset root. */
    function walk(folder) {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (
                entry.isSymbolicLink() ||
                entry.name.startsWith('.') ||
                ['_removed', 'backups', 'cloudinary'].includes(entry.name.toLowerCase())
            )
                continue;
            const file = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (
                entry.isFile() &&
                /\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg|m4a)$/i.test(entry.name)
            ) {
                const stat = fs.statSync(file);
                result.push({
                    relative_path: 'assets/' + path.relative(root, file).replaceAll('\\', '/'),
                    modified_at: Math.round(stat.mtimeMs),
                    bytes: stat.size
                });
            }
        }
    }

    walk(root);
    return result.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

/** Explicit refresh/upload synchronization is idempotent and independent of the account state feed. */
async function syncAssets() {
    const active = session.current();
    if (!active || inFlight || !collector.canCollect(active)) return;
    inFlight = true;
    try {
        const references = scanAssets();
        const signature =
            active.account.id +
            ':' +
            createHash('sha256').update(JSON.stringify(references)).digest('hex');
        if (signature === sent) return;
        let previous = inventories.get(active.account.id);
        if (!previous) {
            const remote = await session.call(
                '/v1/features/assets',
                'GET',
                undefined,
                active.account.id
            );
            if (remote.status !== 200) throw new Error('asset_references_unavailable');
            previous = (remote.data.references || []).map((item) => item.relative_path);
        }
        const current = new Set(references.map((item) => item.relative_path));
        const removed = previous.filter((name) => !current.has(name));
        for (let index = 0; index < removed.length; index += 500) {
            const response = await session.call(
                '/v1/features/assets',
                'POST',
                {
                    collector_id: collector.queue().get().collector_id,
                    references: [],
                    removed: removed.slice(index, index + 500)
                },
                active.account.id
            );
            if (response.status !== 200) throw new Error('asset_references_unavailable');
        }
        let part = [];
        /** Bound each metadata request to the same API JSON limit used for other collectors. */
        async function flush() {
            if (!part.length) return;
            const response = await session.call(
                '/v1/features/assets',
                'POST',
                { collector_id: collector.queue().get().collector_id, references: part },
                active.account.id
            );
            if (response.status !== 200) throw new Error('asset_references_unavailable');
            part = [];
        }

        for (const entry of references) {
            if (part.length && Buffer.byteLength(JSON.stringify([...part, entry])) > 200000)
                await flush();
            part.push(entry);
        }
        await flush();
        sent = signature;
        inventories.set(active.account.id, [...current]);
    } finally {
        inFlight = false;
    }
}

module.exports = { scanAssets, syncAssets };

/** React to local file changes instead of repeatedly scanning artwork on a business timer. */
function watchAssets() {
    let timer;
    let watcher;
    const folder = path.join(config.APP_DIR, 'assets');
    if (fs.existsSync(folder))
        watcher = fs.watch(folder, { recursive: true }, () => {
            clearTimeout(timer);
            timer = setTimeout(
                () =>
                    syncAssets().catch(() => collector.noteProblem('asset_references_unavailable')),
                1500
            );
            timer.unref();
        });
    return () => {
        clearTimeout(timer);
        watcher?.close();
    };
}

module.exports.watchAssets = watchAssets;
