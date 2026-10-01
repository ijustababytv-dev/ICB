const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const VERSION = '0.1.0-clean';
const PORT = Number(process.env.ICB_CLEAN_PORT || 8790);
const HOST = '127.0.0.1';
const APP_DIR = __dirname;
const DATA_DIR = process.env.ICB_CLEAN_DATA_DIR || path.join(APP_DIR, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LIVE_FILE = path.join(DATA_DIR, 'live.json');
const ACTIONS_FILE = path.join(DATA_DIR, 'actions.jsonl');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const GIVEAWAY_FILE = path.join(DATA_DIR, 'giveaway.json');
const ACTIVITY_DIR = path.join(DATA_DIR, 'activity');
const STALE_LOG_MS = Number(process.env.ICB_CLEAN_LOG_STALE_MS || 10 * 60 * 1000);

// The Official ICB Resource Tracker Skin Standard (2048x768, 8:3) is defined
// once, in config/tracker-skin-standard.json, and read from there. Do not
// restate those numbers anywhere else in the codebase — reference this
// constant or GET /api/tracker-skin-standard so every tracker component
// inherits the same geometry. See docs/ICB-TRACKER-SKIN-STANDARD.md.
const TRACKER_SKIN_STANDARD_FILE = path.join(APP_DIR, 'config', 'tracker-skin-standard.json');
const TRACKER_SKIN_STANDARD = JSON.parse(fs.readFileSync(TRACKER_SKIN_STANDARD_FILE, 'utf8'));

const RESOURCE_META = {
  amber: { label: 'Amber Echo', token: 'itemtype_currency_echo_amber' },
  essence: { label: 'Infected Essence', token: 'itemtype_echo_essence' },
  sweetLeaf: { label: 'Sweet Leaf', token: 'itemtype_forage_spice_sweetleaves' },
};

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  // Stream Timer widget (added 2026-09-15): a Meld overlay (timer.html) plus its own private
  // control page (timer-control.html), both plain static files served like any other. heading/
  // subheading are freely editable text; targetAt is an ISO timestamp the overlay counts down to,
  // empty when there's no active timer. status drives which of the overlay's three states renders
  // - 'idle' (hidden), 'running' (ticking countdown), 'timesup' (celebration) - independent of
  // whether targetAt has actually elapsed, so "Time's Up!" can end a countdown early and "Reset"
  // can clear it without touching the heading/subheading text the streamer already typed.
  countdown: {
    heading: 'NEXT ADVENTURE IN', subheading: '', targetAt: '', timezone: 'America/Chicago',
    status: 'idle',
  },
  // World Time Bar (added 2026-09-15): a horizontal strip of clocks (worldclock.html) plus its
  // own control page (worldclock-control.html). Six fixed slots (zone1..zone6) rather than a
  // free-form list - editing an existing slot's label/subLabel/timezone/visible is supported,
  // adding or removing slots is not, which keeps the PUT handler a simple per-field whitelist
  // instead of needing to validate arbitrary array edits. "4 to 6 zones" is just zone5/zone6
  // starting hidden - toggle visible to bring a 5th or 6th clock onto the bar.
  worldClock: {
    zones: [
      { id: 'zone1', label: 'CHICAGO', subLabel: 'HOME BASE', timezone: 'America/Chicago', visible: true },
      { id: 'zone2', label: 'LOS ANGELES', subLabel: '', timezone: 'America/Los_Angeles', visible: true },
      { id: 'zone3', label: 'NEW YORK', subLabel: '', timezone: 'America/New_York', visible: true },
      { id: 'zone4', label: 'LONDON', subLabel: '', timezone: 'Europe/London', visible: true },
      { id: 'zone5', label: 'TOKYO', subLabel: '', timezone: 'Asia/Tokyo', visible: false },
      { id: 'zone6', label: 'SYDNEY', subLabel: '', timezone: 'Australia/Sydney', visible: false },
    ],
  },
  stream: { title: '', category: 'Palia', goLiveMessage: '' },
  // The scrolling banner overlay (added 2026-08-25) - the ijustababyTV unicorn banner art with a
  // message that scrolls through the empty glass panel. Editable from the dashboard so Baby never
  // needs a file edit to change it. See renderTickerPage() and /ticker.html below.
  // speed = pixels per second the text travels (higher = faster). pause = seconds the panel sits
  // empty between one full pass finishing and the next one starting (2026-08-28: switched from a
  // continuous double-scroll to one single pass at a time, per Baby's request).
  ticker: { text: 'Welcome to ijustababyTv', speed: 90, pause: 1 },
  // Dashboard-only: the order Baby dragged the control.html panels into with the ▲▼ buttons.
  // An array of panel keys (e.g. ["run","trackers","stream",...]); empty until she first
  // reorders something, at which point control.html sends the full current order here.
  // Meld/overlay pages never read this - it only affects the private Chrome dashboard layout.
  layout: { panelOrder: [], trackerOrder: [], trackerHidden: [] },
  updatedAt: null,
};

const DEFAULT_LIVE = {
  schemaVersion: 1,
  resources: { amber: 0, essence: 0, sweetLeaf: 0 },
  session: { mode: 'offline' },
  reader: { state: 'offline', file: null, fileModifiedAt: null, lastEvent: null, lastUpdateAt: null },
  reconciliation: { required: false, reason: null, historicalBaseline: null, reconciledAt: null },
  updatedAt: null,
};

// Dashboard-only Daily / Weekly to-do lists (added 2026-08-25). Nothing to do with Palia logs -
// Baby types these herself. Confirmed with her: NO auto-reset, items stay until she deletes them.
// Each item is either 'check' (plain done/not-done) or 'goal' (a running count toward a target,
// e.g. "1/100"). "daily" and "weekly" are just two independent lists/labels she manages herself -
// the server never clears either one on any schedule.
const DEFAULT_TODOS = {
  schemaVersion: 1,
  daily: [],
  weekly: [],
  updatedAt: null,
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return clone(fallback);
  }
}

function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function mergeDefaults(defaults, value) {
  const output = clone(defaults);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item) && output[key] && typeof output[key] === 'object') {
      output[key] = mergeDefaults(output[key], item);
    } else {
      output[key] = item;
    }
  }
  return output;
}

let settings = mergeDefaults(DEFAULT_SETTINGS, readJson(SETTINGS_FILE, DEFAULT_SETTINGS));
let live = mergeDefaults(DEFAULT_LIVE, readJson(LIVE_FILE, DEFAULT_LIVE));
let todos = normalizeTodos(readJson(TODOS_FILE, DEFAULT_TODOS));
let actions = loadActions();
const startedAt = Date.now();
const clients = new Set();

// -----------------------------------------------------------------------
// STREAM GIVEAWAY — built 2026-09-24 for the pink/purple "fluffy unicorn"
// giveaway, one night's worth of tickets, two prize types (plushie, mystery
// outfit), fed by a Meld Firehose listener layer (giveaway-listener.html)
// that relays raw chat/sub/gifts/purchase events to /api/giveaway/event.
// This server does ALL the ticket math - the listener page is a dumb relay.
//
// Ticket rules, confirmed with Baby:
//   - Chat: 1 ticket per rolling 10-minute window with >=1 message, no cap,
//     adds up all night (CHAT_WINDOW_MS tick below).
//   - Sub/resub: 1 ticket per sub event (one per real month subscribed,
//     assuming Twitch/Firehose fires a sub event once per billing month -
//     unverified against a real event yet, first thing to check on air).
//   - Gifted subs: 2 tickets per sub gifted, credited to the GIFTER.
//   - Bits: 1 ticket per full 100 bits (250 bits = 2 tickets, remainder
//     dropped). NOTE: the exact field name Firehose uses for a bits amount
//     on its "purchase" event is unverified - see giveaway-listener.html.
//   - Donations: explicitly out of scope for tonight (Baby's call) - use
//     the dashboard's manual ticket adjuster for anything that isn't chat/
//     sub/gift/bits.
//   - Same ticket pool feeds both prize types.
//   - Plushie winners stay in the pool (can win again). Mystery Outfit
//     winners are removed from future Mystery Outfit draws only - they
//     stay eligible for Plushie draws.
//   - Everything ROLLS OVER between streams (entrants, unicorn counts,
//     breakdowns, winners, Mystery Outfit locks) - it's all saved to
//     data/giveaway.json and only the dashboard's Reset button clears it.
//     Baby's call, 2026-09-25.
//
// Rates (2026-09-25, Baby: "2 and 4 everywhere"): each entrant stores raw
// COUNTS (chat windows, sub months, gifted subs, bits cheered) and the
// *Tickets fields are recomputed from giveaway.rates. Changing a rate on the
// dashboard re-prices everyone, live and hand-entered alike.
const GIVEAWAY_DEFAULTS = {
  windowStartedAt: null,
  entrants: {},   // username -> { username, counts:{chatWindows,subMonths,giftedSubs,bits}, chatTickets, subTickets, giftTickets, bitsTickets (derived), manualTickets, note, mysteryOutfitWon, lastSeenAt }
  chatActiveThisWindow: {}, // username -> true, cleared every CHAT_WINDOW_MS tick
  winners: [],    // { username, prize, tickets, at }
  manualLog: [],  // { username, kind, amount, delta, reason, at } - dashboard "Give fluffy unicorns" history, newest last
  // Fluffy unicorns earned per thing. Survives Reset (it's a setting).
  rates: { chatWindow: 1, subMonth: 2, giftedSub: 4, bitsPerUnicorn: 100 },
  // The on-screen jar starts empty each stream day while everyone's counts
  // roll over (Baby, 2026-09-25). Snapshot of each viewer's counts when the
  // jar was last emptied; the jar shows only what was earned since.
  jarBaseline: { night: null, startedAt: null, snapshot: {} },
  // Never part of the giveaway: Baby herself + chat bots. Case-insensitive.
  // Survives Reset. Edited on the dashboard. (Baby, 2026-09-25: "I don't
  // want me nor any bots in the giveaways".)
  blocked: [
    'IJustABabyTv', 'StreamDatabase', 'Nightbot', 'StreamElements', 'Streamlabs', 'Moobot',
    'Fossabot', 'Sery_Bot', 'Wizebot', 'SoundAlerts', 'Blerp', 'KofiStreamBot', 'StreamStickers',
    'TangiaBot', 'PokemonCommunityGame', 'BotRixOficial', 'CommanderRoot', 'LurxxBot', 'Streamlootsbot',
    'Own3d', 'Anonymous',
  ],
  // On-screen wording for the overlays, edited from giveaway-control.html.
  // Survives "Reset for tonight" - reset only clears entrants/winners.
  display: {
    entrantsTitle: '🦄 Giveaway Entrants 🦄',
    emptyMessage: 'No entries yet — chat, sub, gift, or cheer to get in!',
    maxRows: 10,
    tickerMessages: [
      'Chat every 10 min = 1 fluffy unicorn, all night long!',
      'Sub = 2 fluffy unicorns a month. Gift a sub = 4 fluffy unicorns EACH!',
      '100 bits = 1 fluffy unicorn (250 bits = 2 fluffy unicorns)',
      'Plushie drawings every ~30 min - you can win more than once!',
      'Mystery Outfit drawing every hour - one per person per night!',
    ],
    winnersTitle: '🏆 Winners Circle 🏆',
    winnersEmptyMessage: 'No winners drawn yet tonight!',
    // unicorn-jar.html settings
    jarSide: 'right',       // 'left' | 'center' | 'right'
    unicornSize: 'medium',  // 'small' | 'medium' | 'large'
    showNames: false,       // print each viewer's name on their unicorns (Baby turned this off 2026-09-25)
    magic: true,            // cloud, falling stars and rainbow on unicorn-jar.html
    // What to call the current prize on the winner banner/board (Baby,
    // 2026-09-26), e.g. "Squishmallow Corgi" instead of the generic
    // "Plushie". Baked into each winnerRecord at draw time (see /draw
    // below) so past winners keep whatever was current when they won.
    // Empty = fall back to the generic "Plushie" / "Mystery Outfit" wording.
    currentPrizeLabel: '',
  },
  // Baby (2026-09-26): a "Test" button so she can show someone how a
  // drawing looks without it being a real one. Bumping seq tells
  // unicorn-jar.html to run the full show with IJustABabyTv as the
  // winner - it never touches entrants, giveaway.winners, or the
  // activity log, so it can't leak into the real Winners Circle or
  // nightly report, and it works even though IJustABabyTv is blocked.
  testDraw: { seq: 0, prize: 'plushie' },
};
const CHAT_WINDOW_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- backups
// Baby (2026-09-26): automatic backups of the giveaway data so a bad file,
// a bad deploy, or a misclick can never wipe everyone's fluffy unicorns.
//   - every 5 minutes: a rolling copy (last 144 kept = about 12 hours)
//   - once per stream day: a daily copy (last 60 kept)
//   - right before Reset everything / Reset winners only / Empty the jar
//     / a restore: a "before-..." copy (last 40 kept)
// All live in data/backups/giveaway/. The dashboard lists them and can
// restore any one (which itself backs up the current state first).
const GIVEAWAY_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'giveaway');
const BACKUP_EVERY_MS = 5 * 60 * 1000;
const BACKUP_KEEP = { auto: 144, daily: 60, before: 40, corrupt: 20 };

function backupStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function pruneBackups(kind) {
  try {
    const files = fs.readdirSync(GIVEAWAY_BACKUP_DIR).filter(f => f.startsWith(kind + '_') && f.endsWith('.json')).sort();
    const extra = files.length - (BACKUP_KEEP[kind] || 50);
    for (let i = 0; i < extra; i++) fs.unlinkSync(path.join(GIVEAWAY_BACKUP_DIR, files[i]));
  } catch (_error) {}
}

// kind: 'auto' | 'daily' | 'before' | 'corrupt'. label is a short tag, e.g. "reset".
function backupGiveaway(kind, label) {
  try {
    fs.mkdirSync(GIVEAWAY_BACKUP_DIR, { recursive: true });
    const name = `${kind}_${backupStamp()}${label ? '_' + String(label).replace(/[^a-z0-9-]/gi, '') : ''}.json`;
    const target = path.join(GIVEAWAY_BACKUP_DIR, name);
    if (kind === 'corrupt') fs.copyFileSync(GIVEAWAY_FILE, target);
    else fs.writeFileSync(target, `${JSON.stringify(giveaway, null, 2)}\n`, 'utf8');
    pruneBackups(kind);
    return name;
  } catch (_error) {
    return null;
  }
}

function listGiveawayBackups() {
  try {
    return fs.readdirSync(GIVEAWAY_BACKUP_DIR).filter(f => f.endsWith('.json')).map(f => {
      const full = path.join(GIVEAWAY_BACKUP_DIR, f);
      const stat = fs.statSync(full);
      let entrants = null, unicorns = null, winners = null;
      try {
        const g = JSON.parse(fs.readFileSync(full, 'utf8'));
        const list = Object.values(g.entrants || {});
        entrants = list.length;
        unicorns = list.reduce((s, e) => s + (e.chatTickets || 0) + (e.subTickets || 0) + (e.giftTickets || 0) + (e.bitsTickets || 0) + (e.manualTickets || 0), 0);
        winners = (g.winners || []).length;
      } catch (_error) {}
      return { file: f, kind: f.split('_')[0], at: stat.mtime.toISOString(), bytes: stat.size, entrants, unicorns, winners };
    }).sort((a, b) => (a.at < b.at ? 1 : -1));
  } catch (_error) {
    return [];
  }
}

// Newest readable backup, preferring one that actually has people in it (so
// an empty just-after-Reset copy never wins over real data).
function newestUsableBackup() {
  const good = listGiveawayBackups().filter(b => b.entrants !== null && b.kind !== 'corrupt');
  return good.find(b => b.entrants > 0) || good[0] || null;
}

// Load the saved giveaway. If the file exists but can't be read (damaged),
// DON'T silently start empty and save over it: keep a copy of the damaged
// file and fall back to the newest good backup instead.
function loadGiveawayFile() {
  if (!fs.existsSync(GIVEAWAY_FILE)) {
    const newest = newestUsableBackup();
    if (newest) {
      console.warn(`[giveaway] giveaway.json is missing - restoring newest backup ${newest.file}`);
      return readJson(path.join(GIVEAWAY_BACKUP_DIR, newest.file), GIVEAWAY_DEFAULTS);
    }
    return clone(GIVEAWAY_DEFAULTS);
  }
  try {
    return JSON.parse(fs.readFileSync(GIVEAWAY_FILE, 'utf8'));
  } catch (_error) {
    backupGiveaway('corrupt', 'unreadable');
    const newest = newestUsableBackup();
    console.warn(`[giveaway] giveaway.json could not be read - kept a copy, ${newest ? 'restoring ' + newest.file : 'no backup found'}`);
    return newest ? readJson(path.join(GIVEAWAY_BACKUP_DIR, newest.file), GIVEAWAY_DEFAULTS) : clone(GIVEAWAY_DEFAULTS);
  }
}

let giveaway = mergeDefaults(GIVEAWAY_DEFAULTS, loadGiveawayFile());
if (!giveaway.windowStartedAt) giveaway.windowStartedAt = new Date().toISOString();
migrateGiveaway();
purgeBlocked();

function isBlocked(name) {
  const lower = String(name || '').toLowerCase().replace(/^@/, '');
  return (giveaway.blocked || []).some(b => String(b).toLowerCase() === lower);
}

// Drop blocked names from entrants and this chat window. Returns names removed.
function purgeBlocked() {
  const removed = [];
  for (const key of Object.keys(giveaway.entrants)) {
    if (isBlocked(key)) { removed.push(key); delete giveaway.entrants[key]; }
  }
  for (const key of Object.keys(giveaway.chatActiveThisWindow)) {
    if (isBlocked(key)) delete giveaway.chatActiveThisWindow[key];
  }
  return removed;
}

// Live status of giveaway-listener.html (the Meld layer). Kept in memory only,
// sent to the dashboard so Baby can see before going live that Meld is feeding
// ICB. Never written to disk.
const listenerStatus = { lastSeen: null, firehose: 'unknown', lastEventAt: null, lastEvent: null };

