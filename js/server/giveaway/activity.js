'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('../config');

// ---------------- nightly activity log ----------------
// Every stream event (chat, follow, sub, gifted subs, cheer, raid, chat-time
// unicorns, hand-added unicorns, winners, resets) is appended as one JSON
// line to data/activity/YYYY-MM-DD.jsonl. A "night" runs 6 AM to 6 AM local
// time, so a stream that goes past midnight stays in one report.
// giveaway-report.html turns a night into a printable report / CSV.
const NIGHT_CUTOFF_HOURS = 6;
/** Group overnight stream activity using the existing six-hour local reporting offset. */
function nightKey(date) {
  const d = new Date(date.getTime() - NIGHT_CUTOFF_HOURS * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Backup schedule (see backupGiveaway above). One right at startup, then
// every 5 minutes; the first backup of each stream day is also kept as a

/** Append nightly activity asynchronously; logging must not interrupt stream events. */
function logActivity(entry) {
  try {
    const now = new Date();
    fs.mkdirSync(mConfig.ACTIVITY_DIR, { recursive: true });
    fs.appendFile(path.join(mConfig.ACTIVITY_DIR, `${nightKey(now)}.jsonl`), JSON.stringify({ at: now.toISOString(), ...entry }) + '\n', () => {});
  } catch (_error) { /* a missed log line must never break the giveaway */ }
}
/** Read valid event records for a date-shaped report key, tolerating incomplete lines. */
function readNight(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const file = path.join(mConfig.ACTIVITY_DIR, `${key}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (_error) { return null; }
  }).filter(Boolean);
}

Object.assign(exports, { nightKey, logActivity, readNight });
