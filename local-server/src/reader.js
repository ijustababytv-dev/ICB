'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mState = require('./state');
const mStorage = require('./storage');

/** Prefer an explicit log directory, otherwise search the known Palia Assistant folders. */
function logDirectories() {
    const configured = process.env.ICB_CLEAN_PALIA_LOG_DIR;
    return configured
        ? [configured]
        : [
              process.env.LOCALAPPDATA
                  ? path.join(process.env.LOCALAPPDATA, 'PaliaAssistant', 'logs')
                  : null,
              process.env.LOCALAPPDATA
                  ? path.join(process.env.LOCALAPPDATA, 'PaliaAssistant', 'current', 'logs')
                  : null
          ].filter(Boolean);
}

/** Prefer the configured log file, otherwise select the newest readable app log. */
function findLogFile() {
    const exact = process.env.ICB_CLEAN_PALIA_LOG_FILE;
    if (exact && fs.existsSync(exact)) return path.resolve(exact);

    const candidates = [];
    for (const directory of logDirectories()) {
        try {
            for (const entry of fs.readdirSync(directory)) {
                if (!/^app-.*\.log$/i.test(entry)) continue;
                const file = path.join(directory, entry);
                const stat = fs.statSync(file);
                if (stat.isFile()) candidates.push({ file, mtime: stat.mtimeMs });
            }
        } catch (_error) {
            // A missing Palia Assistant directory is a normal offline state.
        }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.file || null;
}

/** Treat a log older than the configured freshness window as offline. */
function logState(stat) {
    return Date.now() - stat.mtimeMs <= mConfig.STALE_LOG_MS ? 'live' : 'offline';
}

/** Report freshness without clearing a required reconciliation. */
function readerView(stat, file) {
    return {
        state: mState.live.reconciliation?.required ? 'needs-reconciliation' : logState(stat),
        file,
        fileModifiedAt: new Date(stat.mtimeMs).toISOString()
    };
}

const { randomUUID } = require('node:crypto');
const { gameFact } = require('./domain/game-facts');
const inputs = require('./cloud/inputs');
const CURSOR_FILE = path.join(mConfig.DATA_DIR, 'palia-cursor.json');
let cursor = mStorage.readJson(CURSOR_FILE, null);
let activeLog = null;
let activeOffset = 0;
let forceRescan = false;
let firstScan = true;

/** Cursor writes are transport checkpoints only, not a local feature-state mirror. */
function checkpoint(next) {
    mStorage.writeJson(CURSOR_FILE, next);
    cursor = next;
    activeOffset = next.offset;
}

/** Tail complete records, checkpoint after durable enqueue, and leave all counting/reset decisions to Express. */
function scanLog() {
    const file = findLogFile();
    if (!file) {
        activeLog = null;
        mState.updateReader({
            state: mState.live.reconciliation?.required ? 'needs-reconciliation' : 'offline',
            file: null,
            fileModifiedAt: null
        });
        return;
    }
    let stat;
    try {
        stat = fs.statSync(file);
    } catch (_) {
        return;
    }
    activeLog = file;
    mState.updateReader(readerView(stat, file));
    if (!inputs.ready()) return;
    const fingerprint = [path.resolve(file), stat.ino, stat.birthtimeMs].join(':');
    if (
        firstScan ||
        forceRescan ||
        !cursor ||
        cursor.fingerprint !== fingerprint ||
        stat.size < cursor.offset
    ) {
        const offset = firstScan || forceRescan || logState(stat) !== 'live' ? stat.size : 0;
        firstScan = false;
        forceRescan = false;
        checkpoint({
            version: 2,
            fingerprint,
            generation:
                cursor?.fingerprint === fingerprint && stat.size >= cursor.offset
                    ? cursor.generation
                    : randomUUID(),
            offset,
            skipping: false
        });
        return;
    }
    if (mState.live.reconciliation?.required) {
        if (cursor.offset !== stat.size)
            checkpoint({ ...cursor, offset: stat.size, skipping: false });
        return;
    }
    if (cursor.offset === stat.size) return;
    const base = cursor.offset;
    let buffer;
    try {
        const handle = fs.openSync(file, 'r');
        try {
            buffer = Buffer.alloc(Math.min(2 * 1024 * 1024, stat.size - base));
            const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, base);
            buffer = buffer.subarray(0, bytesRead);
        } finally {
            fs.closeSync(handle);
        }
    } catch (_) {
        return;
    }
    if (buffer.indexOf(10) < 0) {
        // An oversized non-incremental resync can be discarded without storing its original text.
        if (
            buffer.length === 2 * 1024 * 1024 &&
            !/\b(?:Inventory|Lockbox)\s+(?:gained|lost)\s*:/i.test(buffer.toString('utf8', 0, 1000))
        )
            checkpoint({ ...cursor, offset: base + buffer.length, skipping: true });
        else if (buffer.length === 2 * 1024 * 1024)
            require('./activity/collector').noteProblem('incremental_log_line_too_large');
        return;
    }
    let position = 0;
    let lastComplete = base;
    let batch = [];
    let batchEnd = base;
    let skipping = cursor.skipping;
    /** Commit cursor advancement only after its recognized facts are durably queued. */
    function flush() {
        if (!batch.length) return;
        inputs.game(batch);
        checkpoint({ ...cursor, offset: batchEnd, skipping: false });
        mState.updateReader({
            lastUpdateAt: inputs.timestamp(),
            lastEvent: { kind: 'normalized_game_facts', count: batch.length }
        });
        batch = [];
    }

    try {
        let newline;
        while ((newline = buffer.indexOf(10, position)) >= 0) {
            const end = base + newline + 1;
            const line = buffer.toString('utf8', position, newline).replace(/\r$/, '');
            const start = base + position;
            position = newline + 1;
            lastComplete = end;
            if (skipping) {
                skipping = false;
                continue;
            }
            const fact = gameFact(line);
            if (!fact) continue;
            const entry = {
                source_key: cursor.generation + ':' + start,
                at: inputs.timestamp(),
                fact
            };
            if (
                batch.length &&
                (batch.length >= 100 ||
                    Buffer.byteLength(JSON.stringify([...batch, entry])) > 180000)
            )
                flush();
            batch.push(entry);
            batchEnd = end;
        }
        flush();
        if (cursor.offset !== lastComplete || cursor.skipping)
            checkpoint({ ...cursor, offset: lastComplete, skipping: false });
    } catch (error) {
        require('./activity/collector').noteProblem(
            error.message === 'outbox_full' ? 'outbox_full' : 'game_checkpoint_failed'
        );
    }
}

Object.assign(exports, { scanLog, logDirectories });
Object.defineProperties(exports, {
    activeLog: { get: () => activeLog },

    forceRescan: {
        get: () => forceRescan,

        set: (value) => {
            forceRescan = value;
        }
    }
});