// ---------------- nightly activity log ----------------
// Every stream event (chat, follow, sub, gifted subs, cheer, raid, chat-time
// unicorns, hand-added unicorns, winners, resets) is appended as one JSON
// line to data/activity/YYYY-MM-DD.jsonl. A "night" runs 6 AM to 6 AM local
// time, so a stream that goes past midnight stays in one report.
// giveaway-report.html turns a night into a printable report / CSV.
const NIGHT_CUTOFF_HOURS = 6;
function nightKey(date) {
  const d = new Date(date.getTime() - NIGHT_CUTOFF_HOURS * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Backup schedule (see backupGiveaway above). One right at startup, then
// every 5 minutes; the first backup of each stream day is also kept as a
// daily copy.
function hasDailyBackupFor(key) {
  try { return fs.readdirSync(GIVEAWAY_BACKUP_DIR).some(f => f.startsWith(`daily_`) && f.includes(`_night-${key}`)); }
  catch (_error) { return false; }
}
function runScheduledBackup() {
  backupGiveaway('auto', 'every5min');
  const key = nightKey(new Date());
  if (!hasDailyBackupFor(key)) backupGiveaway('daily', `night-${key}`);
}
runScheduledBackup();
const giveawayBackupTimer = setInterval(runScheduledBackup, BACKUP_EVERY_MS);
giveawayBackupTimer.unref();

function logActivity(entry) {
  try {
    const now = new Date();
    fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
    fs.appendFile(path.join(ACTIVITY_DIR, `${nightKey(now)}.jsonl`), JSON.stringify({ at: now.toISOString(), ...entry }) + '\n', () => {});
  } catch (_error) { /* a missed log line must never break the giveaway */ }
}
function readNight(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const file = path.join(ACTIVITY_DIR, `${key}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (_error) { return null; }
  }).filter(Boolean);
}

// ---- fresh jar each stream, counts roll over ----
function snapshotJar() {
  const snapshot = {};
  for (const [key, e] of Object.entries(giveaway.entrants)) snapshot[key] = { counts: clone(e.counts), manual: e.manualTickets || 0 };
  giveaway.jarBaseline = { night: nightKey(new Date()), startedAt: new Date().toISOString(), snapshot };
}
// New stream day (6 AM cutoff, same as the nightly report) -> empty jar.
function ensureJarBaseline() {
  if (!giveaway.jarBaseline || giveaway.jarBaseline.night !== nightKey(new Date())) { snapshotJar(); saveGiveaway(); }
}
// Priced at today's rates so a rate change never makes the jar jump.
function snapshotTotal(snap) {
  const r = giveaway.rates, c = snap.counts || {};
  return (c.chatWindows || 0) * r.chatWindow + (c.subMonths || 0) * r.subMonth + (c.giftedSubs || 0) * r.giftedSub
    + Math.floor((c.bits || 0) / r.bitsPerUnicorn) + (snap.manual || 0);
}
function jarView() {
  ensureJarBaseline();
  const counts = {};
  let total = 0;
  for (const [key, e] of Object.entries(giveaway.entrants)) {
    const snap = giveaway.jarBaseline.snapshot[key];
    const n = Math.max(0, entrantTotal(e) - (snap ? snapshotTotal(snap) : 0));
    if (n > 0) { counts[e.username] = n; total += n; }
  }
  return { night: giveaway.jarBaseline.night, startedAt: giveaway.jarBaseline.startedAt, counts, total };
}

function publicGiveaway() {
  return { ...clone(giveaway), listener: { ...listenerStatus }, jar: jarView() };
}

function cleanRate(value, fallback, min, max) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Older giveaway.json files stored ticket totals only. Turn them back into
// counts using the rates that were live then (chat 1, sub 1, gift 2,
// 100 bits = 1), so the new rates can re-price them.
function migrateGiveaway() {
  const r = giveaway.rates;
  r.chatWindow = cleanRate(r.chatWindow, 1, 0, 100);
  r.subMonth = cleanRate(r.subMonth, 2, 0, 100);
  r.giftedSub = cleanRate(r.giftedSub, 4, 0, 100);
  r.bitsPerUnicorn = cleanRate(r.bitsPerUnicorn, 100, 1, 100000);
  for (const key of Object.keys(giveaway.entrants)) {
    const e = giveaway.entrants[key];
    if (!e.counts) {
      e.counts = {
        chatWindows: e.chatTickets || 0,
        subMonths: e.subTickets || 0,
        giftedSubs: Math.round((e.giftTickets || 0) / 2),
        bits: (e.bitsTickets || 0) * 100,
      };
    }
    if (typeof e.note !== 'string') e.note = '';
    if (typeof e.manualTickets !== 'number') e.manualTickets = 0;
    recomputeEntrant(e);
  }
  // Names on unicorns shipped briefly as ON; Baby asked for them off. Flip saved
  // copies off once, after which the dashboard toggle is respected.
  if (!giveaway.display.namesOffV2) { giveaway.display.showNames = false; giveaway.display.namesOffV2 = true; }
  const oldTicker = 'Sub = 1 fluffy unicorn. Gift a sub = 2 fluffy unicorns EACH!';
  const t = giveaway.display.tickerMessages;
  if (Array.isArray(t)) {
    const i = t.indexOf(oldTicker);
    if (i >= 0) t[i] = 'Sub = 2 fluffy unicorns a month. Gift a sub = 4 fluffy unicorns EACH!';
  }
}

function recomputeEntrant(e) {
  const r = giveaway.rates, c = e.counts;
  e.chatTickets = c.chatWindows * r.chatWindow;
  e.subTickets = c.subMonths * r.subMonth;
  e.giftTickets = c.giftedSubs * r.giftedSub;
  e.bitsTickets = Math.floor(c.bits / r.bitsPerUnicorn);
  // Hand take-aways can go negative to correct earned unicorns, never below a 0 total.
  const earned = e.chatTickets + e.subTickets + e.giftTickets + e.bitsTickets;
  if (e.manualTickets < -earned) e.manualTickets = -earned;
  return e;
}

function saveGiveaway() {
  writeJson(GIVEAWAY_FILE, giveaway);
}

function broadcastGiveaway() {
  saveGiveaway();
  broadcast('giveaway', publicGiveaway());
}

// Case-insensitive: "bob" from the dashboard and "Bob" from chat are one person.
function findEntrantKey(username) {
  if (giveaway.entrants[username]) return username;
  const lower = String(username).toLowerCase();
  return Object.keys(giveaway.entrants).find(k => k.toLowerCase() === lower) || null;
}

function ensureEntrant(username) {
  const existing = findEntrantKey(username);
  if (existing) return giveaway.entrants[existing];
  {
    giveaway.entrants[username] = {
      username,
      counts: { chatWindows: 0, subMonths: 0, giftedSubs: 0, bits: 0 },
      note: '',
      chatTickets: 0,
      subTickets: 0,
      giftTickets: 0,
      bitsTickets: 0,
      manualTickets: 0,
      mysteryOutfitWon: false,
      lastSeenAt: null,
    };
  }
  return giveaway.entrants[username];
}

function entrantTotal(entrant) {
  return entrant.chatTickets + entrant.subTickets + entrant.giftTickets + entrant.bitsTickets + entrant.manualTickets;
}

// Every CHAT_WINDOW_MS, anyone who chatted at least once since the last
// tick gets exactly 1 ticket, then the window clears. This is deliberately
// NOT per-message - spamming chat doesn't earn extra tickets, only being
// present across separate windows does.
const chatWindowTimer = setInterval(() => {
  const activeUsers = Object.keys(giveaway.chatActiveThisWindow).filter(u => !isBlocked(u));
  for (const username of activeUsers) {
    const entrant = ensureEntrant(username);
    entrant.counts.chatWindows += 1;
    recomputeEntrant(entrant);
  }
  if (activeUsers.length) logActivity({ type: 'chat_unicorns', usernames: activeUsers, each: giveaway.rates.chatWindow });
  giveaway.chatActiveThisWindow = {};
  giveaway.windowStartedAt = new Date().toISOString();
  if (activeUsers.length) broadcastGiveaway();
  else saveGiveaway();
}, CHAT_WINDOW_MS);
chatWindowTimer.unref();

function loadActions() {
  try {
    return fs.readFileSync(ACTIONS_FILE, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .slice(-100);
  } catch (_error) {
    return [];
  }
}

function saveSettings() {
  settings.updatedAt = new Date().toISOString();
  writeJson(SETTINGS_FILE, settings);
}

function saveLive() {
  live.updatedAt = new Date().toISOString();
  writeJson(LIVE_FILE, live);
}

function normalizeTodoItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = cleanString(raw.text);
  if (!text) return null;
  const id = cleanString(raw.id) || `todo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const createdAt = cleanString(raw.createdAt) || new Date().toISOString();
  if (raw.kind === 'goal') {
    const target = Math.trunc(Number(raw.target));
    const current = Math.trunc(Number(raw.current));
    return {
      id, text, kind: 'goal', createdAt,
      target: Number.isFinite(target) && target > 0 ? target : 1,
      current: Number.isFinite(current) && current >= 0 ? current : 0,
    };
  }
  return { id, text, kind: 'check', createdAt, done: Boolean(raw.done) };
}

function normalizeTodos(value) {
  const out = clone(DEFAULT_TODOS);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.daily)) out.daily = value.daily.map(normalizeTodoItem).filter(Boolean);
    if (Array.isArray(value.weekly)) out.weekly = value.weekly.map(normalizeTodoItem).filter(Boolean);
    if (value.updatedAt) out.updatedAt = value.updatedAt;
  }
  return out;
}

function saveTodos() {
  todos.updatedAt = new Date().toISOString();
  writeJson(TODOS_FILE, todos);
}

function broadcastTodos() {
  saveTodos();
  broadcast('todos', clone(todos));
}

function publicState() {
  return { settings: clone(settings), live: clone(live), todos: clone(todos), actions: clone(actions.slice(-20)) };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const client of clients) {
    try {
      sendSse(client, event, payload);
    } catch (_error) {
      clients.delete(client);
    }
  }
}

function clientCounts() {
  // Lets the dashboard confirm the Meld overlay is genuinely connected
  // instead of asking the operator to eyeball it.
  const counts = { control: 0, overlay: 0, other: 0 };
  for (const client of clients) counts[client.icbRole || 'other'] += 1;
  return counts;
}

function recordAction(action) {
  actions.push(action);
  actions = actions.slice(-100);
  fs.appendFileSync(ACTIONS_FILE, `${JSON.stringify(action)}\n`, 'utf8');
  broadcast('action', action);
}

function updateReader(patch) {
  const next = { ...live.reader, ...patch };
  if (JSON.stringify(next) === JSON.stringify(live.reader)) return false;
  live.reader = next;
  saveLive();
  broadcast('live', clone(live));
  return true;
}

function updateLive(patch) {
  live = mergeDefaults(live, patch);
  saveLive();
  broadcast('live', clone(live));
}

function logDirectories() {
  const configured = process.env.ICB_CLEAN_PALIA_LOG_DIR;
  return configured
    ? [configured]
    : [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'PaliaAssistant', 'logs') : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'PaliaAssistant', 'current', 'logs') : null,
    ].filter(Boolean);
}

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

function logState(stat) {
  return Date.now() - stat.mtimeMs <= STALE_LOG_MS ? 'live' : 'offline';
}

