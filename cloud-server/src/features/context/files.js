'use strict';
const path = require('node:path');
const { clone, mergeDefaults } = require('../../domain/json');

/** Normalize virtual separators consistently on Windows tests and Linux Lambda. */
function normalize(file) {
    return String(file).replaceAll('\\', '/');
}

/** Transaction-local documents and typed recovery snapshots replace legacy synchronous disk I/O. */
function documentStorage(initial, publicFiles, now, options = {}) {
    const documents = clone(initial);
    const backups = new Map(options.backups || []);
    const originalBackups = new Map(backups);
    const backupTimes = new Map(
        (options.backups || []).map(([file, _content, time]) => [file, time || now])
    );
    const assets = new Map(
        (options.assets || []).map((entry) => ['/icb/' + entry.relative_path, entry])
    );
    const dirty = new Set();
    let initializing = true;
    /** Read only an account document, public definition, or explicitly loaded recovery snapshot. */
    function read(file) {
        const key = normalize(file);
        if (key.includes('/config/')) {
            if (key.endsWith('/tradeup-game.json') && documents['tradeup-config.json'])
                return JSON.stringify(documents['tradeup-config.json']);
            const value = publicFiles[path.posix.basename(key)];
            if (value === undefined) throw new Error('definition_not_found');
            return JSON.stringify(value);
        }
        if (backups.has(key)) return backups.get(key);
        if (key.endsWith('/actions.jsonl')) return '';
        if (!key.startsWith('/icb/data/')) throw new Error('local_file_operation');
        const value = documents[path.posix.basename(key)];
        if (value === undefined) throw new Error('document_not_found');
        return JSON.stringify(value);
    }

    /** Publish only into the current SQL transaction's working set. */
    function write(file, value) {
        const key = normalize(file);
        if (key.includes('/data/backups/giveaway/')) {
            backups.set(key, typeof value === 'string' ? value : JSON.stringify(value));
            backupTimes.set(key, now);
            return;
        }
        const name = key.endsWith('/config/tradeup-game.json')
            ? 'tradeup-config.json'
            : path.posix.basename(key);
        if (
            name !== 'tradeup-config.json' &&
            (!key.startsWith('/icb/data/') || !key.endsWith('.json'))
        )
            throw new Error('local_file_operation');
        documents[name] = clone(value);
        if (!initializing) dirty.add(name);
    }

    const files = {
        readFileSync: read,
        writeFileSync: (file, value) => {
            if (!String(file).endsWith('actions.jsonl')) write(file, JSON.parse(String(value)));
        },

        existsSync: (file) => {
            if (assets.has(normalize(file))) return true;
            try {
                read(file);
                return true;
            } catch (_) {
                return false;
            }
        },

        mkdirSync: () => {},

        readdirSync: (folder, options = {}) => {
            const prefix = normalize(folder).replace(/\/$/, '') + '/';
            const names = new Map();
            for (const key of [...backups.keys(), ...assets.keys()]) {
                if (!key.startsWith(prefix)) continue;
                const relative = key.slice(prefix.length);
                const name = relative.split('/')[0];
                names.set(name, relative.includes('/'));
            }
            return [...names].map(([name, directory]) =>
                options.withFileTypes
                    ? { name, isDirectory: () => directory, isFile: () => !directory }

                    : name
            );
        },

        statSync: (file) => ({
            size:
                Number(assets.get(normalize(file))?.bytes) ||
                Buffer.byteLength(assets.has(normalize(file)) ? '' : read(file)),
            mtimeMs:
                Number(assets.get(normalize(file))?.modified_at) ||
                backupTimes.get(normalize(file)) ||
                now,
            mtime: new Date(
                Number(assets.get(normalize(file))?.modified_at) ||
                    backupTimes.get(normalize(file)) ||
                    now
            ),
            isFile: () => true,

            isDirectory: () => false
        }),

        unlinkSync: (file) => backups.delete(normalize(file)),

        copyFileSync: (from, to) => backups.set(normalize(to), read(from)),

        renameSync: () => {
            throw new Error('local_file_operation');
        },

        watch: () => {
            throw new Error('local_file_operation');
        }
    };
    const storage = {
        clone,
        mergeDefaults,
        writeJson: write,
        readJson: (file, fallback) => {
            try {
                return JSON.parse(read(file));
            } catch (_) {
                return clone(fallback);
            }
        }
    };
    return {
        files,
        storage,
        documents,
        backups,
        originalBackups,
        dirty,
        ready: () => {
            initializing = false;
            dirty.clear();
        }
    };
}

module.exports = { normalize, documentStorage };
