'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('../config');
let currentGiveaway;

/** Read the latest in-memory giveaway, including state replaced by a restore. */
function connectGiveaway(getState) {
    currentGiveaway = getState;
}

const mStorage = require('../storage');
const mGiveawayDefaults = require('./defaults');
const mGiveawayActivity = require('./activity');

// ---------------------------------------------------------------- backups
// Baby (2026-09-26): automatic backups of the giveaway data so a bad file,
// a bad deploy, or a misclick can never wipe everyone's fluffy unicorns.
//   - every 5 minutes: a rolling copy (last 144 kept = about 12 hours)
//   - once per stream day: a daily copy (last 60 kept)
//   - right before Reset everything / Reset winners only / Empty the jar
//     / a restore: a "before-..." copy (last 40 kept)
// All live in data/backups/giveaway/. The dashboard lists them and can
// restore any one (which itself backs up the current state first).
const GIVEAWAY_BACKUP_DIR = path.join(mConfig.DATA_DIR, 'backups', 'giveaway');
const BACKUP_EVERY_MS = 5 * 60 * 1000;
const BACKUP_KEEP = { auto: 144, daily: 60, before: 40, corrupt: 20 };

/** Use a sortable local timestamp for operator-readable backup filenames. */
function backupStamp() {
    const d = new Date(),
        p = (n) => String(n).padStart(2, '0');

    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(
        d.getMinutes()
    )}${p(d.getSeconds())}`;
}

/** Retain each backup category within its configured history limit. */
function pruneBackups(kind) {
    try {
        const files = fs
            .readdirSync(GIVEAWAY_BACKUP_DIR)
            .filter((f) => f.startsWith(kind + '_') && f.endsWith('.json'))
            .sort();
        const extra = files.length - (BACKUP_KEEP[kind] || 50);
        for (let i = 0; i < extra; i++) fs.unlinkSync(path.join(GIVEAWAY_BACKUP_DIR, files[i]));
    } catch (_error) {}
}

// kind: 'auto' | 'daily' | 'before' | 'corrupt'. label is a short tag, e.g. "reset".
function backupGiveaway(kind, label) {
    try {
        fs.mkdirSync(GIVEAWAY_BACKUP_DIR, { recursive: true });
        const name = `${kind}_${backupStamp()}${
            label ? '_' + String(label).replace(/[^a-z0-9-]/gi, '') : ''
        }.json`;
        const target = path.join(GIVEAWAY_BACKUP_DIR, name);
        if (kind === 'corrupt') fs.copyFileSync(mConfig.GIVEAWAY_FILE, target);
        else fs.writeFileSync(target, `${JSON.stringify(currentGiveaway(), null, 2)}\n`, 'utf8');
        pruneBackups(kind);
        return name;
    } catch (_error) {
        return null;
    }
}

/** List readable backup metadata without restoring or modifying the active giveaway. */
function listGiveawayBackups() {
    try {
        return fs
            .readdirSync(GIVEAWAY_BACKUP_DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => {
                const full = path.join(GIVEAWAY_BACKUP_DIR, f);
                const stat = fs.statSync(full);
                let entrants = null,
                    unicorns = null,
                    winners = null;
                try {
                    const g = JSON.parse(fs.readFileSync(full, 'utf8'));
                    const list = Object.values(g.entrants || {});
                    entrants = list.length;
                    unicorns = list.reduce(
                        (s, e) =>
                            s +
                            (e.chatTickets || 0) +
                            (e.subTickets || 0) +
                            (e.giftTickets || 0) +
                            (e.bitsTickets || 0) +
                            (e.manualTickets || 0),
                        0
                    );
                    winners = (g.winners || []).length;
                } catch (_error) {}
                return {
                    file: f,
                    kind: f.split('_')[0],
                    at: stat.mtime.toISOString(),
                    bytes: stat.size,
                    entrants,
                    unicorns,
                    winners
                };
            })
            .sort((a, b) => (a.at < b.at ? 1 : -1));
    } catch (_error) {
        return [];
    }
}

// Newest readable backup, preferring one that actually has people in it (so
// an empty just-after-Reset copy never wins over real data).
function newestUsableBackup() {
    const good = listGiveawayBackups().filter((b) => b.entrants !== null && b.kind !== 'corrupt');
    return good.find((b) => b.entrants > 0) || good[0] || null;
}

// Load the saved giveaway. If the file exists but can't be read (damaged),
// DON'T silently start empty and save over it: keep a copy of the damaged
// file and fall back to the newest good backup instead.
function loadGiveawayFile() {
    if (!fs.existsSync(mConfig.GIVEAWAY_FILE)) {
        const newest = newestUsableBackup();
        if (newest) {
            console.warn(
                `[giveaway] giveaway.json is missing - restoring newest backup ${newest.file}`
            );
            return mStorage.readJson(
                path.join(GIVEAWAY_BACKUP_DIR, newest.file),
                mGiveawayDefaults.GIVEAWAY_DEFAULTS
            );
        }
        return mStorage.clone(mGiveawayDefaults.GIVEAWAY_DEFAULTS);
    }
    try {
        return JSON.parse(fs.readFileSync(mConfig.GIVEAWAY_FILE, 'utf8'));
    } catch (_error) {
        backupGiveaway('corrupt', 'unreadable');
        const newest = newestUsableBackup();
        console.warn(
            `[giveaway] giveaway.json could not be read - kept a copy, ${
                newest ? 'restoring ' + newest.file : 'no backup found'
            }`
        );
        return newest
            ? mStorage.readJson(
                  path.join(GIVEAWAY_BACKUP_DIR, newest.file),
                  mGiveawayDefaults.GIVEAWAY_DEFAULTS
              )
            : mStorage.clone(mGiveawayDefaults.GIVEAWAY_DEFAULTS);
    }
}

/** Check whether this stream-day already has its retained daily snapshot. */
function hasDailyBackupFor(key) {
    try {
        return fs
            .readdirSync(GIVEAWAY_BACKUP_DIR)
            .some((f) => f.startsWith(`daily_`) && f.includes(`_night-${key}`));
    } catch (_error) {
        return false;
    }
}

/** Create a rolling backup and at most one daily backup for the current stream-day. */
function runScheduledBackup() {
    backupGiveaway('auto', 'every5min');
    const key = mGiveawayActivity.nightKey(new Date());
    if (!hasDailyBackupFor(key)) backupGiveaway('daily', `night-${key}`);
}

Object.assign(exports, {
    connectGiveaway,
    runScheduledBackup,
    BACKUP_EVERY_MS,
    loadGiveawayFile,
    listGiveawayBackups,
    backupGiveaway,
    GIVEAWAY_BACKUP_DIR
});