function readerView(stat, file) {
  return {
    state: live.reconciliation?.required ? 'needs-reconciliation' : logState(stat),
    file,
    fileModifiedAt: new Date(stat.mtimeMs).toISOString(),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Palia Assistant writes several event families to its log. Only "Inventory"
// and "Lockbox" lines represent an actual incremental gain/loss of one item
// stack. "Primary gained:"/"Primary lost:" lines are periodic full-container
// resyncs (Palia Assistant re-emitting the player's entire current inventory,
// verified against real logs to repeat identically hours apart) and must
// never be scored as deltas, or totals balloon every time a resync fires.
const EVENT_LINE_PATTERN = /\b(Inventory|Lockbox)\s+(gained|lost)\s*:/i;

function lineDelta(line) {
  const eventMatch = line.match(EVENT_LINE_PATTERN);
  if (!eventMatch) return [];
  const sign = eventMatch[2].toLowerCase() === 'lost' ? -1 : 1;

  return Object.entries(RESOURCE_META).flatMap(([resource, meta]) => {
    // Items can carry an inline quality/rarity marker, e.g. "itemtype_x (1*) x2".
    // The optional group below consumes that marker before the quantity so
    // starred variants are still counted instead of silently missed.
    const pattern = new RegExp(`${escapeRegExp(meta.token)}(?:\\s*\\([^)]*\\))?(?:\\s*(?:x|×|quantity)?\\s*[:=]?\\s*)(\\d+)`, 'i');
    const match = line.match(pattern);
    return match ? [{ resource, amount: sign * Number(match[1]), token: meta.token }] : [];
  });
}


// ---------------------------------------------------------------------------
// LINE QUANTITY HELPER
// Shared by the weekly-accomplishments and resource-tracker scanners.
// ---------------------------------------------------------------------------
function quantityFor(line, token) {
  // Items can carry an inline quality marker: "itemtype_forage_spice_sweetleaves (1*) x2"
  const pattern = new RegExp(`${escapeRegExp(token)}(?:\\s*\\([^)]*\\))?(?:\\s*(?:x|×)?\\s*)(\\d+)`, 'i');
  const match = line.match(pattern);
  return match ? Number(match[1]) : 0;
}

// Like quantityFor, but matches ANY token starting with the given prefix and
// sums every match on the line - e.g. prefix "itemtype_bug_" catches every
// distinct bug species token (each species is its own token in the logs)
// instead of needing one exact token per species. Used by slots that opt in
// via `tokenPrefix` instead of (or alongside) an exact `tokens` list.
function quantityForPrefix(line, prefix) {
  const pattern = new RegExp(`${escapeRegExp(prefix)}[a-z0-9_]*(?:\\s*\\([^)]*\\))?(?:\\s*(?:x|×)?\\s*)(\\d+)`, 'gi');
  let total = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    total += Number(match[1]) || 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// OVERLAY POLL TRACKING
// The XHR-polling overlay pages (ticker.html, weekly.html, ...) never show up
// in connectedClients, so without this the dashboard's "NO OVERLAY LAYERS
// CONNECTED" warning would be blind to them. Each page tags its poll with
// ?src=<name>, and this records who asked for an overlay page and what browser
// engine asked - the only way to tell a Meld request apart from a Chrome one.
// ---------------------------------------------------------------------------
const overlayPolls = new Map();
const OVERLAY_POLL_FRESH_MS = 15000;
// Persisted so a failure can be diagnosed from the files alone, without
// needing someone to read a number off the dashboard mid-stream. Records who
// asked for an overlay page and what browser engine asked - which is the only
// way to tell a Meld request apart from a Chrome one.
const OVERLAY_LOG_FILE = path.join(DATA_DIR, 'overlay-requests.json');
const overlayRequests = [];
let overlayLogWrittenAt = 0;

function noteOverlayRequest(kind, req, url) {
  overlayRequests.unshift({
    at: new Date().toISOString(),
    kind,
    url: url.pathname + (url.search || ''),
    userAgent: String(req.headers['user-agent'] || '(none)').slice(0, 200),
    referer: String(req.headers.referer || '') .slice(0, 200) || null,
    accept: String(req.headers.accept || '').slice(0, 120),
  });
  while (overlayRequests.length > 40) overlayRequests.pop();
  const now = Date.now();
  if (now - overlayLogWrittenAt < 3000) return;
  overlayLogWrittenAt = now;
  try { writeJson(OVERLAY_LOG_FILE, { schemaVersion: 1, updatedAt: new Date().toISOString(), requests: overlayRequests }); } catch (_error) { /* non-fatal */ }
}

function notePoll(src) {
  if (!src) return;
  const name = String(src).slice(0, 24).replace(/[^a-z0-9_-]/gi, '');
  if (!name) return;
  const prior = overlayPolls.get(name) || { count: 0, firstSeen: new Date().toISOString() };
  prior.count += 1;
  prior.lastSeen = new Date().toISOString();
  overlayPolls.set(name, prior);
}

function overlayPollView() {
  const now = Date.now();
  const out = {};
  for (const [name, info] of overlayPolls) {
    out[name] = {
      polling: (now - new Date(info.lastSeen).getTime()) < OVERLAY_POLL_FRESH_MS,
      count: info.count,
      lastSeen: info.lastSeen,
      firstSeen: info.firstSeen,
    };
  }
  return out;
}

let activeLog = null;
let activeOffset = 0;
let forceRescan = false;

function scanLog() {
  const file = findLogFile();
  if (!file) {
    activeLog = null;
    activeOffset = 0;
    updateReader({ state: live.reconciliation?.required ? 'needs-reconciliation' : 'offline', file: null, fileModifiedAt: null });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_error) {
    updateReader({ state: live.reconciliation?.required ? 'needs-reconciliation' : 'offline', file: null, fileModifiedAt: null });
    return;
  }

  if (forceRescan || activeLog !== file) {
    forceRescan = false;
    activeLog = file;
    activeOffset = stat.size;
    updateReader(readerView(stat, file));
    return;
  }

  if (live.reconciliation?.required) {
    activeOffset = stat.size;
    updateReader(readerView(stat, file));
    return;
  }

  if (stat.size < activeOffset) activeOffset = stat.size;
  if (stat.size === activeOffset) {
    updateReader(readerView(stat, file));
    return;
  }

  let appended;
  try {
    const handle = fs.openSync(file, 'r');
    const length = stat.size - activeOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, activeOffset);
    fs.closeSync(handle);
    activeOffset = stat.size;
    appended = buffer.toString('utf8');
  } catch (_error) {
    return;
  }

  let changed = false;
  let resourceChanged = false;
  let weeklyChanged = false;
  for (const line of appended.split(/\r?\n/)) {
    if (resourceTrackerScan(line)) resourceChanged = true;
    if (weeklyScan(line)) weeklyChanged = true;
    for (const delta of lineDelta(line)) {
      const current = Number(live.resources[delta.resource]) || 0;
      live.resources[delta.resource] = Math.max(0, Math.trunc(current + delta.amount));
      live.reader.lastEvent = { at: new Date().toISOString(), line: line.slice(-300), ...delta };
      live.reader.lastUpdateAt = live.reader.lastEvent.at;
      live.reader.state = 'live';
      live.reader.file = file;
      live.reader.fileModifiedAt = new Date(stat.mtimeMs).toISOString();
      changed = true;
    }
  }
  if (changed) {
    saveLive();
    broadcast('live', clone(live));
  }
  if (resourceChanged) broadcastResourceTrackers();
  if (weeklyChanged) broadcastWeekly();
  if (!changed && !resourceChanged && !weeklyChanged) updateReader(readerView(stat, file));
}

// 12MB cap - big enough for a base64-encoded 8MB image (base64 adds ~33%
// overhead, so an 8MB PNG/JPG becomes ~10.7MB of JSON text) plus room for the
// rest of the payload. tradeupSaveImage() and the resource-art upload route
// both enforce their own 8MB *decoded* image limit on top of this - this cap
// only needs to be large enough to let a body that size actually arrive.
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) reject(new Error('Request body is too large.'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_error) {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
}

function validTimezone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (_error) {
    return false;
  }
}

function validResource(resource) {
  return Object.prototype.hasOwnProperty.call(RESOURCE_META, resource);
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      service: 'ICB Clean Room',
      version: VERSION,
      port: PORT,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      readerState: live.reader.state,
      connectedClients: clientCounts(),
      overlayPolls: overlayPollView(),
    });
  }

  if (pathname === '/api/diagnostics' && method === 'GET') return sendJson(res, 200, {
    ok: true,
    version: VERSION,
    port: PORT,
    dataFiles: { settings: SETTINGS_FILE, live: LIVE_FILE, actions: ACTIONS_FILE },
    reader: clone(live.reader),
    activeLog,
    logDirectories: logDirectories(),
    staleAfterSeconds: Math.round(STALE_LOG_MS / 1000),
    connectedClients: clientCounts(),
    overlayPolls: overlayPollView(),
    trackerSkinStandard: {
      standardId: TRACKER_SKIN_STANDARD.standardId,
      width: TRACKER_SKIN_STANDARD.master.width,
      height: TRACKER_SKIN_STANDARD.master.height,
      aspectRatio: TRACKER_SKIN_STANDARD.master.aspectRatio,
      valueBoxBakedIntoArtwork: TRACKER_SKIN_STANDARD.structure.valueBox.bakedIntoArtwork,
      spec: '/api/tracker-skin-standard',
    },
  });

  // Canonical tracker skin geometry, served so overlay/dashboard/future
  // tracker components inherit the standard instead of hardcoding it.
  if (pathname === '/api/tracker-skin-standard' && method === 'GET') {
    return sendJson(res, 200, { ok: true, trackerSkinStandard: clone(TRACKER_SKIN_STANDARD) });
  }

  // ---------------- weekly accomplishments ----------------
  if (pathname === '/api/weekly' && method === 'GET') {
    notePoll(url.searchParams.get('src'));
    return sendJson(res, 200, { ok: true, weekly: weeklyView() });
  }

  if (pathname === '/api/weekly/undo-reset' && ['POST', 'PUT'].includes(method)) {
    if (!undoWeeklyReset()) return sendJson(res, 400, { ok: false, error: 'Nothing to undo.' });
    return sendJson(res, 200, { ok: true, weekly: weeklyView() });
  }

  if (pathname === '/api/weekly/reset' && ['POST', 'PUT'].includes(method)) {
    // Manual "start the week over", separate from the automatic rollover.
    weekly.previous = { weekStart: weekly.weekStart, progress: weekly.items.map(i => ({ id: i.id, count: i.count, done: Boolean(i.done) })) };
    for (const item of weekly.items) { item.count = 0; item.done = false; }
    weekly.lastResetAt = new Date().toISOString();
    broadcastWeekly();
    return sendJson(res, 200, { ok: true, weekly: weeklyView() });
  }

  {
    const match = pathname.match(/^\/api\/weekly\/([a-z0-9-]+)\/(toggle|set)$/i);
    if (match && ['POST', 'PUT'].includes(method)) {
      const item = findWeeklyItem(match[1].toLowerCase());
      if (!item) return sendJson(res, 404, { ok: false, error: 'No accomplishment with that id.' });
      const body = await readBody(req);
      if (match[2] === 'toggle') {
        // Ticking an automatic item by hand is allowed - the log can be wrong,
        // and Baby is the authority. Ticking sets its counter to the target.
        item.done = !item.done;
        if (item.type === 'collect') item.count = item.done ? Number(item.target || 1) : 0;
      } else {
        const value = Math.trunc(Number(body.count));
        if (!Number.isFinite(value)) return sendJson(res, 400, { ok: false, error: 'Send a whole number.' });
        item.count = Math.max(0, value);
        item.done = item.type === 'manual' ? item.done : item.count >= Number(item.target || 1);
      }
      broadcastWeekly();
      return sendJson(res, 200, { ok: true, weekly: weeklyView() });
    }
  }

  // ---------------- resource trackers ----------------
  if (pathname === '/api/resource-trackers' && method === 'GET') {
    notePoll(url.searchParams.get('src'));
    return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
  }

  if (pathname === '/api/resource-trackers/reset-session' && ['POST', 'PUT'].includes(method)) {
    resetResourceSession('manual');
    return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
  }

  if (pathname === '/api/resource-trackers/undo-reset' && ['POST', 'PUT'].includes(method)) {
    if (!undoResourceReset()) return sendJson(res, 400, { ok: false, error: 'Nothing to undo.' });
    return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
  }

  {
    const match = pathname.match(/^\/api\/resource-trackers\/([a-z0-9-]+)\/(adjust|set|visible|set-start)$/i);
    if (match && ['POST', 'PUT'].includes(method)) {
      const card = findResourceCard(match[1].toLowerCase());
      if (!card) return sendJson(res, 404, { ok: false, error: 'No resource tracker with that id.' });
      const body = await readBody(req);
      if (match[2] === 'set-start') {
        // Countdown cards only (e.g. Sashimi): change the batch size on the
        // fly. Persists to config/resource-trackers.json so it also survives
        // a restart, AND restocks the live count right now - a new batch
        // starting means "I have this many now", not "wait for a restart".
        if (card.mode !== 'countdown') {
          return sendJson(res, 400, { ok: false, error: `${card.name} isn't a countdown card - there's no batch size to set.` });
        }
        const startAt = Math.trunc(Number(body.startAt));
        if (!Number.isFinite(startAt) || startAt < 0) {
          return sendJson(res, 400, { ok: false, error: 'Send a whole number of 0 or more.' });
        }
        card.startAt = startAt;
        card.count = startAt;
        try {
          const cfg = JSON.parse(fs.readFileSync(RESOURCE_CARDS_FILE, 'utf8'));
          const def = (cfg.cards || []).find(c => c.id === card.id);
          if (def) {
            def.startAt = startAt;
            fs.writeFileSync(RESOURCE_CARDS_FILE, JSON.stringify(cfg, null, 2));
          }
        } catch (_error) { /* live change still applies even if the config write fails */ }
      } else if (match[2] === 'adjust' || match[2] === 'set') {
        if (card.mode === 'lifetime' && LIFETIME_SOURCE[card.id]) {
          return sendJson(res, 400, { ok: false, error: `${card.name} mirrors the main ${LIFETIME_SOURCE[card.id]} total. Correct it in the reconciliation panel so there is only ever one number.` });
        }
        const value = Number(match[2] === 'adjust' ? body.delta : body.value);
        if (!Number.isFinite(value)) return sendJson(res, 400, { ok: false, error: 'Send a whole number.' });
        card.count = Math.max(0, match[2] === 'adjust' ? card.count + Math.trunc(value) : Math.trunc(value));
      } else {
        card.visible = Boolean(body.visible);
      }
      broadcastResourceTrackers();
      return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
    }
  }

  {
    const match = pathname.match(/^\/api\/resource-trackers\/([a-z0-9-]+)\/secondary\/(adjust|set)$/i);
    if (match && ['POST', 'PUT'].includes(method)) {
      const card = findResourceCard(match[1].toLowerCase());
      if (!card) return sendJson(res, 404, { ok: false, error: 'No resource tracker with that id.' });
      if (!card.secondary) {
        return sendJson(res, 400, { ok: false, error: `${card.name} doesn't have a secondary count.` });
      }
      const body = await readBody(req);
      const value = Number(match[2] === 'adjust' ? body.delta : body.value);
      if (!Number.isFinite(value)) return sendJson(res, 400, { ok: false, error: 'Send a whole number.' });
      card.secondaryCount = Math.max(0, match[2] === 'adjust'
        ? (card.secondaryCount || 0) + Math.trunc(value)
        : Math.trunc(value));
      broadcastResourceTrackers();
      return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
    }
  }

  {
    // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection): each
    // material tracked on the card gets its own adjust/set, same shape as
    // every other per-card route, just addressed by card id AND slot id.
    const match = pathname.match(/^\/api\/resource-trackers\/([a-z0-9-]+)\/slot\/([a-z0-9-]+)\/(adjust|set)$/i);
    if (match && ['POST', 'PUT'].includes(method)) {
      const card = findResourceCard(match[1].toLowerCase());
      if (!card) return sendJson(res, 404, { ok: false, error: 'No resource tracker with that id.' });
      if (!Array.isArray(card.slots)) {
        return sendJson(res, 400, { ok: false, error: `${card.name} doesn't have slots.` });
      }
      const slot = card.slots.find(s => s.id === match[2].toLowerCase());
      if (!slot) return sendJson(res, 404, { ok: false, error: 'No slot with that id on this card.' });
      const body = await readBody(req);
      const value = Number(match[3] === 'adjust' ? body.delta : body.value);
      if (!Number.isFinite(value)) return sendJson(res, 400, { ok: false, error: 'Send a whole number.' });
      slot.count = Math.max(0, match[3] === 'adjust'
        ? (slot.count || 0) + Math.trunc(value)
        : Math.trunc(value));
      broadcastResourceTrackers();
      return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
    }
  }

  {
    // Zero every slot on a collection card at once (e.g. after turning
    // materials in) - same "are you sure" confirm pattern the dashboard
    // already uses for every other reset button.
    const match = pathname.match(/^\/api\/resource-trackers\/([a-z0-9-]+)\/slots-reset$/i);
    if (match && ['POST', 'PUT'].includes(method)) {
      const card = findResourceCard(match[1].toLowerCase());
      if (!card) return sendJson(res, 404, { ok: false, error: 'No resource tracker with that id.' });
      if (!Array.isArray(card.slots)) {
        return sendJson(res, 400, { ok: false, error: `${card.name} doesn't have slots.` });
      }
      for (const slot of card.slots) slot.count = 0;
      broadcastResourceTrackers();
      return sendJson(res, 200, { ok: true, resourceTrackers: resourceTrackersView() });
    }
  }

  if (pathname === '/api/state' && method === 'GET') return sendJson(res, 200, { ok: true, ...publicState() });
  if (pathname === '/api/settings' && method === 'GET') return sendJson(res, 200, { ok: true, settings: clone(settings) });
  if (pathname === '/api/live' && method === 'GET') return sendJson(res, 200, { ok: true, live: clone(live) });
  if (pathname === '/api/actions' && method === 'GET') return sendJson(res, 200, { ok: true, actions: clone(actions.slice(-50)) });

  if (pathname === '/api/live/reconcile' && ['PUT', 'POST'].includes(method)) {
    const body = await readBody(req);
    const incoming = body.resources && typeof body.resources === 'object' ? body.resources : body;
    const resources = {};
    for (const resource of Object.keys(RESOURCE_META)) {
      const value = Number(incoming[resource]);
      if (!Number.isFinite(value) || value < 0) return sendJson(res, 400, { ok: false, error: `A non-negative ${resource} total is required.` });
      resources[resource] = Math.trunc(value);
    }
    const now = new Date().toISOString();
    live.resources = resources;
    live.reconciliation = {
      ...live.reconciliation,
      required: false,
      reconciledAt: now,
      reconciledBy: 'operator',
    };
    live.reader.lastEvent = { at: now, source: 'operator-reconciliation', resources: clone(resources) };
    live.reader.lastUpdateAt = now;
    saveLive();
    broadcast('live', clone(live));
    forceRescan = true;
    scanLog();
    return sendJson(res, 200, { ok: true, live: clone(live) });
  }

  if (pathname === '/api/settings' && ['PUT', 'POST', 'PATCH'].includes(method)) {
    const body = await readBody(req);
    const incoming = body.settings && typeof body.settings === 'object' ? body.settings : body;
    const incomingStatus = cleanString(incoming.countdown?.status);
    const incomingZones = Array.isArray(incoming.worldClock?.zones) ? incoming.worldClock.zones : [];
    const incomingZoneById = {};
    for (const z of incomingZones) { if (z && typeof z === 'object' && typeof z.id === 'string') incomingZoneById[z.id] = z; }
    settings = mergeDefaults(settings, {
      countdown: {
        heading: cleanString(incoming.countdown?.heading, settings.countdown.heading),
        subheading: cleanString(incoming.countdown?.subheading, settings.countdown.subheading),
        targetAt: cleanString(incoming.countdown?.targetAt, settings.countdown.targetAt),
        timezone: cleanString(incoming.countdown?.timezone, settings.countdown.timezone),
        status: ['idle', 'running', 'timesup'].includes(incomingStatus) ? incomingStatus : settings.countdown.status,
      },
      worldClock: {
        // Six fixed slots only - an id in the incoming body that doesn't already exist is
        // ignored, so this can edit but never add or remove a clock.
        zones: settings.worldClock.zones.map(zone => {
          const patch = incomingZoneById[zone.id];
          if (!patch || typeof patch !== 'object') return zone;
          return {
            id: zone.id,
            label: cleanString(patch.label, zone.label),
            subLabel: cleanString(patch.subLabel, zone.subLabel),
            timezone: validTimezone(patch.timezone) ? patch.timezone : zone.timezone,
            visible: typeof patch.visible === 'boolean' ? patch.visible : zone.visible,
          };
        }),
      },
      stream: {
        title: cleanString(incoming.stream?.title, settings.stream.title),
        category: cleanString(incoming.stream?.category, settings.stream.category),
        goLiveMessage: cleanString(incoming.stream?.goLiveMessage, settings.stream.goLiveMessage),
      },
    });
    saveSettings();
    broadcast('settings', clone(settings));
    return sendJson(res, 200, { ok: true, settings: clone(settings) });
  }

  // Dashboard panel order (control.html only - never read by any Meld/overlay page). Saved
  // automatically every time Baby clicks a ▲/▼ button, separately from the "Save settings" button.
  if (pathname === '/api/layout' && ['PUT', 'POST', 'PATCH'].includes(method)) {
    const body = await readBody(req);
    // 2026-10-01: also carries the Tracker Command Center's card order
    // (trackerOrder) and the cards Baby removed from the dashboard
    // (trackerHidden). Each field is optional so the panel arrows and the
    // tracker drag/remove can save independently. Removing a card only hides
    // it on the dashboard - its config, count and Meld page are untouched.
    const keys = list => list.filter(key => typeof key === 'string' && key).map(key => key.slice(0, 60)).slice(0, 200);
    const next = {};
    if (Array.isArray(body.panelOrder)) next.panelOrder = keys(body.panelOrder).slice(0, 50);
    if (Array.isArray(body.trackerOrder)) next.trackerOrder = keys(body.trackerOrder);
    if (Array.isArray(body.trackerHidden)) next.trackerHidden = keys(body.trackerHidden);
    if (!Object.keys(next).length) return sendJson(res, 400, { ok: false, error: 'Send panelOrder, trackerOrder or trackerHidden as an array.' });
    settings = mergeDefaults(settings, { layout: next });
    saveSettings();
    broadcast('settings', clone(settings));
    return sendJson(res, 200, { ok: true, settings: clone(settings) });
  }

  // Ticker banner text + speed/pause (control.html only). A separate small endpoint, same idea as
  // /api/layout - she can update these any time without it getting tangled up with the bigger
  // "Save settings" form. Every field is optional so the dashboard can send just the ones on its
  // form without clobbering the others.
  if (pathname === '/api/ticker' && ['PUT', 'POST', 'PATCH'].includes(method)) {
    const body = await readBody(req);
    const next = {};
    if (body.text !== undefined) {
      const text = cleanString(body.text);
      if (!text) return sendJson(res, 400, { ok: false, error: 'The ticker needs some text.' });
      next.text = text.slice(0, 300);
    }
    if (body.speed !== undefined) {
      const speed = Math.round(Number(body.speed));
      if (!Number.isFinite(speed) || speed < 10 || speed > 500) {
        return sendJson(res, 400, { ok: false, error: 'Speed must be between 10 and 500 (pixels per second).' });
      }
      next.speed = speed;
    }
    if (body.pause !== undefined) {
      const pause = Number(body.pause);
      if (!Number.isFinite(pause) || pause < 0 || pause > 30) {
        return sendJson(res, 400, { ok: false, error: 'Pause must be between 0 and 30 seconds.' });
      }
      next.pause = Math.round(pause * 10) / 10;
    }
    if (!Object.keys(next).length) return sendJson(res, 400, { ok: false, error: 'Nothing to save.' });
    settings = mergeDefaults(settings, { ticker: next });
    saveSettings();
    broadcast('settings', clone(settings));
    return sendJson(res, 200, { ok: true, settings: clone(settings) });
  }

  // ---------------- Daily / Weekly to-do lists ----------------
  // Dashboard-only (control.html), confirmed with Baby 2026-08-25: no Palia log involvement, no
  // automatic reset of either list - she adds and deletes everything herself. Two kinds of item
  // share the same list: 'check' (a plain done/not-done line) and 'goal' (a running count toward
  // a target she sets, e.g. "1/100").
  if (pathname === '/api/todos' && method === 'GET') {
    return sendJson(res, 200, { ok: true, todos: clone(todos) });
  }

  const todoListMatch = pathname.match(/^\/api\/todos\/(daily|weekly)$/);
  if (todoListMatch && method === 'POST') {
    const list = todoListMatch[1];
    const body = await readBody(req);
    const text = cleanString(body.text);
    if (!text) return sendJson(res, 400, { ok: false, error: 'A to-do needs some text.' });
    const kind = body.kind === 'goal' ? 'goal' : 'check';
    const item = {
      id: `todo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      text,
      kind,
      createdAt: new Date().toISOString(),
    };
    if (kind === 'goal') {
      const target = Math.trunc(Number(body.target));
      if (!Number.isFinite(target) || target <= 0) {
        return sendJson(res, 400, { ok: false, error: 'A goal needs a target greater than 0 (e.g. 100 for "1/100").' });
      }
      item.target = target;
      item.current = 0;
    } else {
      item.done = false;
    }
    todos[list].push(item);
    broadcastTodos();
    return sendJson(res, 200, { ok: true, todos: clone(todos) });
  }

  const todoItemMatch = pathname.match(/^\/api\/todos\/(daily|weekly)\/([a-z0-9-]+)$/i);
  if (todoItemMatch) {
    const list = todoItemMatch[1];
    const items = todos[list];
    const index = items.findIndex(entry => entry.id === todoItemMatch[2]);
    if (index < 0) return sendJson(res, 404, { ok: false, error: 'No to-do with that id.' });

    if (method === 'DELETE') {
      items.splice(index, 1);
      broadcastTodos();
      return sendJson(res, 200, { ok: true, todos: clone(todos) });
    }

    if (['PUT', 'POST', 'PATCH'].includes(method)) {
      const item = items[index];
      const body = await readBody(req);
      if (body.text !== undefined) {
        const text = cleanString(body.text);
        if (!text) return sendJson(res, 400, { ok: false, error: 'A to-do needs some text.' });
        item.text = text;
      }
      if (item.kind === 'check' && body.done !== undefined) {
        item.done = Boolean(body.done);
      }
      if (item.kind === 'goal') {
        if (body.delta !== undefined) {
          const delta = Math.trunc(Number(body.delta));
          if (!Number.isFinite(delta)) return sendJson(res, 400, { ok: false, error: 'delta must be a whole number.' });
          item.current = Math.max(0, item.current + delta);
        }
        if (body.current !== undefined) {
          const current = Math.trunc(Number(body.current));
          if (!Number.isFinite(current) || current < 0) return sendJson(res, 400, { ok: false, error: 'Progress must be 0 or more.' });
          item.current = current;
        }
        if (body.target !== undefined) {
          const target = Math.trunc(Number(body.target));
          if (!Number.isFinite(target) || target <= 0) return sendJson(res, 400, { ok: false, error: 'Target must be greater than 0.' });
          item.target = target;
        }
      }
      broadcastTodos();
      return sendJson(res, 200, { ok: true, todos: clone(todos) });
    }
  }

  const resourceMatch = pathname.match(/^\/api\/live\/(amber|essence|sweetLeaf)(?:\/correct)?$/);
  if (resourceMatch) {
    const resource = resourceMatch[1];
    if (!validResource(resource)) return sendJson(res, 404, { ok: false, error: 'Unknown resource.' });
    if (method === 'GET') return sendJson(res, 200, { ok: true, resource, label: RESOURCE_META[resource].label, value: live.resources[resource] });
    if (!['PUT', 'POST', 'PATCH'].includes(method) || !pathname.endsWith('/correct')) return sendJson(res, 405, { ok: false, error: 'Use the deliberate /correct endpoint for writes.' });
    if (live.reconciliation?.required) return sendJson(res, 409, { ok: false, error: 'Set all three current totals with /api/live/reconcile before correcting individual resources.' });
    const body = await readBody(req);
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0) return sendJson(res, 400, { ok: false, error: 'value must be a non-negative number.' });
    live.resources[resource] = Math.trunc(value);
    live.reader.lastEvent = { at: new Date().toISOString(), source: 'manual-correction', resource, value: live.resources[resource] };
    live.reader.lastUpdateAt = live.reader.lastEvent.at;
    saveLive();
    broadcast('live', clone(live));
    return sendJson(res, 200, { ok: true, resource, value: live.resources[resource] });
  }

  if (pathname === '/api/actions' && method === 'POST') {
    const body = await readBody(req);
    const target = cleanString(body.target);
    if (!target) return sendJson(res, 400, { ok: false, error: 'target is required.' });
    const commandId = cleanString(body.commandId) || `cmd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const action = {
      commandId,
      target,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      status: 'accepted',
      requestedAt: new Date().toISOString(),
    };
    recordAction(action);

    if (target === 'reader.rescan') {
      forceRescan = true;
      scanLog();
      action.status = 'completed';
      action.message = 'Reader scan requested.';
    } else if (target === 'session.set-mode' && ['offline', 'on-air', 'break'].includes(action.payload.mode)) {
      live.session.mode = action.payload.mode;
      saveLive();
      broadcast('live', clone(live));
      action.status = 'completed';
      action.message = `Session mode set to ${action.payload.mode}.`;
    } else if (target === 'overlay.ping') {
      action.status = 'completed';
      action.message = 'Overlay event path is available.';
    } else {
      action.status = 'rejected';
      action.message = 'This clean build does not execute that command yet.';
    }
    recordAction({ ...action, completedAt: new Date().toISOString() });
    return sendJson(res, action.status === 'rejected' ? 400 : 202, { ok: action.status !== 'rejected', action });
  }

  if (pathname.startsWith('/api/tradeup/')) return handleTradeupApi(req, res, pathname, method);
  if (pathname.startsWith('/api/decor/')) return handleDecorApi(req, res, pathname, method);
  if (pathname === '/api/hub' || pathname.startsWith('/api/hub/')) return handleHubApi(req, res, pathname, method);
  if (pathname === '/api/connection-check' || pathname.startsWith('/api/connection-check/')) return handleHealthApi(req, res, pathname, method);
  if (pathname.startsWith('/api/walkers/')) return handleWalkersApi(req, res, pathname, method, url);

  // ---------------- Stream Giveaway ----------------
  if (pathname === '/api/giveaway/state' && method === 'GET') {
    return sendJson(res, 200, { ok: true, giveaway: publicGiveaway() });
  }

  // Called by giveaway-listener.html (the Meld Firehose relay) for every raw
  // chat/sub/gifts/bits event. This is the ONLY place ticket math happens.
  if (pathname === '/api/giveaway/event' && method === 'POST') {
    const body = await readBody(req);
    const type = cleanString(body.type);
    const username = cleanString(body.username);
    listenerStatus.lastSeen = new Date().toISOString();
    listenerStatus.lastEventAt = listenerStatus.lastSeen;
    listenerStatus.lastEvent = `${type}${username ? ' from ' + username : ''}${type === 'bits' ? ' (' + body.amount + ' bits)' : ''}${type === 'gifts' ? ' (' + body.count + ' gifted)' : ''}${type === 'sub' && body.months > 1 ? ' (' + body.months + ' months)' : ''}`;
    const blocked = username && isBlocked(username);
    // Report-only events: no unicorns, just the nightly log.
    if (type === 'follow') {
      if (username) logActivity({ type: 'follow', username });
      return sendJson(res, 200, { ok: true });
    }
    if (type === 'raid') {
      logActivity({ type: 'raid', username, viewers: Math.max(0, Math.trunc(Number(body.viewers)) || 0) });
      return sendJson(res, 200, { ok: true });
    }
    if (blocked) {
      // Real support from a blocked name (e.g. a sub) still goes in the report.
      if (type !== 'chat') logActivity({ type, username, blocked: true, months: body.months, count: body.count, amount: body.amount, tier: cleanString(body.tier), subType: cleanString(body.subType) });
      return sendJson(res, 200, { ok: true, note: 'blocked name, ignored.' });
    }

    if (type === 'chat') {
      if (!username) return sendJson(res, 400, { ok: false, error: 'username is required.' });
      logActivity({ type: 'chat', username });
      giveaway.chatActiveThisWindow[ensureEntrant(username).username] = true;
      ensureEntrant(username).lastSeenAt = new Date().toISOString();
      saveGiveaway();
      return sendJson(res, 200, { ok: true });
    }

    if (type === 'sub') {
      if (!username) return sendJson(res, 400, { ok: false, error: 'username is required.' });
      const entrant = ensureEntrant(username);
      // Firehose sends months_purchased: 1 for a normal sub/resub, more when
      // someone buys several months at once.
      const months = Math.min(24, Math.max(1, Math.trunc(Number(body.months)) || 1));
      const before = entrantTotal(entrant);
      entrant.counts.subMonths += months;
      recomputeEntrant(entrant);
      logActivity({ type: 'sub', username: entrant.username, months, tier: cleanString(body.tier), subType: cleanString(body.subType), unicorns: entrantTotal(entrant) - before });
      entrant.lastSeenAt = new Date().toISOString();
      broadcastGiveaway();
      return sendJson(res, 200, { ok: true, entrant: { ...entrant, totalTickets: entrantTotal(entrant) } });
    }

    if (type === 'gifts') {
      if (!username) return sendJson(res, 400, { ok: false, error: 'username is required.' });
      const count = Math.max(0, Math.trunc(Number(body.count)) || 0);
      if (count <= 0) return sendJson(res, 200, { ok: true, note: 'count was 0, nothing awarded.' });
      const entrant = ensureEntrant(username);
      const before = entrantTotal(entrant);
      entrant.counts.giftedSubs += count;
      recomputeEntrant(entrant);
      const recipients = Array.isArray(body.recipients) ? body.recipients.map(r => cleanString(r)).filter(Boolean).slice(0, 100) : [];
      logActivity({ type: 'gifts', username: entrant.username, count, tier: cleanString(body.tier), recipients, unicorns: entrantTotal(entrant) - before });
      entrant.lastSeenAt = new Date().toISOString();
      broadcastGiveaway();
      return sendJson(res, 200, { ok: true, entrant: { ...entrant, totalTickets: entrantTotal(entrant) } });
    }

    if (type === 'bits') {
      if (!username) return sendJson(res, 400, { ok: false, error: 'username is required.' });
      const amount = Math.max(0, Math.trunc(Number(body.amount)) || 0);
      if (amount <= 0) return sendJson(res, 200, { ok: true, note: 'no bits, nothing recorded.' });
      const entrant = ensureEntrant(username);
      // Bits add up across cheers: 60 + 50 = 110 bits = 1 unicorn at 100 per.
      const before = entrantTotal(entrant);
      entrant.counts.bits += amount;
      recomputeEntrant(entrant);
      logActivity({ type: 'bits', username: entrant.username, amount, unicorns: entrantTotal(entrant) - before });
      entrant.lastSeenAt = new Date().toISOString();
      broadcastGiveaway();
      return sendJson(res, 200, { ok: true, entrant: { ...entrant, totalTickets: entrantTotal(entrant) } });
    }

    return sendJson(res, 400, { ok: false, error: `Unknown event type "${type}".` });
  }

  // Dashboard-only manual ticket adjustment (donations, corrections, etc.
  // that don't come through Firehose).
  // Accepts one `username` or a `usernames` array (e.g. a list of existing
  // subs), matches existing entrants case-insensitively so "bob" and "Bob"
  // don't become two people, and logs every give/take with a reason.
  if (pathname === '/api/giveaway/manual' && method === 'POST') {
    const body = await readBody(req);
    const rawNames = Array.isArray(body.usernames) ? body.usernames : [body.username];
    const seen = new Set();
    const names = [];
    for (const raw of rawNames) {
      const name = cleanString(raw).replace(/^@/, '');
      if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); names.push(name); }
    }
    // kind: what Baby is adding. "unicorns" = plain fluffy unicorns;
    // "subMonths" / "giftedSubs" / "bits" = the real thing, priced by rates
    // and shown in that viewer's breakdown + sub info (6 months -> sub 12).
    const KIND_FIELDS = { subMonths: 'subMonths', giftedSubs: 'giftedSubs', bits: 'bits' };
    const kind = KIND_FIELDS[body.kind] ? body.kind : 'unicorns';
    const amount = Math.trunc(Number(body.amount !== undefined ? body.amount : body.delta));
    const maxAmount = kind === 'bits' ? 1000000 : 1000;
    const reason = cleanString(body.reason).slice(0, 80);
    if (!names.length) return sendJson(res, 400, { ok: false, error: 'Type at least one username.' });
    if (names.length > 200) return sendJson(res, 400, { ok: false, error: 'Max 200 names at once.' });
    if (!Number.isFinite(amount) || amount === 0) return sendJson(res, 400, { ok: false, error: 'Amount must be a non-zero whole number.' });
    if (Math.abs(amount) > maxAmount) return sendJson(res, 400, { ok: false, error: `Amount must be between -${maxAmount} and ${maxAmount}.` });

    if (!Array.isArray(giveaway.manualLog)) giveaway.manualLog = [];
    const results = [];
    const now = new Date().toISOString();
    const skipped = names.filter(n => isBlocked(n));
    for (const name of names.filter(n => !isBlocked(n))) {
      const existingKey = findEntrantKey(name);
      const entrant = ensureEntrant(existingKey || name);
      const totalBefore = entrantTotal(entrant);
      let appliedAmount;
      if (kind === 'unicorns') {
        const before = entrant.manualTickets;
        // Manual can go negative to correct auto-earned unicorns, but a
        // viewer's total never drops below 0.
        const autoEarned = totalBefore - before;
        entrant.manualTickets = Math.max(-autoEarned, entrant.manualTickets + amount);
        appliedAmount = entrant.manualTickets - before;
      } else {
        const field = KIND_FIELDS[kind];
        const before = entrant.counts[field];
        entrant.counts[field] = Math.max(0, before + amount);
        appliedAmount = entrant.counts[field] - before;
        recomputeEntrant(entrant);
      }
      const delta = entrantTotal(entrant) - totalBefore;
      giveaway.manualLog.push({ username: entrant.username, kind, amount: appliedAmount, delta, reason, at: now });
      logActivity({ type: 'manual', username: entrant.username, kind, amount: appliedAmount, unicorns: delta, reason });
      results.push({ username: entrant.username, kind, appliedAmount, applied: delta, totalTickets: entrantTotal(entrant), wasNew: !existingKey });
    }
    if (giveaway.manualLog.length > 300) giveaway.manualLog = giveaway.manualLog.slice(-300);
    if (!results.length) return sendJson(res, 400, { ok: false, error: `${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} on the block list.` });
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, results, skipped });
  }

  // Raw Firehose events from the listener's catch-all, for the nightly report.
  // Body is capped (readBody) and nothing here touches unicorns.
  if (pathname === '/api/activity/raw' && method === 'POST') {
    const body = await readBody(req);
    const kind = cleanString(body.kind).slice(0, 60);
    if (kind) logActivity({ type: 'raw', kind, data: body.data });
    try { healthNoteRaw(kind, body.data); } catch (_error) {}
    // Chat Unicorns: every chat message (sender + text + emote pictures).
    if (kind === 'chat' && body.data && typeof body.data.sender === 'string') {
      try { walkerChat(body.data.sender, walkerParts(body.data), false); } catch (_error) {}
    }
    return sendJson(res, 200, { ok: true });
  }

  // Empty the on-screen jar now (counts are untouched).
  if (pathname === '/api/giveaway/jar/empty' && method === 'POST') {
    backupGiveaway('before', 'empty-jar');
    snapshotJar();
    logActivity({ type: 'jar_emptied' });
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, jar: jarView() });
  }

  // Nightly report data (giveaway-report.html).
  if (pathname === '/api/activity/nights' && method === 'GET') {
    let nights = [];
    try {
      nights = fs.readdirSync(ACTIVITY_DIR).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).map(n => n.slice(0, 10)).sort().reverse();
    } catch (_error) { nights = []; }
    return sendJson(res, 200, { ok: true, nights, tonight: nightKey(new Date()) });
  }
  if (pathname === '/api/activity/night' && method === 'GET') {
    const key = url.searchParams.get('date') || nightKey(new Date());
    const events = readNight(key);
    if (events === null) return sendJson(res, 400, { ok: false, error: 'date must look like 2026-09-25.' });
    return sendJson(res, 200, { ok: true, date: key, events, rates: clone(giveaway.rates), blocked: clone(giveaway.blocked || []),
      standings: Object.values(giveaway.entrants).map(e => ({ username: e.username, total: entrantTotal(e), counts: e.counts, note: e.note, mysteryOutfitWon: !!e.mysteryOutfitWon })) });
  }

  // Heartbeat from giveaway-listener.html every few seconds.
  if (pathname === '/api/giveaway/listener' && method === 'POST') {
    const body = await readBody(req);
    const wasConnected = listenerStatus.firehose === 'connected';
    listenerStatus.lastSeen = new Date().toISOString();
    listenerStatus.firehose = ['connected', 'connecting', 'no-sdk'].includes(body.firehose) ? body.firehose : 'unknown';
    if (wasConnected !== (listenerStatus.firehose === 'connected')) broadcast('giveaway', publicGiveaway());
    if (typeof body.page === 'string') listenerStatus.page = body.page.slice(0, 200);
    const reload = health.listenerReload;
    health.listenerReload = false;
    return sendJson(res, 200, { ok: true, reload });
  }

  // Block list: never in the giveaway. Removes anyone already entered.
  if (pathname === '/api/giveaway/blocked' && method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.names)) return sendJson(res, 400, { ok: false, error: 'names must be a list.' });
    const seen = new Set();
    giveaway.blocked = body.names.map(n => cleanString(n).replace(/^@/, '')).filter(n => {
      if (!n || seen.has(n.toLowerCase())) return false;
      seen.add(n.toLowerCase()); return true;
    }).slice(0, 200);
    const removed = purgeBlocked();
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, blocked: giveaway.blocked, removed });
  }

  // Free-text info per viewer ("subbed since March", "tier 3", ...).
  if (pathname === '/api/giveaway/note' && method === 'POST') {
    const body = await readBody(req);
    const username = cleanString(body.username).replace(/^@/, '');
    if (!username) return sendJson(res, 400, { ok: false, error: 'username is required.' });
    const entrant = ensureEntrant(username);
    entrant.note = cleanString(body.note).slice(0, 200);
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, entrant });
  }

  // How many fluffy unicorns each thing is worth. Re-prices everyone.
  if (pathname === '/api/giveaway/rates' && method === 'POST') {
    const body = await readBody(req);
    const r = giveaway.rates;
    if (body.chatWindow !== undefined) r.chatWindow = cleanRate(body.chatWindow, r.chatWindow, 0, 100);
    if (body.subMonth !== undefined) r.subMonth = cleanRate(body.subMonth, r.subMonth, 0, 100);
    if (body.giftedSub !== undefined) r.giftedSub = cleanRate(body.giftedSub, r.giftedSub, 0, 100);
    if (body.bitsPerUnicorn !== undefined) r.bitsPerUnicorn = cleanRate(body.bitsPerUnicorn, r.bitsPerUnicorn, 1, 100000);
    for (const key of Object.keys(giveaway.entrants)) recomputeEntrant(giveaway.entrants[key]);
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, rates: clone(r) });
  }

  // Draws a weighted-random winner. Plushie winners stay in the pool for
  // future draws; Mystery Outfit winners are excluded from future Mystery
  // Outfit draws only (still eligible for Plushie).
  if (pathname === '/api/giveaway/draw' && method === 'POST') {
    const body = await readBody(req);
    const prize = body.prize === 'mystery-outfit' ? 'mystery-outfit' : (body.prize === 'plushie' ? 'plushie' : null);
    if (!prize) return sendJson(res, 400, { ok: false, error: 'prize must be "plushie" or "mystery-outfit".' });

    const pool = [];
    for (const username of Object.keys(giveaway.entrants)) {
      const entrant = giveaway.entrants[username];
      if (prize === 'mystery-outfit' && entrant.mysteryOutfitWon) continue;
      if (isBlocked(username)) continue;
      const tickets = entrantTotal(entrant);
      for (let i = 0; i < tickets; i++) pool.push(username);
    }
    if (!pool.length) return sendJson(res, 400, { ok: false, error: 'No eligible entrants with tickets for this drawing.' });

    const winnerName = pool[Math.floor(Math.random() * pool.length)];
    const winnerEntrant = giveaway.entrants[winnerName];
    if (prize === 'mystery-outfit') winnerEntrant.mysteryOutfitWon = true;
    // Bake in whatever the current custom prize name is right now (Baby,
    // 2026-09-26), so this winner's record keeps it even if the label
    // changes before the next draw. Empty means "use the generic wording".
    const prizeLabel = giveaway.display.currentPrizeLabel || '';
    const winnerRecord = { username: winnerName, prize, prizeLabel, tickets: entrantTotal(winnerEntrant), at: new Date().toISOString() };
    giveaway.winners.push(winnerRecord);
    logActivity({ type: 'winner', username: winnerName, prize, unicorns: winnerRecord.tickets, poolSize: pool.length });
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, winner: winnerRecord });
  }

  // Backups (Baby, 2026-09-26). List them, make one now, or restore one.
  if (pathname === '/api/giveaway/backups' && method === 'GET') {
    return sendJson(res, 200, { ok: true, backups: listGiveawayBackups() });
  }
  if (pathname === '/api/giveaway/backups/now' && method === 'POST') {
    const file = backupGiveaway('before', 'manual');
    return sendJson(res, file ? 200 : 500, { ok: !!file, file });
  }
  if (pathname === '/api/giveaway/backups/restore' && method === 'POST') {
    const body = await readBody(req);
    const file = String(body.file || '');
    if (!/^[a-z]+_[0-9_-]+(_[a-z0-9-]+)?\.json$/i.test(file)) return sendJson(res, 400, { ok: false, error: 'Bad backup name.' });
    const full = path.join(GIVEAWAY_BACKUP_DIR, file);
    let restored;
    try { restored = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch (_error) { return sendJson(res, 404, { ok: false, error: 'That backup could not be read.' }); }
    const safety = backupGiveaway('before', 'restore');
    giveaway = mergeDefaults(GIVEAWAY_DEFAULTS, restored);
    if (!giveaway.windowStartedAt) giveaway.windowStartedAt = new Date().toISOString();
    migrateGiveaway();
    purgeBlocked();
    logActivity({ type: 'backup_restored', file, safetyCopy: safety });
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, restored: file, safetyCopy: safety });
  }

  // Runs the full drawing show on unicorn-jar.html with IJustABabyTv as the
  // winner, for demos - no entrant, winners-list, or activity-log data is
  // touched, so it never shows up in the real Winners Circle or nightly
  // report. Baby (2026-09-26).
  if (pathname === '/api/giveaway/draw-test' && method === 'POST') {
    const body = await readBody(req);
    const prize = body.prize === 'mystery-outfit' ? 'mystery-outfit' : 'plushie';
    giveaway.testDraw = { seq: (giveaway.testDraw && giveaway.testDraw.seq || 0) + 1, prize };
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, testDraw: clone(giveaway.testDraw) });
  }

  // Clears just the Winners Circle history (and the Mystery Outfit "already
  // won" lock, since that's tied to being in the winners list) - everything
  // else (entrants, fluffy unicorn counts, sub info, rates, board text,
  // blocked list) is left alone. Baby (2026-09-27): a way to reset the
  // winners list on its own, e.g. once a day, without touching the rest.
  // Manual only - she presses the button, nothing resets on a timer.
  if (pathname === '/api/giveaway/winners/reset' && method === 'POST') {
    backupGiveaway('before', 'reset-winners');
    const clearedCount = giveaway.winners.length;
    logActivity({ type: 'winners_reset', count: clearedCount });
    giveaway.winners = [];
    for (const username of Object.keys(giveaway.entrants)) {
      giveaway.entrants[username].mysteryOutfitWon = false;
    }
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, cleared: clearedCount });
  }

  // Full reset for a new stream night. Manual only - no auto-reset.
  if (pathname === '/api/giveaway/reset' && method === 'POST') {
    backupGiveaway('before', 'reset-everything');
    logActivity({ type: 'reset' });
    const keptDisplay = clone(giveaway.display);
    const keptRates = clone(giveaway.rates);
    const keptBlocked = clone(giveaway.blocked);
    giveaway = clone(GIVEAWAY_DEFAULTS);
    giveaway.display = keptDisplay; // wording is a setting, not tonight's data
    giveaway.rates = keptRates;
    giveaway.blocked = keptBlocked;
    giveaway.windowStartedAt = new Date().toISOString();
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true });
  }

  // Overlay wording, edited from the dashboard's "Board text" card.
  if (pathname === '/api/giveaway/display' && method === 'POST') {
    const body = await readBody(req);
    const d = giveaway.display;
    if (typeof body.entrantsTitle === 'string') d.entrantsTitle = cleanString(body.entrantsTitle);
    if (typeof body.emptyMessage === 'string') d.emptyMessage = cleanString(body.emptyMessage);
    if (typeof body.winnersTitle === 'string') d.winnersTitle = cleanString(body.winnersTitle);
    if (typeof body.winnersEmptyMessage === 'string') d.winnersEmptyMessage = cleanString(body.winnersEmptyMessage);
    if (body.maxRows !== undefined) {
      const n = Math.trunc(Number(body.maxRows));
      if (Number.isFinite(n)) d.maxRows = Math.min(50, Math.max(1, n));
    }
    if (['left', 'center', 'right'].includes(body.jarSide)) d.jarSide = body.jarSide;
    if (['small', 'medium', 'large'].includes(body.unicornSize)) d.unicornSize = body.unicornSize;
    if (typeof body.showNames === 'boolean') d.showNames = body.showNames;
    if (typeof body.magic === 'boolean') d.magic = body.magic;
    if (typeof body.currentPrizeLabel === 'string') d.currentPrizeLabel = cleanString(body.currentPrizeLabel).slice(0, 60);
    if (Array.isArray(body.tickerMessages)) {
      d.tickerMessages = body.tickerMessages.map(m => cleanString(m)).filter(Boolean).slice(0, 30);
    }
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, display: clone(d) });
  }

  if (pathname === '/api/giveaway/display/reset' && method === 'POST') {
    giveaway.display = clone(GIVEAWAY_DEFAULTS.display);
    broadcastGiveaway();
    return sendJson(res, 200, { ok: true, display: clone(giveaway.display) });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, pathname) {
  // Browsers ask for this unprompted; a 404 in the console during a live
  // overlay debug is pure noise.
  if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  // "/" is now ICB Home, the page with a tile for every dashboard (2026-09-29).
  const requested = pathname === '/' ? '/hub.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch (_error) {
    return sendJson(res, 400, { ok: false, error: 'Invalid URL path.' });
  }
  const file = path.resolve(APP_DIR, `.${decoded}`);
  if (!file.startsWith(`${APP_DIR}${path.sep}`)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}

// Shared HTML-escaper for the server-rendered overlay pages.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// RESOURCE TRACKERS — one card per resource, each its own Meld layer.
//
// Every token in config/resource-trackers.json was read out of a real
// Inventory/Lockbox line in Baby's own logs. Never add a guessed one: a wrong
// token is a card that sits at zero all stream and looks like a bug.
//
// Two modes:
//   lifetime — never resets. Amber Echo and Infected Essence only. These read
//              their value from the EXISTING live.resources totals rather than
//              counting separately, so there is exactly one number for each
//              and the reconciliation controls keep working.
//   session  — starts at 0 each time Baby logs into Palia. The previous value
//              is kept so a reset can be undone with one click; she logged in
//              11 times in a single day, so silently wiping counts is not safe.
// ---------------------------------------------------------------------------
const RESOURCE_CARDS_FILE = path.join(APP_DIR, 'config', 'resource-trackers.json');
const RESOURCE_STATE_FILE = path.join(DATA_DIR, 'resource-trackers.json');
const RESOURCE_ART_DIR = path.join(APP_DIR, 'assets', 'resources');
// Verified against every log Baby has: these two strings appear ONLY when the
// game is starting up, never on zone travel. app-20260818.log contains no
// other MAP_ value at all.
const LOGIN_PATTERN = /MAP_IntroMovie|MAP_PreGame/;
// One login produces several of these lines within a few seconds; without this
// window a single login would fire several resets in a row.
const LOGIN_DEBOUNCE_MS = 120000;

function resourceCardDefs() {
  const cfg = JSON.parse(fs.readFileSync(RESOURCE_CARDS_FILE, 'utf8'));
  return Array.isArray(cfg.cards) ? cfg.cards : [];
}

function loadResourceTrackers() {
  const defs = resourceCardDefs();
  let saved = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(RESOURCE_STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch (_error) { /* first run */ }
  const counts = saved.counts || {};
  const previous = saved.previous || {};
  const secondaryCounts = saved.secondaryCounts || {};
  const slotCounts = saved.slotCounts || {};
  return {
    schemaVersion: 1,
    // Config owns the definitions, state owns the progress - so a token can be
    // corrected without wiping a live count. Exception: 'countdown' cards
    // (e.g. Sashimi) are deliberately NOT restored from disk - Baby asked for
    // these to snap back to their starting stock every time the server
    // restarts, not persist like every other card.
    cards: defs.map(def => ({
      ...def,
      // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) have NO
      // single count - each slot (Ash Wood, Stone, ...) tracks its own number
      // against its own spot on the card art, so `count` is skipped entirely
      // for these and `slots` carries each one's persisted count instead.
      ...(Array.isArray(def.slots) ? {
        slots: def.slots.map(slot => ({
          ...slot,
          count: Number((slotCounts[def.id] || {})[slot.id]) || 0,
        })),
      } : {
        count: def.mode === 'countdown' ? Number(def.startAt) || 0 : Number(counts[def.id]) || 0,
      }),
      // A card's optional 'secondary' count (e.g. Ramen Plush's "Ramen Cooked"
      // count riding alongside its Plushies count in the same box) is its own
      // independent, never-auto-reset number - not part of `counts`.
      ...(def.secondary ? { secondaryCount: Number(secondaryCounts[def.id]) || 0 } : {}),
      visible: saved.visible && def.id in saved.visible ? Boolean(saved.visible[def.id]) : def.visible !== false,
    })),
    counts: { ...counts },
    secondaryCounts: { ...secondaryCounts },
    slotCounts: { ...slotCounts },
    previous: { ...previous },
    lastLoginAt: saved.lastLoginAt || null,
    lastResetAt: saved.lastResetAt || null,
    canUndoReset: Boolean(previous && Object.keys(previous).length),
    updatedAt: saved.updatedAt || null,
  };
}

let resourceTrackers = loadResourceTrackers();
let lastLoginSeenMs = 0;

// Lifetime cards mirror the existing reconciled totals instead of keeping a
// second, competing number.
const LIFETIME_SOURCE = { 'amber-echo': 'amber', essence: 'essence' };

function resourceTrackersView() {
  const view = clone(resourceTrackers);
  for (const card of view.cards) {
    const key = LIFETIME_SOURCE[card.id];
    if (card.mode === 'lifetime' && key) {
      const value = live.resources ? live.resources[key] : null;
      card.count = Number.isFinite(Number(value)) ? Number(value) : 0;
      card.source = `live.resources.${key}`;
    }
  }
  return view;
}

function saveResourceTrackers() {
  resourceTrackers.updatedAt = new Date().toISOString();
  for (const card of resourceTrackers.cards) {
    if (!Array.isArray(card.slots)) resourceTrackers.counts[card.id] = card.count;
  }
  resourceTrackers.secondaryCounts = resourceTrackers.secondaryCounts || {};
  for (const card of resourceTrackers.cards) {
    if (card.secondary) resourceTrackers.secondaryCounts[card.id] = card.secondaryCount || 0;
  }
  resourceTrackers.slotCounts = resourceTrackers.slotCounts || {};
  for (const card of resourceTrackers.cards) {
    if (!Array.isArray(card.slots)) continue;
    const entry = {};
    for (const slot of card.slots) entry[slot.id] = slot.count || 0;
    resourceTrackers.slotCounts[card.id] = entry;
  }
  const visible = {};
  for (const card of resourceTrackers.cards) visible[card.id] = card.visible !== false;
  writeJson(RESOURCE_STATE_FILE, {
    schemaVersion: 1,
    counts: resourceTrackers.counts,
    secondaryCounts: resourceTrackers.secondaryCounts,
    slotCounts: resourceTrackers.slotCounts,
    previous: resourceTrackers.previous,
    visible,
    lastLoginAt: resourceTrackers.lastLoginAt,
    lastResetAt: resourceTrackers.lastResetAt,
    updatedAt: resourceTrackers.updatedAt,
  });
}
try { saveResourceTrackers(); } catch (_error) { /* non-fatal */ }

function broadcastResourceTrackers() {
  resourceTrackers.canUndoReset = Boolean(Object.keys(resourceTrackers.previous || {}).length);
  saveResourceTrackers();
  broadcast('resourcetrackers', resourceTrackersView());
}

function resetResourceSession(reason) {
  const previous = {};
  let any = false;
  for (const card of resourceTrackers.cards) {
    if (card.mode !== 'session') continue;
    previous[card.id] = card.count;
    if (card.count) any = true;
    card.count = 0;
  }
  // Only offer undo when there was something to lose.
  resourceTrackers.previous = any ? previous : {};
  resourceTrackers.lastResetAt = new Date().toISOString();
  resourceTrackers.lastResetReason = reason;
  broadcastResourceTrackers();
}

function undoResourceReset() {
  const previous = resourceTrackers.previous || {};
  if (!Object.keys(previous).length) return false;
  for (const card of resourceTrackers.cards) {
    if (card.mode !== 'session') continue;
    if (Number.isFinite(Number(previous[card.id]))) card.count = Number(previous[card.id]);
  }
  resourceTrackers.previous = {};
  broadcastResourceTrackers();
  return true;
}

function resourceTrackerScan(line) {
  if (LOGIN_PATTERN.test(line)) {
    const now = Date.now();
    if (now - lastLoginSeenMs > LOGIN_DEBOUNCE_MS) {
      lastLoginSeenMs = now;
      resourceTrackers.lastLoginAt = new Date().toISOString();
      resetResourceSession('palia-login');
    }
    return false;
  }
  const eventMatch = line.match(EVENT_LINE_PATTERN);
  if (!eventMatch) return false;
  const source = eventMatch[1].toLowerCase();
  const direction = eventMatch[2].toLowerCase();
  const sign = direction === 'lost' ? -1 : 1;

  // Pull every token on the line together with whether it carried the (1*)
  // star-quality flag, same method weeklyScan uses - needed for cards like
  // Sashimi that only care about star-quality catches (starOnly: true).
  const found = [];
  const TOKEN_WITH_STAR = /(itemtype_[a-z0-9_]+)(\s*\(([0-9]+)\*\))?/gi;
  let starMatch;
  while ((starMatch = TOKEN_WITH_STAR.exec(line)) !== null) {
    found.push({ token: starMatch[1].toLowerCase(), star: Boolean(starMatch[2]) });
  }

  let changed = false;
  for (const card of resourceTrackers.cards) {
    // Lifetime cards mirror live.resources; the existing reader already owns
    // those numbers. Counting them here too would double them.
    if (card.mode === 'lifetime' && LIFETIME_SOURCE[card.id]) continue;
    // Countdown cards (Fish Stew, Sashimi) only move on their one declared
    // direction - e.g. only "lost" (fish consumed cooking), never "gained"
    // (fish caught). Without this, catching more Eldershark would wrongly
    // refill the count.
    if (card.direction && card.direction !== direction) continue;
    // Opt-in per-card source filter (added 2026-09-17 for the fishing-catch
    // trackers). EVENT_LINE_PATTERN treats "Inventory" and "Lockbox" lines as
    // equally real per the house rule table, but reading Baby's own logs
    // showed Eldershark's "Lockbox gained/lost" lines are actually periodic
    // full-lockbox-content dumps (a giant line mixing dozens of unrelated
    // decor items with a fish count that repeats the exact same value many
    // times in a row, e.g. "x61" eighteen times identically on 2026-09-16) -
    // the same "resync mistaken for a delta" bug shape as old Sashimi/Fish
    // Stew, just on Lockbox instead of Primary. A card can set
    // 'eventSource': 'inventory' to only count real "Inventory gained/lost"
    // lines and ignore Lockbox entirely. Omitted (the default for every
    // existing card) means "either source", unchanged from before.
    if (card.eventSource && card.eventSource !== source) continue;
    for (const token of card.tokens || []) {
      const qty = quantityFor(line, token);
      if (!qty) continue;
      if (card.starOnly) {
        const hit = found.find(f => f.token === token.toLowerCase());
        if (!hit || !hit.star) continue;
      }
      // 'countEvents' counts one PER LOG LINE regardless of the stack size on
      // it - same meaning as the secondary-count flag below. Sashimi uses
      // this (redone 2026-09-06): a real cook produces a batch of 3 Sashimi
      // in one 'Inventory gained: itemtype_c_sashimi (1*) x3' line, but Baby
      // wants the countdown to drop by 1 per cook, not by 3.
      const amount = card.countEvents ? 1 : qty;
      // 'countdown' mode always SUBTRACTS on a qualifying, direction-filtered
      // match, regardless of the log line's natural gained(+)/lost(-) sign -
      // "countdown" means "this pool shrinks when its one watched event
      // fires," and which event that is is entirely decided by `direction`
      // above. (Fish Stew/the old Sashimi design used direction:"lost", where
      // the natural sign was already -1, so this was previously invisible;
      // the new Sashimi design watches a "gained" line instead and still
      // needs to count DOWN, which is why this is now explicit rather than
      // riding on the sign.)
      if (card.mode === 'countdown') {
        card.count = Math.max(0, card.count - amount);
      } else {
        card.count = Math.max(0, card.count + (sign * amount));
      }
      changed = true;
    }
  }

  // A card's optional secondary count (e.g. Ramen Plush's "Ramen Cooked" count
  // riding alongside its Plushies count) is scanned independently of the
  // primary loop above - it has its own tokens and its own direction filter,
  // and is never affected by the primary card's `direction`/`starOnly` rules.
  for (const card of resourceTrackers.cards) {
    if (!card.secondary) continue;
    const wantDirection = card.secondary.direction;
    if (wantDirection && wantDirection !== direction) continue;
    for (const token of card.secondary.tokens || []) {
      const qty = quantityFor(line, token);
      if (!qty) continue;
      // 'countEvents' counts one PER LOG LINE regardless of the stack size on
      // it - e.g. cooking once hands Baby a batch of 3 Ramen in a single
      // "Inventory gained ... x3" line, but she wants "Ramen Cooked" to count
      // cooking actions (1), not items produced (3). Without this flag a
      // secondary count instead sums the real quantity, same as every
      // primary card count does.
      const amount = card.secondary.countEvents ? 1 : qty;
      card.secondaryCount = Math.max(0, (card.secondaryCount || 0) + (sign * amount));
      changed = true;
    }
  }

  // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) track
  // several independent materials on one card, each with its own tokens and
  // its own spot on the art - scanned the same way the primary loop above
  // scans a normal card's tokens, just once per slot instead of once per
  // card. Default is net gained-minus-lost (no direction filter), same as
  // Queen Ushindi - but a card can set a top-level `direction` (reusing the
  // same field an ordinary card uses) to restrict EVERY slot on it to only
  // that one direction. Long Tracker uses `direction: "gained"` so all five
  // materials (including Bugs) are a lifetime "total ever gained" that never
  // decrements when something is lost/sold/turned in, per Baby's choice.
  for (const card of resourceTrackers.cards) {
    if (!Array.isArray(card.slots)) continue;
    if (card.direction && card.direction !== direction) continue;
    if (card.eventSource && card.eventSource !== source) continue; // 2026-10-01, Pumpkin Rockhopper
    for (const slot of card.slots) {
      let qty = 0;
      for (const token of slot.tokens || []) qty += quantityFor(line, token);
      if (slot.tokenPrefix) qty += quantityForPrefix(line, slot.tokenPrefix);
      if (!qty) continue;
      slot.count = Math.max(0, (slot.count || 0) + (sign * qty));
      changed = true;
    }
  }
  return changed;
}

function findResourceCard(id) {
  return resourceTrackers.cards.find(c => c.id === id) || null;
}

function renderCollectionCardPage(card, query) {
  // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) have
  // several independent blank boxes baked into one piece of art, each over
  // its own material icon - so instead of one #box/#n pair like every other
  // card, this renders one pair per slot, each positioned at that slot's own
  // valueBox and polling the same /api/resource-trackers response.
  const width = Math.max(120, Number(query.get('w')) || 620);
  const slots = card.slots || [];
  const boxDivs = slots.map(slot => {
    const box = slot.valueBox || { left: 10, top: 70, width: 20, height: 15 };
    return `<div class="box" style="left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%">` +
      `<div class="inner" id="inner-${escapeHtml(slot.id)}"><span id="n-${escapeHtml(slot.id)}">${slot.count || 0}</span></div></div>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(card.name)}</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #wrap{position:relative;width:${width}px}
  #wrap img{width:100%;display:block}
  .box{position:absolute;display:table;table-layout:fixed}
  .inner{display:table-cell;vertical-align:middle;text-align:center;white-space:nowrap;
     font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;font-weight:bold;color:#ffffff;
     line-height:1.05;
     text-shadow:0 0 12px rgba(255,225,150,.85),0 0 30px rgba(255,170,60,.55),0 2px 5px rgba(0,0,0,.85)}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/${encodeURIComponent(card.image)}" alt="${escapeHtml(card.name)}">
  ${boxDivs}
</div>
<script>
(function(){
  var slotIds = ${JSON.stringify(slots.map(s => s.id))};
  function group(v){
    var s = String(v), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out; c++;
      if (c % 3 === 0 && i > 0) { out = ',' + out; }
    }
    return out;
  }
  function size(){
    for (var i = 0; i < slotIds.length; i++) {
      var inner = document.getElementById('inner-' + slotIds[i]);
      var box = inner.parentNode;
      var h = box.offsetHeight;
      var w = box.offsetWidth;
      if (h <= 0) { continue; }
      var fontPx = Math.round(h * 0.60);
      inner.style.fontSize = fontPx + 'px';
      // Width-aware shrink on top of the height-based size above: a slot
      // showing a large comma-formatted number (some cards, e.g. Ore vs
      // Kitsuu, are lifetime counters meant to reach the millions) can be
      // wider than its box even at a height-appropriate font size, especially
      // on a narrow box - keep shrinking until it actually fits, with a small
      // floor so it never disappears. scrollWidth/offsetWidth are old,
      // ES5-safe DOM properties, fine for Meld's embedded browser.
      var guard = 0;
      while (inner.scrollWidth > w && fontPx > 8 && guard < 60) {
        fontPx -= 1;
        inner.style.fontSize = fontPx + 'px';
        guard += 1;
      }
    }
  }
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/resource-trackers?src=${encodeURIComponent(card.id)}&_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var list = (d.resourceTrackers && d.resourceTrackers.cards) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === ${JSON.stringify(card.id)}) {
            var slots = list[i].slots || [];
            for (var j = 0; j < slots.length; j++) {
              var el = document.getElementById('n-' + slots[j].id);
              if (el) { el.innerHTML = group(slots[j].count || 0); }
            }
            size();
            return;
          }
        }
      } catch (e) { }
    };
    x.send();
  }
  window.onload = size;
  size(); poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

function renderResourceCardPage(card, query) {
  if (Array.isArray(card.slots)) return renderCollectionCardPage(card, query);
  const width = Math.max(120, Number(query.get('w')) || 620);
  const box = card.valueBox || { left: 30, top: 45, width: 55, height: 30 };
  const hasSecondary = Boolean(card.secondary);
  // Cards with a 'secondary' count (e.g. Ramen Plush) show BOTH numbers as
  // text in the one existing blank box - "<cooked> Ramen Cooked VS <count>
  // Plushies" - instead of a bare number. Two independently-updated spans so
  // each number keeps its own thousands-separator grouping.
  const innerMarkup = hasSecondary
    ? `<span id="c1">${card.secondaryCount || 0}</span> ${escapeHtml(card.secondary.label || 'Cooked')}` +
      ` <span class="vs">VS</span> <span id="n">${card.count}</span> ${escapeHtml(card.secondary.primaryLabel || card.name)}`
    : `<span id="n">${card.count}</span>`;
  // The pattern proven to render in Meld: image in the static HTML, plain ES5,
  // an XHR poll that only rewrites the number. Do not modernise this.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(card.name)}</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #wrap{position:relative;width:${width}px}
  #wrap img{width:100%;display:block}
  #box{position:absolute;left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%;
       display:table;table-layout:fixed}
  #inner{display:table-cell;vertical-align:middle;text-align:center;white-space:nowrap}
  #inner{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;font-weight:bold;color:#ffffff;
     font-size:${Math.round(width * (hasSecondary ? 0.05 : 0.09))}px;line-height:1.05;
     text-shadow:0 0 16px rgba(255,225,150,.85),0 0 40px rgba(255,170,60,.55),0 3px 6px rgba(0,0,0,.85)}
  .vs{font-size:.62em;opacity:.85;padding:0 .3em}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/${encodeURIComponent(card.image)}" alt="${escapeHtml(card.name)}">
  <div id="box"><div id="inner">${innerMarkup}</div></div>
</div>
<script>
(function(){
  var hasSecondary = ${hasSecondary ? 'true' : 'false'};
  var box = document.getElementById('box');
  var inner = document.getElementById('inner');
  var n = document.getElementById('n');
  var c1 = hasSecondary ? document.getElementById('c1') : null;
  function group(v){
    var s = String(v), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out; c++;
      if (c % 3 === 0 && i > 0) { out = ',' + out; }
    }
    return out;
  }
  function size(){
    var h = box.offsetHeight;
    if (h <= 0) { return; }
    var fs = Math.round(h * (hasSecondary ? 0.42 : 0.70));
    inner.style.fontSize = fs + 'px';
    if (hasSecondary) {
      // The combined text is width-sensitive too (it's a sentence, not a
      // single number) - shrink until it actually fits the box.
      var w = box.offsetWidth;
      var guard = 0;
      while (inner.scrollWidth > w && fs > 8 && guard < 60) {
        fs -= 1;
        inner.style.fontSize = fs + 'px';
        guard++;
      }
    }
  }
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/resource-trackers?src=${encodeURIComponent(card.id)}&_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var list = (d.resourceTrackers && d.resourceTrackers.cards) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === ${JSON.stringify(card.id)}) {
            n.innerHTML = group(list[i].count || 0);
            if (c1) { c1.innerHTML = group(list[i].secondaryCount || 0); }
            size();
            return;
          }
        }
      } catch (e) { }
    };
    x.send();
  }
  window.onload = size;
  size(); poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

// The ijustababyTV unicorn banner (2026-08-25). Native art is 1672x941 with an empty glass
// "readout" panel built into the frame - measured by eye with a pixel grid overlaid on the art
// (same method as every other frame skin in this project): the safe text-scrolling rectangle is
// left 258px, top 524px, width 1150px, height 122px of the 1672x941 original, i.e. as percentages
// left 15.43%, top 55.68%, width 68.78%, height 12.97%. Re-measure if the art is ever regenerated.
const TICKER_ART_FILE = 'TICKER_BANNER.png';
const TICKER_BOX = { left: 15.43, top: 55.68, width: 68.78, height: 12.97 };

function renderTickerPage(query) {
  const width = Math.max(300, Math.min(2400, Number(query.get('w')) || 900));
  const height = Math.round(width * (941 / 1672));
  const boxLeftPx = Math.round(width * (TICKER_BOX.left / 100));
  const boxTopPx = Math.round(height * (TICKER_BOX.top / 100));
  const boxWidthPx = Math.round(width * (TICKER_BOX.width / 100));
  const boxHeightPx = Math.round(height * (TICKER_BOX.height / 100));
  const fontSize = Math.round(boxHeightPx * 0.5);
  const tickerSettings = settings.ticker || {};
  const rawText = cleanString(tickerSettings.text, 'Welcome to ijustababyTv');
  const initialText = escapeHtml(rawText);
  const initialSpeed = Number.isFinite(Number(tickerSettings.speed)) ? Number(tickerSettings.speed) : 90;
  const initialPause = Number.isFinite(Number(tickerSettings.pause)) ? Number(tickerSettings.pause) : 1;
  // Plain ES5 only, XHR poll, image in the static HTML - same rules as every other Meld overlay
  // page in this project (see icb-master-handbook.md, "The overlay pattern that works in Meld").
  // 2026-08-28: switched from a continuous two-copy scroll to a single pass at a time, per Baby's
  // request - only one copy of the text exists, it travels once from fully off the right edge to
  // fully off the left edge, waits `pause` seconds with the panel empty, then goes again. Speed
  // and pause are both live-adjustable from the dashboard (see /api/ticker) and take effect on the
  // very next pass without a page reload.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ijustababyTV ticker</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #wrap{position:relative;width:${width}px;height:${height}px}
  #wrap img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  #box{position:absolute;left:${boxLeftPx}px;top:${boxTopPx}px;width:${boxWidthPx}px;height:${boxHeightPx}px;
       overflow:hidden}
  #tk{position:absolute;top:0;left:0;white-space:nowrap;opacity:0;
      font-family:"Baloo 2","Comic Sans MS","Trebuchet MS",sans-serif;font-weight:bold;color:#fff8ff;
      font-size:${fontSize}px;line-height:${boxHeightPx}px;
      text-shadow:0 0 10px rgba(255,255,255,.85),0 0 22px rgba(210,140,255,.75),0 2px 4px rgba(40,0,60,.6)}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/${encodeURIComponent(TICKER_ART_FILE)}" alt="ijustababyTV">
  <div id="box"><span id="tk">${initialText}</span></div>
</div>
<script>
(function(){
  var box = document.getElementById('box');
  var span = document.getElementById('tk');
  var lastText = ${JSON.stringify(rawText)};
  var speed = ${JSON.stringify(initialSpeed)};
  var pauseMs = ${JSON.stringify(initialPause)} * 1000;
  var timer = null;
  function pass(){
    if (timer) { clearTimeout(timer); timer = null; }
    var boxWidth = box.offsetWidth;
    var textWidth = span.offsetWidth;
    var distance = boxWidth + textWidth;
    var duration = Math.max(0.5, distance / speed);
    span.style.transition = 'none';
    span.style.transform = 'translateX(' + boxWidth + 'px)';
    span.style.opacity = '1';
    // Force a reflow so the browser applies the reset position before the transition below
    // starts, or it animates from the OLD position instead of the fresh one on the right.
    void span.offsetWidth;
    span.style.transition = 'transform ' + duration + 's linear';
    span.style.transform = 'translateX(-' + textWidth + 'px)';
    timer = setTimeout(pass, duration * 1000 + pauseMs);
  }
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/settings?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var t = (d.settings && d.settings.ticker) || {};
        var changed = false;
        if (typeof t.text === 'string' && t.text && t.text !== lastText) { lastText = t.text; span.textContent = t.text; changed = true; }
        if (typeof t.speed === 'number' && t.speed !== speed) { speed = t.speed; changed = true; }
        if (typeof t.pause === 'number' && t.pause * 1000 !== pauseMs) { pauseMs = t.pause * 1000; changed = true; }
        if (changed) { pass(); }
      } catch (e) { }
    };
    x.send();
  }
  pass();
  poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

function serveResourceArt(res, pathname) {
  let name;
  try {
    name = path.basename(decodeURIComponent(pathname.slice('/resource-art/'.length)));
  } catch (_error) {
    return sendJson(res, 400, { ok: false, error: 'Invalid art name.' });
  }
  const file = path.join(RESOURCE_ART_DIR, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}

// ---------------------------------------------------------------------------
// WEEKLY ACCOMPLISHMENTS
//
// A fixed checklist that is the same every week, ticked off as Baby completes
// things, wiped at Palia's weekly reset.
//
// WHAT CAN AND CANNOT BE AUTOMATIC — established by reading 30 of Baby's real
// logs on 2026-08-19, do not re-litigate:
//   * Anything measured by ITEMS ARRIVING IN HER BAG is automatic — the
//     Inventory/Lockbox "gained" lines are dense and reliable across every log.
//   * Anything measured by AN ACTIVITY HAPPENING is not. The log never names or
//     counts another player - zero hits for party/teammate/group across every
//     file - so every "with Friends" item is manual, permanently.
//   * Quests are invisible. `WeeklyWantsUpdatedEvent fired` is the entire line;
//     it never says which want or whether it completed.
//
// The week rolls over MONDAY 04:00 UTC (Palia's own reset). Anchored to UTC so
// daylight saving cannot drift it by an hour twice a year.
// ---------------------------------------------------------------------------
const WEEKLY_CONFIG_FILE = path.join(APP_DIR, 'config', 'weekly-accomplishments.json');
const WEEKLY_STATE_FILE = path.join(DATA_DIR, 'weekly-accomplishments.json');

function weeklyConfig() {
  return JSON.parse(fs.readFileSync(WEEKLY_CONFIG_FILE, 'utf8'));
}

// The start of the week that `at` falls inside, as an ISO string.
function weekStartFor(at, cfg) {
  const weekday = Number(cfg.weekStartsUtc?.weekday ?? 1); // 1 = Monday
  const hour = Number(cfg.weekStartsUtc?.hour ?? 4);
  const d = new Date(at);
  const back = (d.getUTCDay() - weekday + 7) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, hour, 0, 0, 0));
  if (start.getTime() > d.getTime()) start.setUTCDate(start.getUTCDate() - 7);
  return start.toISOString();
}

function loadWeekly() {
  const cfg = weeklyConfig();
  let saved = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(WEEKLY_STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch (_error) { /* first run */ }
  const progress = saved.progress || {};
  return {
    schemaVersion: 1,
    weekStart: saved.weekStart || weekStartFor(new Date(), cfg),
    // Config owns the checklist, state owns the ticks.
    items: (cfg.items || []).map(def => ({
      ...def,
      count: Number(progress[def.id]?.count) || 0,
      done: Boolean(progress[def.id]?.done),
    })),
    previous: saved.previous || null,
    lastResetAt: saved.lastResetAt || null,
    updatedAt: saved.updatedAt || null,
  };
}

let weekly = loadWeekly();

function weeklyView() {
  const view = clone(weekly);
  const cfg = weeklyConfig();
  view.items = view.items.map(item => ({
    ...item,
    // A collect item is done when it reaches its target; a manual one when
    // Baby says so.
    done: item.type === 'manual' ? Boolean(item.done) : (item.count >= Number(item.target || 1)),
  }));
  view.total = view.items.length;
  view.completed = view.items.filter(i => i.done).length;
  view.nextResetAt = new Date(new Date(view.weekStart).getTime() + (7 * 24 * 3600 * 1000)).toISOString();
  view.canUndoReset = Boolean(view.previous);
  view.weekStartsUtc = cfg.weekStartsUtc;
  return view;
}

function saveWeekly() {
  weekly.updatedAt = new Date().toISOString();
  const progress = {};
  for (const item of weekly.items) progress[item.id] = { count: item.count, done: Boolean(item.done) };
  writeJson(WEEKLY_STATE_FILE, {
    schemaVersion: 1,
    weekStart: weekly.weekStart,
    progress,
    previous: weekly.previous,
    lastResetAt: weekly.lastResetAt,
    updatedAt: weekly.updatedAt,
  });
}
try { saveWeekly(); } catch (_error) { /* non-fatal */ }

function broadcastWeekly() {
  saveWeekly();
  broadcast('weekly', weeklyView());
}

// Called on a timer as well as on log activity, so a rollover still happens on
// a quiet night. If the server was off across the boundary it catches up on the
// next start rather than skipping the week.
function rolloverWeeklyIfDue() {
  const cfg = weeklyConfig();
  const current = weekStartFor(new Date(), cfg);
  if (current === weekly.weekStart) return false;
  weekly.previous = {
    weekStart: weekly.weekStart,
    progress: weekly.items.map(i => ({ id: i.id, count: i.count, done: Boolean(i.done) })),
  };
  for (const item of weekly.items) { item.count = 0; item.done = false; }
  weekly.weekStart = current;
  weekly.lastResetAt = new Date().toISOString();
  broadcastWeekly();
  return true;
}

function undoWeeklyReset() {
  const prev = weekly.previous;
  if (!prev) return false;
  for (const saved of prev.progress || []) {
    const item = weekly.items.find(i => i.id === saved.id);
    if (item) { item.count = Number(saved.count) || 0; item.done = Boolean(saved.done); }
  }
  weekly.weekStart = prev.weekStart;
  weekly.previous = null;
  broadcastWeekly();
  return true;
}

function weeklyScan(line) {
  const eventMatch = line.match(EVENT_LINE_PATTERN);
  if (!eventMatch) return false;
  const direction = eventMatch[2].toLowerCase();

  // Pull every token on the line together with whether it carried the (1*)
  // star-quality flag. (1*) is confirmed to be the star marker: only 4.6% of
  // pickups carry it and 65 items appear in the logs both with and without.
  const found = [];
  const TOKEN_WITH_STAR = /(itemtype_[a-z0-9_]+)(\s*\(([0-9]+)\*\))?/gi;
  let m;
  while ((m = TOKEN_WITH_STAR.exec(line)) !== null) {
    found.push({ token: m[1].toLowerCase(), star: Boolean(m[2]) });
  }
  if (!found.length) return false;

  let changed = false;
  for (const item of weekly.items) {
    if (item.type !== 'collect') continue;
    const target = Number(item.target || 1);
    if (item.count >= target) continue;
    if ((item.direction || 'gained') !== direction) continue;

    const pattern = item.tokenPattern ? new RegExp(item.tokenPattern, 'i') : null;
    const exact = new Set((item.tokens || []).map(t => t.toLowerCase()));
    const matches = found.filter(f =>
      (item.starOnly ? f.star : true) && ((pattern && pattern.test(f.token)) || exact.has(f.token)));
    if (!matches.length) continue;

    if (item.mode === 'events') {
      // One felled tree is ONE line carrying 14-22 wood; one kill is one line
      // carrying meat and a hide. Counting quantities would wildly overcount
      // "chop 10 trees", so a whole line counts once.
      item.count += 1;
      changed = true;
    } else {
      for (const match of matches) {
        const qty = quantityFor(line, match.token);
        if (qty > 0) { item.count += qty; changed = true; }
      }
    }
  }
  return changed;
}

function findWeeklyItem(id) {
  return weekly.items.find(i => i.id === id) || null;
}

function renderWeeklyPage(query) {
  const view = weeklyView();
  // Skin: assets/resources/tall.png, native 1024x1536 (2:3, "Path of the
  // Briar" frame). v2 of this art dropped the divider lines and the corner
  // emblem - just a title-bar cutout up top and open sky/vines below, which
  // is what lets the checklist run at a readable size. Width drives
  // everything; height always follows at width*1.5 so the frame is never
  // stretched or squashed.
  const width = Math.max(320, Number(query.get('w')) || 580);
  const cols = Math.max(1, Math.min(3, Number(query.get('cols')) || 2));
  const height = Math.round(width * 1.5);
  // Type must scale with the COLUMN, not the whole widget, or a two-column
  // layout renders everything at double size.
  const unit = width / cols;

  // Boxes measured directly off tall.png at its native 1024x1536 (see
  // claude/icb-essence-checklist-skin.md in the project for how / re-measure
  // if the art is ever re-exported). BAR_BOX has no carved slot in this art -
  // it's placed in the open sky just under the title card.
  const TITLE_BOX = { left: 20.02, top: 2.6, width: 63.48, height: 8.79 };
  const BAR_BOX = { left: 6.84, top: 12.7, width: 86.43, height: 2.6 };
  const CONTENT_BOX = { left: 6.35, top: 16.28, width: 87.4, height: 63.15 };
  // cols=1 was tried and silently clipped the last 4 groups (overflow:
  // hidden ate them with no visual warning) - cols=2 is the minimum safe
  // default for all 24 items / 9 groups at this font size. Verified by
  // rendering against real config + data and screenshotting before shipping.

  // Group the checklist the way Baby's in-game list is grouped. Without the
  // headings, 24 lines is an unreadable wall.
  const groups = [];
  for (const item of view.items) {
    const name = item.group || '';
    let g = groups.find(x => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(item);
  }

  const rowHtml = item => {
    const detail = item.type === 'manual' ? ''
      : ` <span class="c">${item.count}/${Number(item.target || 1)}</span>`;
    return `      <tr class="${item.done ? 'done' : ''}" id="r_${escapeHtml(item.id)}">
        <td class="bx">${item.done ? '&#10003;' : '&#9633;'}</td>
        <td class="lb">${escapeHtml(item.label)}${detail}</td>
      </tr>`;
  };

  const body = groups.map(g => `  <div class="grp">
    ${g.name ? `<div class="gh">${escapeHtml(g.name)}</div>` : ''}
    <table><tbody>
${g.items.map(rowHtml).join('\n')}
    </tbody></table>
  </div>`).join('\n');

  const pct = view.total ? Math.round((view.completed / view.total) * 100) : 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Weekly Accomplishments</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;
            font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif}
  #wrap{position:relative;width:${width}px;height:${height}px}
  #wrap img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  #title{position:absolute;left:${TITLE_BOX.left}%;top:${TITLE_BOX.top}%;
         width:${TITLE_BOX.width}%;height:${TITLE_BOX.height}%;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         text-align:center;color:#ffe9c2;
         text-shadow:0 0 12px rgba(255,210,140,.75),0 2px 4px rgba(0,0,0,.9)}
  #title .t1{font-weight:bold;letter-spacing:.03em;line-height:1.1;
             font-size:${Math.round(width * 0.044)}px}
  #title .t2{margin-top:3px;color:#ffd166;font-size:${Math.round(width * 0.03)}px}
  #barbox{position:absolute;left:${BAR_BOX.left}%;top:${BAR_BOX.top}%;
          width:${BAR_BOX.width}%;height:${BAR_BOX.height}%;display:flex;align-items:center}
  #barout{width:100%;height:44%;border-radius:4px;background:rgba(255,255,255,.18);
          border:1px solid rgba(255,209,102,.4)}
  #barin{height:100%;border-radius:4px;background:#ffd166;width:${pct}%;
         box-shadow:0 0 10px rgba(255,209,102,.9)}
  #content{position:absolute;left:${CONTENT_BOX.left}%;top:${CONTENT_BOX.top}%;
           width:${CONTENT_BOX.width}%;height:${CONTENT_BOX.height}%;overflow:hidden}
  #cols{column-count:${cols};column-gap:20px;height:100%}
  .grp{break-inside:avoid;page-break-inside:avoid;margin-bottom:11px}
  .gh{color:#ffd166;font-size:${Math.round(unit * 0.056)}px;font-weight:bold;
      letter-spacing:.03em;text-transform:uppercase;margin-bottom:3px;
      text-shadow:0 2px 4px rgba(0,0,0,.95)}
  table{border-collapse:collapse;width:100%}
  td{padding:2px 0;vertical-align:top}
  td.bx{width:1.3em;color:#8df0ae;font-weight:bold;text-align:center;
        font-size:${Math.round(unit * 0.058)}px;text-shadow:0 2px 4px rgba(0,0,0,.95)}
  td.lb{color:#fff;font-size:${Math.round(unit * 0.058)}px;line-height:1.28;
        text-shadow:0 2px 4px rgba(0,0,0,.95)}
  .c{color:#ffe08a;font-weight:bold}
  /* Completed items stay on screen, struck through, so the week fills up visibly. */
  tr.done td.lb{text-decoration:line-through;opacity:.55}
  tr.done td.bx{color:#8df0ae}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/tall.png" alt="">
  <div id="title">
    <div class="t1">WEEKLY ACCOMPLISHMENTS</div>
    <div class="t2" id="pg">${view.completed} / ${view.total}</div>
  </div>
  <div id="barbox"><div id="barout"><div id="barin"></div></div></div>
  <div id="content"><div id="cols">
${body}
  </div></div>
</div>
<script>
/* Plain ES5. The checklist above is already rendered by the server, so if this
   script never runs Baby still gets the list - just frozen. */
(function(){
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/weekly?src=weekly&_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4 || x.status !== 200) { return; }
      var d;
      try { d = JSON.parse(x.responseText); } catch (e) { return; }
      var w = d.weekly; if (!w) { return; }
      document.getElementById('pg').innerHTML = w.completed + ' / ' + w.total;
      var pct = w.total ? Math.round(w.completed * 100 / w.total) : 0;
      document.getElementById('barin').style.width = pct + '%';
      for (var i = 0; i < w.items.length; i++) {
        var it = w.items[i];
        var row = document.getElementById('r_' + it.id);
        if (!row) { continue; }
        row.className = it.done ? 'done' : '';
        row.cells[0].innerHTML = it.done ? '✓' : '□';
        var label = it.label;
        if (it.type !== 'manual') {
          label += ' <span class="c">' + it.count + '/' + (it.target || 1) + '</span>';
        }
        row.cells[1].innerHTML = label;
      }
    };
    x.send();
  }
  poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// PLUSHIE WHEEL (added 2026-09-03, simplified 2026-09-03) — a live on-stream
// prize wheel Baby spins during plushie trades. Originally built as a
// three-pool trade-up game with whammies; Baby asked to simplify it down to
// a single pool: every plushie in the catalog is eligible, only 30 boxes
// are ever shown on the board at once, and Baby manually asks each viewer
// whether they want the board reshuffled before she spins for them. Kept
// the route prefix (/api/tradeup/*) and filenames (tradeup-board.html,
// tradeup-control.html) from the original build so an already-added Meld
// browser source URL keeps working - only the on-page wording changed.
//
// Per-turn state is intentionally in-memory only (board/revealed/spinSeq) -
// Baby does not need this to remember anything between spins or across a
// server restart. The catalog (config/tradeup-game.json) DOES persist, so
// plushies she adds from the control page stick around.
// ---------------------------------------------------------------------------
const TRADEUP_CONFIG_FILE = path.join(APP_DIR, 'config', 'tradeup-game.json');
const TRADEUP_ART_DIR = path.join(APP_DIR, 'assets', 'tradeup');
fs.mkdirSync(TRADEUP_ART_DIR, { recursive: true });

// Board has 30 fixed physical positions traced clockwise starting top-left:
// top row (10) -> right column (5) -> bottom row (10, right-to-left) -> left
// column (5, bottom-to-top). Shuffling only changes which item sits in each
// position - the positions themselves never move, so the board page can
// travel a "marquee" highlight around this same loop order when spinning.
const TRADEUP_TOP = 10;
const TRADEUP_RIGHT = 5;
const TRADEUP_BOTTOM = 10;
const TRADEUP_LEFT = 5;
const TRADEUP_BOARD_SIZE = TRADEUP_TOP + TRADEUP_RIGHT + TRADEUP_BOTTOM + TRADEUP_LEFT;

const DEFAULT_TRADEUP_CONFIG = {
  schemaVersion: 2,
  items: [],
};

function loadTradeupConfig() {
  const raw = readJson(TRADEUP_CONFIG_FILE, DEFAULT_TRADEUP_CONFIG);
  const cfg = mergeDefaults(DEFAULT_TRADEUP_CONFIG, raw);
  if (!Array.isArray(cfg.items)) cfg.items = [];
  // Tolerate the old three-pool config shape (items each carried a `pools`
  // array, and there were top-level `pools`/`whammy` fields) - now that
  // there is only one pool, every item in the catalog is simply eligible,
  // so any leftover `pools` field on an item is ignored rather than needing
  // a migration step.
  return cfg;
}

function saveTradeupConfig(cfg) {
  writeJson(TRADEUP_CONFIG_FILE, cfg);
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Fills the fixed 30-position board by sampling from the full catalog
// (repeats allowed if the catalog is smaller than 30 - always better than
// an empty box), shuffled into the 30 fixed physical positions.
function tradeupDealBoard() {
  const cfg = loadTradeupConfig();
  const catalog = cfg.items;
  const boxes = [];
  for (let i = 0; i < TRADEUP_BOARD_SIZE; i += 1) {
    if (catalog.length === 0) {
      boxes.push({ kind: 'empty', item: null });
    } else {
      boxes.push({ kind: 'item', item: catalog[Math.floor(Math.random() * catalog.length)] });
    }
  }
  shuffleInPlace(boxes);
  return boxes.map((box, position) => ({ position, ...box }));
}

let tradeup = {
  board: [],
  revealed: null, // { position, kind, item }
  spinSeq: 0, // bumped on every spin so the board page only animates once per spin
  log: [],
};

function tradeupPushLog(message) {
  tradeup.log.unshift({ at: new Date().toISOString(), message });
  tradeup.log = tradeup.log.slice(0, 30);
}

function tradeupBroadcast() {
  broadcast('tradeup', tradeupPublicState());
}

function tradeupPublicState() {
  return {
    ok: true,
    board: tradeup.board,
    revealed: tradeup.revealed,
    spinSeq: tradeup.spinSeq,
    log: tradeup.log,
    boardLayout: { top: TRADEUP_TOP, right: TRADEUP_RIGHT, bottom: TRADEUP_BOTTOM, left: TRADEUP_LEFT },
    canShuffle: true,
    canSpin: tradeup.board.length > 0,
  };
}

function tradeupInit() {
  tradeup.board = tradeupDealBoard();
  tradeup.revealed = null;
  tradeupPushLog('Board dealt.');
}

function tradeupShuffle() {
  tradeup.board = tradeupDealBoard();
  tradeup.revealed = null;
  // Bump spinSeq even though nothing was "spun" - the board page's poll loop
  // uses spinSeq purely as a change marker to decide whether to touch the
  // DOM at all. Without this, shuffling right after a reveal leaves the old
  // lit box and center card stuck on screen, since the client sees the same
  // spinSeq it already rendered and assumes nothing changed.
  tradeup.spinSeq += 1;
  tradeupPushLog('Board shuffled - new 30 pulled from the catalog.');
}

function tradeupSpin() {
  if (!tradeup.board.length) throw new Error('Board is empty.');
  const position = Math.floor(Math.random() * tradeup.board.length);
  const box = tradeup.board[position];
  tradeup.revealed = { position, kind: box.kind, item: box.item };
  tradeup.spinSeq += 1;
  if (box.kind === 'item') {
    tradeupPushLog(`Landed on "${box.item.name}".`);
  } else {
    tradeupPushLog('Landed on an empty box - add plushies to the catalog.');
  }
}

function tradeupClearReveal() {
  tradeup.revealed = null;
  // Same reasoning as tradeupShuffle(): spinSeq is the board page's only
  // signal that state actually changed. Without bumping it here, "Clear
  // Result" silently does nothing on screen - the client's poll sees the
  // same spinSeq as the reveal it's already showing and assumes it's still
  // mid-animation toward it, so it never hides the center card or lit box.
  tradeup.spinSeq += 1;
  tradeupPushLog('Cleared the result.');
}

function tradeupSlug(name) {
  return String(name || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

// Accepts a data: URL (image/png, image/jpeg, image/webp, image/gif) and
// writes it into assets/tradeup/, returning the public /tradeup-art/ path.
function tradeupSaveImage(dataUrl, name) {
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Image must be a PNG, JPG, WEBP, or GIF.');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Image is too large (max 8MB).');
  const filename = `${tradeupSlug(name)}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(TRADEUP_ART_DIR, filename), buffer);
  return `/tradeup-art/${filename}`;
}

function serveTradeupArt(res, pathname) {
  let name;
  try {
    name = path.basename(decodeURIComponent(pathname.slice('/tradeup-art/'.length)));
  } catch (_error) {
    return sendJson(res, 400, { ok: false, error: 'Invalid art name.' });
  }
  const file = path.join(TRADEUP_ART_DIR, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}

async function handleTradeupApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/tradeup/state' && method === 'GET') {
      return sendJson(res, 200, tradeupPublicState());
    }

    if (pathname === '/api/tradeup/config' && method === 'GET') {
      return sendJson(res, 200, { ok: true, config: loadTradeupConfig() });
    }

    if (pathname === '/api/tradeup/items' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanString(body.name);
      if (!name) return sendJson(res, 400, { ok: false, error: 'name is required.' });
      const type = body.type === 'points' ? 'points' : 'plushie';
      const cfg = loadTradeupConfig();
      const item = {
        id: `item-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        name,
        type,
        image: null,
      };
      if (type === 'points') {
        const points = Math.trunc(Number(body.points));
        item.points = Number.isFinite(points) && points > 0 ? points : 0;
      }
      if (body.imageDataUrl) item.image = tradeupSaveImage(body.imageDataUrl, name);
      cfg.items.push(item);
      saveTradeupConfig(cfg);
      return sendJson(res, 200, { ok: true, item, config: cfg });
    }

    const deleteMatch = pathname.match(/^\/api\/tradeup\/items\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const cfg = loadTradeupConfig();
      const before = cfg.items.length;
      cfg.items = cfg.items.filter(item => item.id !== deleteMatch[1]);
      if (cfg.items.length === before) return sendJson(res, 404, { ok: false, error: 'Item not found.' });
      saveTradeupConfig(cfg);
      return sendJson(res, 200, { ok: true, config: cfg });
    }

    // Add or replace an existing item's image (or edit its name/points)
    // without deleting and re-adding it — lets Baby swap in rendered art for
    // a plushie already in the pool one at a time as she finishes each one.
    const updateMatch = pathname.match(/^\/api\/tradeup\/items\/([^/]+)$/);
    if (updateMatch && (method === 'PUT' || method === 'PATCH')) {
      const cfg = loadTradeupConfig();
      const item = cfg.items.find(it => it.id === updateMatch[1]);
      if (!item) return sendJson(res, 404, { ok: false, error: 'Item not found.' });
      const body = await readBody(req);
      if (body.name !== undefined) {
        const name = cleanString(body.name);
        if (!name) return sendJson(res, 400, { ok: false, error: 'name cannot be empty.' });
        item.name = name;
      }
      if (body.type !== undefined) item.type = body.type === 'points' ? 'points' : 'plushie';
      if (body.points !== undefined) {
        const points = Math.trunc(Number(body.points));
        item.points = Number.isFinite(points) && points > 0 ? points : 0;
      }
      if (body.imageDataUrl) item.image = tradeupSaveImage(body.imageDataUrl, item.name);
      saveTradeupConfig(cfg);
      return sendJson(res, 200, { ok: true, item, config: cfg });
    }

    if (pathname === '/api/tradeup/shuffle' && method === 'POST') {
      tradeupShuffle();
    } else if (pathname === '/api/tradeup/spin' && method === 'POST') {
      tradeupSpin();
    } else if (pathname === '/api/tradeup/clear' && method === 'POST') {
      tradeupClearReveal();
    } else {
      return sendJson(res, 404, { ok: false, error: 'Not found.' });
    }

    tradeupBroadcast();
    return sendJson(res, 200, tradeupPublicState());
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Request failed.' });
  }
}

tradeupInit();

// ---------------------------------------------------------------------------
// DECOR OVERLAYS (Baby, 2026-09-29) - seasonal screen decorations like
// falling leaves, controlled from their OWN dashboard (decor-control.html),
// kept completely separate from the trackers.
//
//  - Each effect is its own Meld layer at /decor/<id>.html (a plain path, no
//    query string - see the handbook note on Meld URLs).
//  - Baby's own art lives in assets/decor/<id>/ (PNG/JPG/WEBP/GIF). Anything
//    dropped in that folder, or uploaded from the dashboard, shows up as an
//    option. Unticked images are remembered in `off`, so new uploads start on.
//  - Settings + saved presets persist in data/decor.json.
//  - Removing art from the dashboard MOVES it to assets/decor/<id>/_removed/,
//    never deletes it.
// ---------------------------------------------------------------------------
const DECOR_FILE = path.join(DATA_DIR, 'decor.json');
const DECOR_ART_DIR = path.join(APP_DIR, 'assets', 'decor');
const DECOR_OVERLAY_PAGE = path.join(APP_DIR, 'decor-overlay.html');
const DECOR_IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const DECOR_TYPES = ['fall'];
// min, max, default for every slider on the dashboard.
const DECOR_LIMITS = {
  amount: [1, 200, 40],     // how many on screen at once
  speed: [0.2, 3, 1],       // fall speed multiplier
  size: [16, 300, 70],      // px (each one varies +/-25%)
  opacity: [0.1, 1, 0.9],   // see-through
  drift: [-3, 3, 0.4],      // wind: negative blows left, positive right
  sway: [0, 2, 1],          // side-to-side flutter
  spin: [0, 2, 1],          // how much they twirl
};

function decorDefaults() {
  return { rev: 1, effects: [decorNewEffect('leaves', 'Falling leaves')], presets: [] };
}

function decorNewEffect(id, name) {
  const e = { id, name, type: 'fall', enabled: false, off: [] };
  for (const [k, lim] of Object.entries(DECOR_LIMITS)) e[k] = lim[2];
  return e;
}

function decorClamp(key, value, fallback) {
  const lim = DECOR_LIMITS[key];
  const n = Number(value);
  if (!lim || !Number.isFinite(n)) return fallback;
  return Math.min(lim[1], Math.max(lim[0], n));
}

function decorCleanEffect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = tradeupSlug(raw.id || raw.name || '');
  if (!id || id === 'item') return null;
  const e = decorNewEffect(id, cleanString(raw.name) || id);
  e.type = DECOR_TYPES.includes(raw.type) ? raw.type : 'fall';
  e.enabled = raw.enabled === true;
  e.off = Array.isArray(raw.off) ? raw.off.map(f => path.basename(String(f))).filter(f => DECOR_IMAGE_EXT.test(f)).slice(0, 500) : [];
  for (const k of Object.keys(DECOR_LIMITS)) e[k] = decorClamp(k, raw[k], e[k]);
  return e;
}

function loadDecor() {
  const raw = readJson(DECOR_FILE, null);
  if (!raw || !Array.isArray(raw.effects)) return decorDefaults();
  const effects = raw.effects.map(decorCleanEffect).filter(Boolean);
  const presets = Array.isArray(raw.presets) ? raw.presets.filter(p => p && p.id && p.name && p.effects) : [];
  return { rev: Number(raw.rev) || 1, effects: effects.length ? effects : decorDefaults().effects, presets };
}

let decor = loadDecor();
for (const e of decor.effects) { try { fs.mkdirSync(path.join(DECOR_ART_DIR, e.id), { recursive: true }); } catch (_error) {} }

function decorFiles(id) {
  try {
    return fs.readdirSync(path.join(DECOR_ART_DIR, id)).filter(f => DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b));
  } catch (_error) {
    return [];
  }
}

function decorPublicState() {
  return {
    ok: true,
    rev: decor.rev,
    limits: DECOR_LIMITS,
    effects: decor.effects.map(e => {
      const files = decorFiles(e.id);
      return { ...e, files, images: files.filter(f => !e.off.includes(f)).map(f => `/decor-art/${e.id}/${encodeURIComponent(f)}`) };
    }),
    presets: decor.presets.map(p => ({ id: p.id, name: p.name, savedAt: p.savedAt })),
  };
}

function saveDecor() {
  decor.rev += 1;
  writeJson(DECOR_FILE, { rev: decor.rev, effects: decor.effects, presets: decor.presets });
  broadcast('decor', decorPublicState());
}

function decorFind(id) {
  return decor.effects.find(e => e.id === id) || null;
}

function serveDecorArt(res, pathname) {
  let parts;
  try { parts = decodeURIComponent(pathname.slice('/decor-art/'.length)).split('/'); } catch (_error) { return sendJson(res, 400, { ok: false, error: 'Invalid art path.' }); }
  if (parts.length !== 2) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  const id = tradeupSlug(parts[0]), name = path.basename(parts[1]);
  if (!DECOR_IMAGE_EXT.test(name)) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  const file = path.join(DECOR_ART_DIR, id, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}

function serveDecorOverlay(res) {
  if (!fs.existsSync(DECOR_OVERLAY_PAGE)) return sendJson(res, 404, { ok: false, error: 'decor-overlay.html is missing.' });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
  return res.end(fs.readFileSync(DECOR_OVERLAY_PAGE));
}

async function handleDecorApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/decor/state' && method === 'GET') return sendJson(res, 200, decorPublicState());

    // New effect: { name } -> gets its own art folder and Meld URL.
    if (pathname === '/api/decor/effects' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanString(body.name).slice(0, 40);
      if (!name) return sendJson(res, 400, { ok: false, error: 'Give the effect a name.' });
      let id = tradeupSlug(name), n = 2;
      if (id === 'item') id = 'effect';
      while (decorFind(id)) id = `${tradeupSlug(name)}-${n++}`;
      const e = decorNewEffect(id, name);
      decor.effects.push(e);
      fs.mkdirSync(path.join(DECOR_ART_DIR, id), { recursive: true });
      saveDecor();
      return sendJson(res, 200, { ok: true, effect: e });
    }

    if (pathname === '/api/decor/all-off' && method === 'POST') {
      for (const e of decor.effects) e.enabled = false;
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }

    let m = /^\/api\/decor\/effects\/([a-z0-9-]+)$/.exec(pathname);
    if (m && (method === 'PATCH' || method === 'POST')) {
      const e = decorFind(m[1]);
      if (!e) return sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const body = await readBody(req);
      if (typeof body.name === 'string' && cleanString(body.name)) e.name = cleanString(body.name).slice(0, 40);
      if (typeof body.enabled === 'boolean') e.enabled = body.enabled;
      for (const k of Object.keys(DECOR_LIMITS)) if (body[k] !== undefined) e[k] = decorClamp(k, body[k], e[k]);
      if (Array.isArray(body.off)) e.off = body.off.map(f => path.basename(String(f))).filter(f => DECOR_IMAGE_EXT.test(f)).slice(0, 500);
      saveDecor();
      return sendJson(res, 200, { ok: true, effect: e });
    }
    if (m && method === 'DELETE') {
      const i = decor.effects.findIndex(e => e.id === m[1]);
      if (i < 0) return sendJson(res, 404, { ok: false, error: 'No such effect.' });
      decor.effects.splice(i, 1); // its art folder is left alone on disk
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }

    // Upload art: { dataUrl, name }
    m = /^\/api\/decor\/effects\/([a-z0-9-]+)\/images$/.exec(pathname);
    if (m && method === 'POST') {
      const e = decorFind(m[1]);
      if (!e) return sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const body = await readBody(req);
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = tradeupSlug(String(body.name || 'art').replace(/\.[a-z0-9]+$/i, ''));
      const dir = path.join(DECOR_ART_DIR, e.id);
      fs.mkdirSync(dir, { recursive: true });
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      saveDecor();
      return sendJson(res, 200, { ok: true, file: filename });
    }

    // Remove art: moved into _removed/, never deleted.
    m = /^\/api\/decor\/effects\/([a-z0-9-]+)\/images\/(.+)$/.exec(pathname);
    if (m && method === 'DELETE') {
      const e = decorFind(m[1]);
      if (!e) return sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const name = path.basename(decodeURIComponent(m[2]));
      const from = path.join(DECOR_ART_DIR, e.id, name);
      if (!DECOR_IMAGE_EXT.test(name) || !fs.existsSync(from)) return sendJson(res, 404, { ok: false, error: 'No such image.' });
      const bin = path.join(DECOR_ART_DIR, e.id, '_removed');
      fs.mkdirSync(bin, { recursive: true });
      fs.renameSync(from, path.join(bin, `${Date.now()}-${name}`));
      e.off = e.off.filter(f => f !== name);
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }

    // Presets: save the current settings of every effect under a name.
    if (pathname === '/api/decor/presets' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanString(body.name).slice(0, 40);
      if (!name) return sendJson(res, 400, { ok: false, error: 'Give the preset a name.' });
      const snapshot = {};
      for (const e of decor.effects) snapshot[e.id] = { ...e };
      const existing = decor.presets.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) { existing.effects = snapshot; existing.savedAt = new Date().toISOString(); }
      else decor.presets.push({ id: `p${Date.now()}`, name, effects: snapshot, savedAt: new Date().toISOString() });
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }
    m = /^\/api\/decor\/presets\/([a-z0-9]+)\/apply$/.exec(pathname);
    if (m && method === 'POST') {
      const p = decor.presets.find(x => x.id === m[1]);
      if (!p) return sendJson(res, 404, { ok: false, error: 'No such preset.' });
      for (const e of decor.effects) {
        const saved = p.effects[e.id];
        if (!saved) { e.enabled = false; continue; } // effect made after the preset: off
        const clean = decorCleanEffect({ ...saved, id: e.id, name: e.name });
        Object.assign(e, clean, { name: e.name });
      }
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }
    m = /^\/api\/decor\/presets\/([a-z0-9]+)$/.exec(pathname);
    if (m && method === 'DELETE') {
      decor.presets = decor.presets.filter(x => x.id !== m[1]);
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { ok: false, error: 'Unknown decor route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Decor request failed.' });
  }
}


// ---------------------------------------------------------------------------
// CONNECTION CHECK (Baby, 2026-09-30) - powers the "Connection check" card on
// ICB Home so she can see at a glance what is and isn't talking to ICB, and
// fix it without help. Everything here is in memory only (resets on restart).
//   - pages: every ICB page that calls /api/* or opens /events, keyed by the
//     page's own address (from the browser's Referer header), with when it
//     was last heard from and how many live /events connections it has.
//     Meld browser layers show up here the same as Chrome tabs do.
//   - relay: the last raw Firehose event / last chat message the Meld
//     listener passed on, and Meld's own per-platform connection states
//     (CONNECTION_STATE events) and live/offline (STREAM_STATUS events).
//   - listenerReload: set by the "Reload the listener" button; handed to the
//     listener in its next heartbeat reply, and the listener reloads itself.
// ---------------------------------------------------------------------------
const health = {
  pages: {},
  lastRawAt: null, lastRawKind: null, rawSinceStart: 0,
  lastChatAt: null, lastChatFrom: null, chatSinceStart: 0,
  meldConnections: {}, meldConnectionsAt: null,
  streamLive: null, streamLiveAt: null,
  listenerReload: false, listenerReloadAskedAt: null,
};

function healthNotePage(req) {
  const ref = req.headers.referer || req.headers.referrer;
  if (!ref) return null;
  let page;
  try {
    const u = new URL(ref);
    if (!/^(127\.0\.0\.1|localhost)$/i.test(u.hostname)) return null;
    page = u.pathname === '/' ? '/hub.html' : u.pathname;
  } catch (_error) { return null; }
  page = page.slice(0, 120);
  const entry = health.pages[page] || (health.pages[page] = { firstSeen: new Date().toISOString(), lastSeen: null, agent: '' });
  entry.lastSeen = new Date().toISOString();
  entry.agent = String(req.headers['user-agent'] || '').slice(0, 200);
  const keys = Object.keys(health.pages);
  if (keys.length > 80) {
    keys.sort((a, b) => (health.pages[a].lastSeen < health.pages[b].lastSeen ? -1 : 1));
    delete health.pages[keys[0]];
  }
  return page;
}

function healthNoteRaw(kind, data) {
  const now = new Date().toISOString();
  health.lastRawAt = now;
  health.lastRawKind = kind;
  health.rawSinceStart += 1;
  if (!data || typeof data !== 'object') return;
  if (kind === 'chat') {
    health.lastChatAt = now;
    health.lastChatFrom = typeof data.sender === 'string' ? data.sender.slice(0, 60) : null;
    health.chatSinceStart += 1;
  } else if (kind === 'connection' && data.states && typeof data.states === 'object') {
    // Meld sends partial lists (one platform group at a time), so merge.
    for (const [name, state] of Object.entries(data.states)) {
      if (typeof state === 'string') health.meldConnections[String(name).slice(0, 60)] = { state: state.slice(0, 30), at: now };
    }
    health.meldConnectionsAt = now;
  } else if (kind === 'stream_status' && typeof data.is_live === 'boolean') {
    health.streamLive = data.is_live; health.streamLiveAt = now;
  } else if (kind === 'meld.stream_status' && typeof data.is_streaming === 'boolean') {
    health.streamLive = data.is_streaming; health.streamLiveAt = now;
  }
}

const meldRequestLog = [];
function healthReport() {
  const openByPage = {};
  for (const client of clients) {
    if (client.icbPage) openByPage[client.icbPage] = (openByPage[client.icbPage] || 0) + 1;
  }
  const pages = Object.entries(health.pages).map(([page, e]) => ({ page, lastSeen: e.lastSeen, firstSeen: e.firstSeen, open: openByPage[page] || 0, agent: e.agent }))
    .sort((a, b) => (a.page < b.page ? -1 : 1));
  let latestBackup = null;
  try { latestBackup = (listGiveawayBackups()[0] || null); } catch (_error) {}
  let people = 0, winners = 0;
  try { people = Object.keys(giveaway.entrants || {}).length; winners = (giveaway.winners || []).length; } catch (_error) {}
  let walkerInfo = null;
  try { walkerInfo = { enabled: walkers.settings ? walkers.settings.enabled !== false : null, showChat: walkers.settings ? walkers.settings.showChat !== false : null, people: Object.keys(walkers.people || {}).length }; } catch (_error) {}
  return {
    meldRequests: meldRequestLog.slice(0, 40),
    ok: true,
    now: new Date().toISOString(),
    server: { startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), port: PORT, folder: APP_DIR, node: process.version },
    listener: { ...listenerStatus, reloadPending: health.listenerReload, reloadAskedAt: health.listenerReloadAskedAt },
    relay: { lastRawAt: health.lastRawAt, lastRawKind: health.lastRawKind, rawSinceStart: health.rawSinceStart, lastChatAt: health.lastChatAt, lastChatFrom: health.lastChatFrom, chatSinceStart: health.chatSinceStart },
    meld: { connections: health.meldConnections, connectionsAt: health.meldConnectionsAt, live: health.streamLive, liveAt: health.streamLiveAt },
    pages,
    palia: clone(live.reader),
    giveaway: { people, winners, latestBackup },
    walkers: walkerInfo,
  };
}

async function handleHealthApi(req, res, pathname, method) {
  if (pathname === '/api/connection-check' && method === 'GET') return sendJson(res, 200, healthReport());
  if (pathname === '/api/connection-check/reload-listener' && method === 'POST') {
    health.listenerReload = true;
    health.listenerReloadAskedAt = new Date().toISOString();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/connection-check/forget-pages' && method === 'POST') {
    health.pages = {};
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { ok: false, error: 'Not found.' });
}
// ---------------------------------------------------------------------------
// ICB HOME (Baby, 2026-09-29) - one master page (hub.html, also served at
// "/") with a tile for every dashboard, so she doesn't need a bookmark for
// each. Tiles can be dragged into any order, custom links can be added, and
// each tile has an "open when ICB starts" box - the start/restart .bat files
// ask /api/hub/startup-urls which pages to open.
// Saved in data/hub.json: { order: [ids], startup: [ids], custom: [...] }.
// ---------------------------------------------------------------------------
const HUB_FILE = path.join(DATA_DIR, 'hub.json');
const HUB_BUILTIN = [
  { id: 'trackers', icon: '📊', name: 'Tracker Command Center', url: '/control.html', desc: 'Resource trackers, skins, to-do lists, weekly goals' },
  { id: 'giveaway', icon: '🦄', name: 'Giveaway & Unicorn Jar', url: '/giveaway-control.html', desc: 'Draws, give unicorns, rates, board text, backups' },
  { id: 'report', icon: '📄', name: 'Nightly Report', url: '/giveaway-report.html', desc: 'Everything that happened on stream - print or CSV' },
  { id: 'plushie', icon: '🧸', name: 'Plushie Jar', url: '/tradeup-control.html', desc: 'Plushie catalog and the plushie jar pick' },
  { id: 'decor', icon: '🍂', name: 'Decor Overlays', url: '/decor-control.html', desc: 'Falling leaves and other seasonal screen decor' },
  { id: 'timer', icon: '⏱️', name: 'Stream Timer', url: '/timer-control.html', desc: 'Starting soon / BRB countdowns' },
  { id: 'worldclock', icon: '🌍', name: 'World Time Bar', url: '/worldclock-control.html', desc: 'Time zone clocks overlay' },
  { id: 'walkers', icon: '💬', name: 'Chat Unicorns', url: '/walkers-control.html', desc: 'Chatters\' unicorns hopping along the bottom - who gets one, reminders' },
];
const HUB_DEFAULT_STARTUP = ['trackers']; // what the .bat opened before the hub existed

function hubCleanUrl(value) {
  const url = cleanString(value).slice(0, 500);
  if (/^\/[^\s]*$/.test(url)) return url;             // an ICB page like /timer-control.html
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url;   // any web link
  return '';
}

function loadHub() {
  const raw = readJson(HUB_FILE, {}) || {};
  const custom = Array.isArray(raw.custom) ? raw.custom.map(c => ({
    id: /^c\d+$/.test(String(c && c.id)) ? c.id : `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
    icon: cleanString(c && c.icon).slice(0, 8) || '🔗',
    name: cleanString(c && c.name).slice(0, 60),
    url: hubCleanUrl(c && c.url),
    desc: cleanString(c && c.desc).slice(0, 120),
  })).filter(c => c.name && c.url) : [];
  const ids = new Set([...HUB_BUILTIN.map(t => t.id), ...custom.map(c => c.id)]);
  const order = (Array.isArray(raw.order) ? raw.order : []).filter(id => ids.has(id));
  for (const id of ids) if (!order.includes(id)) order.push(id); // new tiles go at the end
  const startup = Array.isArray(raw.startup) ? raw.startup.filter(id => ids.has(id)) : HUB_DEFAULT_STARTUP.slice();
  return { order, startup, custom };
}

let hub = loadHub();

function hubPublic() {
  const all = [...HUB_BUILTIN.map(t => ({ ...t, builtin: true })), ...hub.custom.map(c => ({ ...c, builtin: false }))];
  const byId = new Map(all.map(t => [t.id, t]));
  return { ok: true, tiles: hub.order.map(id => ({ ...byId.get(id), startup: hub.startup.includes(id) })).filter(t => t.id) };
}

async function handleHubApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/hub' && method === 'GET') return sendJson(res, 200, hubPublic());

    // What the start/restart .bat files open: the hub first, then every
    // ticked page, as full URLs.
    if (pathname === '/api/hub/startup-urls' && method === 'GET') {
      const base = `http://${HOST}:${PORT}`;
      const pub = hubPublic().tiles;
      const urls = [`${base}/hub.html`];
      for (const t of pub) if (t.startup) urls.push(t.url.startsWith('/') ? base + t.url : t.url);
      return sendJson(res, 200, { ok: true, urls });
    }

    // Save order / startup ticks / custom links (any subset).
    if (pathname === '/api/hub' && (method === 'PUT' || method === 'POST')) {
      const body = await readBody(req);
      const next = { order: hub.order, startup: hub.startup, custom: hub.custom };
      if (Array.isArray(body.custom)) next.custom = body.custom;
      if (Array.isArray(body.order)) next.order = body.order.map(String);
      if (Array.isArray(body.startup)) next.startup = body.startup.map(String);
      writeJson(HUB_FILE, next);
      hub = loadHub();
      writeJson(HUB_FILE, hub);
      broadcast('hub', hubPublic());
      return sendJson(res, 200, hubPublic());
    }

    return sendJson(res, 404, { ok: false, error: 'Unknown hub route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Hub request failed.' });
  }
}

// ---------------------------------------------------------------------------
// CHAT UNICORNS (Baby, 2026-09-29) - allowed chatters get their own unicorn
// that hops back and forth along the bottom of the stream, says their chat
// messages in a speech bubble, pops the occasional reminder, and walks off
// after 10 minutes of quiet.
//   - Overlay:   /walkers.html (Meld layer, full screen)
//   - Dashboard: /walkers-control.html
//   - Chat comes from the Meld listener's raw relay (/api/activity/raw,
//     kind "chat"), which already carries the text and emote pictures.
//   - Who gets one: subscribers automatically (sub months recorded in the
//     giveaway - live subs or hand-added "already subbed"), plus anyone Baby
//     ticks on the dashboard; she can also untick a sub. Names on the giveaway
//     block list (bots, herself) never get one.
//   - Art: assets/decor/unicorn/ (served at /decor-art/unicorn/<file>). Each
//     person keeps the same picture (random unless Baby picks one).
// Saved in data/walkers.json.
// ---------------------------------------------------------------------------
const WALKERS_FILE = path.join(DATA_DIR, 'walkers.json');
const WALKERS_ART_DIR = path.join(APP_DIR, 'assets', 'decor', 'unicorn');
const WALKERS_DEFAULT_SETTINGS = {
  enabled: true,
  artFacesLeft: false,  // set true if the unicorn pictures face LEFT (so they never walk backwards)
  size: 140,            // unicorn height in px
  speed: 1,             // walking speed multiplier
  afkMinutes: 10,       // walk off after this long without chatting
  bubbleSeconds: 7,     // how long a chat bubble stays up
  reminderEveryMinutes: 4,
  // Names + chat look (Baby, 2026-09-29): name above the head, no bubble.
  namePosition: 'above',     // 'above' | 'below' | 'hidden'
  nameFont: 'Baloo 2',
  nameSize: 22,
  nameColor: '#ffffff',
  nameBold: true,
  nameOutlineColor: '#3a1446',
  nameOutlineWidth: 3,
  nameBackground: false,     // true = old pill behind the name
  nameBgColor: '#782896',
  showChat: true,            // false = no chat speech bubbles (reminders still show)
  chatTextSize: 22,
  reminders: [
    'Check out !discord to join our cozy community!',
    'Remember to drink water! 💧',
    'Type !socials to find us everywhere!',
  ],
};
const WALKERS_LIMITS = { size: [50, 300], speed: [0.3, 3], afkMinutes: [1, 120], bubbleSeconds: [2, 20], reminderEveryMinutes: [0, 60], nameSize: [10, 72], nameOutlineWidth: [0, 8], chatTextSize: [12, 44] };
const WALKERS_FONTS = ['Baloo 2', 'Comic Sans MS', 'Arial', 'Arial Black', 'Trebuchet MS', 'Segoe UI', 'Verdana', 'Georgia', 'Impact', 'Courier New', 'Times New Roman'];
const WALKERS_COLOR = /^#[0-9a-f]{6}$/i;
// Checks the look settings (shared by load + the settings route).
function walkerCleanLook(s, src) {
  if (['above', 'below', 'hidden'].includes(src.namePosition)) s.namePosition = src.namePosition;
  if (WALKERS_FONTS.includes(src.nameFont)) s.nameFont = src.nameFont;
  for (const k of ['nameColor', 'nameOutlineColor', 'nameBgColor']) if (WALKERS_COLOR.test(String(src[k] || ''))) s[k] = String(src[k]).toLowerCase();
  for (const k of ['nameBold', 'nameBackground', 'showChat']) if (typeof src[k] === 'boolean') s[k] = src[k];
  return s;
}

function loadWalkers() {
  const raw = readJson(WALKERS_FILE, {}) || {};
  const s = { ...WALKERS_DEFAULT_SETTINGS, ...(raw.settings || {}) };
  s.enabled = s.enabled !== false;
  s.artFacesLeft = s.artFacesLeft === true;
  const look = walkerCleanLook({ ...WALKERS_DEFAULT_SETTINGS }, s);
  for (const k of ['namePosition', 'nameFont', 'nameColor', 'nameOutlineColor', 'nameBgColor', 'nameBold', 'nameBackground', 'showChat']) s[k] = look[k];
  for (const [k, [lo, hi]] of Object.entries(WALKERS_LIMITS)) {
    const n = Number(s[k]);
    s[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : WALKERS_DEFAULT_SETTINGS[k];
  }
  s.reminders = (Array.isArray(s.reminders) ? s.reminders : []).map(r => cleanString(r).slice(0, 140)).filter(Boolean).slice(0, 30);
  const people = {};
  for (const [key, p] of Object.entries(raw.people || {})) {
    if (!p || !p.name) continue;
    people[key.toLowerCase()] = {
      name: cleanString(p.name).slice(0, 40),
      allowed: p.allowed === true ? true : (p.allowed === false ? false : null), // null = automatic (subs)
      art: p.art ? path.basename(String(p.art)) : null,
      lastSeen: p.lastSeen || null,
    };
  }
  return { settings: s, people };
}

let walkers = loadWalkers();
let walkerEvents = [];   // recent chat for the overlay: { seq, name, parts, at }
let walkerSeq = 0;
try { fs.mkdirSync(WALKERS_ART_DIR, { recursive: true }); } catch (_error) {}

function saveWalkers() { writeJson(WALKERS_FILE, { settings: walkers.settings, people: walkers.people }); }

function walkerArt() {
  try { return fs.readdirSync(WALKERS_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b)); }
  catch (_error) { return []; }
}

function walkerIsSub(name) {
  const key = findEntrantKey(name);
  const e = key ? giveaway.entrants[key] : null;
  return !!(e && e.counts && e.counts.subMonths > 0);
}

function walkerAllowed(name) {
  if (!name || isBlocked(name)) return false;
  const p = walkers.people[name.toLowerCase()];
  if (p && p.allowed !== null) return p.allowed;
  return walkerIsSub(name);
}

// Keep only what the bubble needs: text and emote pictures.
function walkerParts(data) {
  const parts = [];
  for (const f of (Array.isArray(data && data.fragments) ? data.fragments : []).slice(0, 40)) {
    if (!f || typeof f !== 'object') continue;
    if (f.type === 'EMOTE' && /^https:\/\/[^\s"']+$/i.test(String(f.imageLink || ''))) parts.push({ t: 'emote', url: f.imageLink, name: cleanString(f.emoteName || f.text).slice(0, 40) });
    else if (typeof f.text === 'string' || typeof f.raw === 'string') parts.push({ t: 'text', v: String(f.text != null ? f.text : f.raw).slice(0, 300) });
  }
  if (!parts.length && data && typeof data.raw === 'string') parts.push({ t: 'text', v: data.raw.slice(0, 300) });
  return parts;
}

// Called for every relayed chat message.
function walkerChat(name, parts, force) {
  name = cleanString(name).replace(/^@/, '').slice(0, 40);
  if (!name) return false;
  const key = name.toLowerCase();
  const known = walkers.people[key];
  if (!known) walkers.people[key] = { name, allowed: null, art: null, lastSeen: new Date().toISOString() };
  else { known.name = name; known.lastSeen = new Date().toISOString(); }
  if (!known) saveWalkers(); // remember new chatters so they show on the dashboard list
  if (!force && !walkerAllowed(name)) return false;
  walkerEvents.push({ seq: ++walkerSeq, name, parts, at: Date.now() });
  if (walkerEvents.length > 200) walkerEvents = walkerEvents.slice(-200);
  return true;
}

function walkerOverlayState(since) {
  const art = walkerArt();
  const pick = {};
  for (const [key, p] of Object.entries(walkers.people)) if (p.art && art.includes(p.art)) pick[key] = `/decor-art/unicorn/${encodeURIComponent(p.art)}`;
  return {
    ok: true,
    settings: walkers.settings,
    art: art.map(f => `/decor-art/unicorn/${encodeURIComponent(f)}`),
    pick,                       // lowercase name -> chosen art
    seq: walkerSeq,
    events: walkerEvents.filter(e => e.seq > since),
    clearAt: walkers.clearAt || 0,
  };
}

function walkerAdminState() {
  const art = walkerArt();
  const names = new Map();
  for (const p of Object.values(walkers.people)) names.set(p.name.toLowerCase(), p.name);
  for (const e of Object.values(giveaway.entrants || {})) if (e && e.username && !names.has(e.username.toLowerCase())) names.set(e.username.toLowerCase(), e.username);
  const people = [...names.entries()].filter(([, n]) => !isBlocked(n)).map(([key, name]) => {
    const p = walkers.people[key] || {};
    return { name, isSub: walkerIsSub(name), override: p.allowed === undefined ? null : p.allowed, allowed: walkerAllowed(name), art: p.art || null, lastSeen: p.lastSeen || null };
  }).sort((a, b) => (b.allowed - a.allowed) || String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || a.name.localeCompare(b.name));
  return { ok: true, settings: walkers.settings, art, people, fonts: WALKERS_FONTS };
}

async function handleWalkersApi(req, res, pathname, method, url) {
  try {
    if (pathname === '/api/walkers/state' && method === 'GET') {
      const since = Number(url.searchParams.get('since')) || 0;
      return sendJson(res, 200, walkerOverlayState(since));
    }
    if (pathname === '/api/walkers/admin' && method === 'GET') return sendJson(res, 200, walkerAdminState());

    if (pathname === '/api/walkers/settings' && (method === 'PUT' || method === 'POST')) {
      const body = await readBody(req);
      const s = walkers.settings;
      if (typeof body.enabled === 'boolean') s.enabled = body.enabled;
      if (typeof body.artFacesLeft === 'boolean') s.artFacesLeft = body.artFacesLeft;
      walkerCleanLook(s, body);
      for (const [k, [lo, hi]] of Object.entries(WALKERS_LIMITS)) {
        if (body[k] === undefined) continue;
        const n = Number(body[k]);
        if (Number.isFinite(n)) s[k] = Math.min(hi, Math.max(lo, n));
      }
      if (Array.isArray(body.reminders)) s.reminders = body.reminders.map(r => cleanString(r).slice(0, 140)).filter(Boolean).slice(0, 30);
      saveWalkers();
      return sendJson(res, 200, walkerAdminState());
    }

    // { name, allowed: true | false | null (automatic), art: filename | null }
    if (pathname === '/api/walkers/person' && (method === 'PUT' || method === 'POST')) {
      const body = await readBody(req);
      const name = cleanString(body.name).replace(/^@/, '').slice(0, 40);
      if (!name) return sendJson(res, 400, { ok: false, error: 'Missing name.' });
      const key = name.toLowerCase();
      const p = walkers.people[key] || (walkers.people[key] = { name, allowed: null, art: null, lastSeen: null });
      if (body.allowed === true || body.allowed === false || body.allowed === null) p.allowed = body.allowed;
      if (body.art === null || body.art === '') p.art = null;
      else if (typeof body.art === 'string' && walkerArt().includes(path.basename(body.art))) p.art = path.basename(body.art);
      saveWalkers();
      return sendJson(res, 200, walkerAdminState());
    }

    // Test button: a pretend chatter says something (shows even if not ticked).
    if (pathname === '/api/walkers/test' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanString(body.name) || `TestUnicorn${1 + Math.floor(Math.random() * 9)}`;
      const text = cleanString(body.text).slice(0, 300) || 'Hi everyone! 🦄';
      walkerChat(name, [{ t: 'text', v: text }], true);
      return sendJson(res, 200, { ok: true, name });
    }

    // Send every unicorn off screen right now.
    if (pathname === '/api/walkers/clear' && method === 'POST') {
      walkers.clearAt = Date.now();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown walkers route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Walkers request failed.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  // 2026-09-30: every request from Meld's built-in browser, newest first, so
  // Connection check can show exactly which Meld layers are reaching ICB.
  if (/Meld\//.test(String(req.headers['user-agent'] || ''))) {
    meldRequestLog.unshift({ at: new Date().toISOString(), method: req.method, path: url.pathname.slice(0, 80), referer: String(req.headers.referer || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 80) || null, origin: String(req.headers.origin || '').slice(0, 60) || null });
    while (meldRequestLog.length > 60) meldRequestLog.pop();
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const role = url.searchParams.get('role');
    res.icbRole = ['control', 'overlay'].includes(role) ? role : 'other';
    res.icbPage = healthNotePage(req);
    clients.add(res);
    sendSse(res, 'snapshot', publicState());
    sendSse(res, 'tradeup', tradeupPublicState());
    sendSse(res, 'giveaway', publicGiveaway());
    sendSse(res, 'decor', decorPublicState());
    sendSse(res, 'hub', hubPublic());
    req.on('close', () => clients.delete(res));
    return;
  }
  try {
    if (url.pathname.startsWith('/api/')) { if (url.pathname !== '/api/connection-check' && url.pathname !== '/api/health') healthNotePage(req); return await handleApi(req, res, url); }
    if (url.pathname.startsWith('/resource-art/')) return serveResourceArt(res, url.pathname);
    if (url.pathname.startsWith('/tradeup-art/')) return serveTradeupArt(res, url.pathname);
    if (url.pathname.startsWith('/decor-art/')) return serveDecorArt(res, url.pathname);
    if (/^\/decor\/[a-z0-9-]+\.html$/.test(url.pathname)) return serveDecorOverlay(res);
    if (url.pathname === '/weekly.html' || url.pathname === '/weekly-wide.html') {
      // Two addresses rather than a query string. Query strings are barred from
      // Meld URLs (see the handbook) - the one overlay that ever used them never
      // rendered, and although that was never proved to be the cause, a stream
      // is the wrong place to test the theory. A wide layout therefore gets its
      // own plain path.
      if (url.pathname === '/weekly-wide.html') {
        if (!url.searchParams.get('cols')) url.searchParams.set('cols', '2');
        if (!url.searchParams.get('w')) url.searchParams.set('w', '900');
      }
      noteOverlayRequest('page:weekly', req, url);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache', Expires: '0',
      });
      return res.end(renderWeeklyPage(url.searchParams));
    }
    if (url.pathname === '/ticker.html') {
      noteOverlayRequest('page:ticker', req, url);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache', Expires: '0',
      });
      return res.end(renderTickerPage(url.searchParams));
    }
    {
      // Each resource card gets its own plain URL - /gold-ore.html - so a Meld
      // layer never needs a query string. Query strings are the one thing the
      // overlay that never worked had in common.
      const cardMatch = url.pathname.match(/^\/([a-z0-9-]+)\.html$/i);
      const card = cardMatch ? findResourceCard(cardMatch[1].toLowerCase()) : null;
      if (card) {
        noteOverlayRequest(`page:${card.id}`, req, url);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        });
        return res.end(renderResourceCardPage(card, url.searchParams));
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return serveStatic(res, url.pathname);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Request failed.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ICB Clean ${VERSION} listening at http://${HOST}:${PORT}`);
  scanLog();
});

// The week must roll over even on a quiet night with no log activity, and a
// server that was off across the boundary catches up on its next tick.
rolloverWeeklyIfDue();
const weeklyTimer = setInterval(() => { try { rolloverWeeklyIfDue(); } catch (_error) {} }, 60000);
weeklyTimer.unref();

const readerTimer = setInterval(scanLog, 1000);
readerTimer.unref();
const heartbeat = setInterval(() => {
  for (const client of clients) {
    try { client.write(`: heartbeat ${Date.now()}\n\n`); } catch (_error) { clients.delete(client); }
  }
}, 15000);
heartbeat.unref();

function shutdown() {
  clearInterval(readerTimer);
  clearInterval(heartbeat);
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
