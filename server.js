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

// ---------------------------------------------------------------------------
// TITLE & GO-LIVE RANDOMIZER (Baby, 2026-10-03) - top of ICB Home. Lists of
// stream titles and go-live messages per game; the page picks one of each at
// random (avoiding the last few picks). Saved in data/randomizer.json.
// ---------------------------------------------------------------------------
const RANDOMIZER_DEFAULTS = {
  games: [{
    id: 'palia',
    name: 'Palia',
    titles: [
      '🦄 Cozy Palia Vibes | Farming, Fishing & Good Company',
      '🌸 Chill Palia Day in Kilima | Come Hang Out!',
      '🎣 Fishing for Rare Catches in Palia | Chat & Chill',
      '🐞 Bug Hunting Bonanza | Cozy Palia Stream',
      '🍳 Cooking Up a Storm in Palia | Unicorn Giveaway Tonight!',
      '🌙 Late Night Palia | Grinding with the Herd',
      '🏡 Decorating My Palia Plot | Help Me Choose!',
      '💖 Palia & Plushies | Chat Earns Fluffy Unicorns',
    ],
    golives: [
      '✨ I\'m LIVE in Palia! {title} — come hang out 🦄 {link}',
      '🦄 The herd is gathering! We\'re live now: {title} {link}',
      '🌸 Grab a cozy drink and join me — live in Palia! {link}',
      '💖 Going live! Chat to earn fluffy unicorns tonight 🦄 {title} {link}',
      '🎣 Rods out, snacks ready — I\'m live! {title} {link}',
    ],
  }],
  link: 'https://twitch.tv/ijustababytv',
  recent: {},
};
function randomizerClean(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const strList = (list, max) => (Array.isArray(list) ? list : []).map(v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)).filter(Boolean).slice(0, 400);
  const games = [];
  for (const g of (Array.isArray(src.games) ? src.games : []).slice(0, 30)) {
    if (!g || typeof g !== 'object') continue;
    const name = String(g.name || '').trim().slice(0, 40);
    if (!name) continue;
    let id = String(g.id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';
    while (games.some(x => x.id === id)) id += '-2';
    games.push({ id, name, titles: strList(g.titles, 200), golives: strList(g.golives, 500) });
  }
  const recent = {};
  if (src.recent && typeof src.recent === 'object') for (const [k, v] of Object.entries(src.recent).slice(0, 80)) recent[String(k).slice(0, 60)] = strList(v, 500).slice(0, 10);
  const link = /^https?:\/\/\S+$/i.test(String(src.link || '').trim()) ? String(src.link).trim().slice(0, 200) : '';
  return { games, link, recent };
}
const RANDOMIZER_FILE = path.join(DATA_DIR, 'randomizer.json');

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
let randomizer = (() => { const saved = readJson(RANDOMIZER_FILE, null); const r = randomizerClean(saved || RANDOMIZER_DEFAULTS); return r.games.length ? r : randomizerClean(RANDOMIZER_DEFAULTS); })();
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
  // Title & go-live randomizer (ICB Home, Baby 2026-10-03).
  if (pathname === '/api/randomizer' && method === 'GET') return sendJson(res, 200, { ok: true, ...randomizer });
  if (pathname === '/api/randomizer' && ['PUT', 'POST'].includes(method)) {
    const body = await readBody(req);
    const next = randomizerClean(body);
    if (!next.games.length) return sendJson(res, 400, { ok: false, error: 'Keep at least one game.' });
    randomizer = next;
    writeJson(RANDOMIZER_FILE, randomizer);
    return sendJson(res, 200, { ok: true, ...randomizer });
  }

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
  if (pathname.startsWith('/api/poll')) return handlePollApi(req, res, pathname, method);
  if (pathname === '/api/teams' || pathname.startsWith('/api/teams/')) return handleTeamsApi(req, res, pathname, method);
  if (pathname === '/api/eventtime') return handleEventTimeApi(req, res, pathname, method);
  if (pathname === '/api/party' || pathname.startsWith('/api/party/')) return handlePartyApi(req, res, pathname, method);
  if (pathname === '/api/steam' || pathname.startsWith('/api/steam/')) return handleSteamApi(req, res, pathname, method);
  if (pathname === '/api/newsticker' || pathname.startsWith('/api/newsticker/')) return handleNewsApi(req, res, pathname, method);
  if (pathname === '/api/sashimi' || pathname.startsWith('/api/sashimi/')) return handleSashiApi(req, res, pathname, method);
  if (pathname === '/api/beanburger-signup' || pathname.startsWith('/api/beanburger-signup/')) return handleBbsuApi(req, res, pathname, method);
  if (pathname === '/api/flowtree-signup' || pathname.startsWith('/api/flowtree-signup/')) return handleFtsuApi(req, res, pathname, method);
  if (pathname === '/api/desktop' || pathname.startsWith('/api/desktop/')) return handleDeskApi(req, res, pathname, method);
  if (pathname === '/api/aniimo' || pathname.startsWith('/api/aniimo/')) return handleDexApi(req, res, pathname, method);
  if (pathname === '/api/sprites' || pathname.startsWith('/api/sprites/')) return handleSpritesApi(req, res, pathname, method);
  if (pathname === '/api/avatars' || pathname.startsWith('/api/avatars/')) return handleAvatarsApi(req, res, pathname, method);
  if (pathname === '/api/countdowns') return handleCountdownsApi(req, res, pathname, method);
  if (pathname === '/api/paliaclock') return handlePaliaClockApi(req, res, pathname, method);
  if (pathname === '/api/sprite-tv' || pathname === '/api/sprite-tv/slideshow') return handleSpriteTvApi(req, res, pathname, method);
  if (pathname === '/api/hunt' || pathname.startsWith('/api/hunt/')) return handleHuntApi(req, res, pathname, method);

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
    try { if (type !== 'chat') avEvent(type, username, body); } catch (_error) {}
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
      try { pollChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      try { teamsChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      let shDone = false;   // "!show cake" / "!hide flow" ... (handled once, then the sign-ups skip it)
      try { shDone = signupShowHideChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      if (!shDone) {
        try { sashiChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
        try { bbsuChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
        try { ftsuChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      }
      try { dexChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      try { avChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      try { sjChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      try { huntChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
      if (!shDone) try { partyChat(body.data.sender, walkerParts(body.data)); } catch (_error) {}
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
// Motion: 'fall' = drift down (leaves), 'float' = rise up (ghosts), 'fly' = drift across.
const DECOR_TYPES = ['fall', 'float', 'fly'];
// /decor/all.html shows every effect that's on, so no effect may be called "all".
const DECOR_RESERVED_IDS = ['all'];
// min, max, default for every slider on the dashboard.
const DECOR_LIMITS = {
  amount: [1, 200, 40],     // how many on screen at once
  speed: [0.2, 3, 1],       // fall speed multiplier
  size: [16, 300, 70],      // px (each one varies +/-25%)
  opacity: [0.1, 1, 0.9],   // see-through
  drift: [-3, 3, 0.4],      // wind: negative blows left, positive right
  sway: [0, 2, 1],          // side-to-side flutter
  spin: [0, 2, 1],          // how much they twirl
  fade: [0, 1, 0],          // ghostly fade: pieces pulse between solid and faint
};

function decorDefaults() {
  return { rev: 1, effects: [decorNewEffect('leaves', 'Falling leaves')], presets: [] };
}

function decorNewEffect(id, name, type) {
  // extra = pictures borrowed from the picture library (other folders), as "folder/file".
  const e = { id, name, type: DECOR_TYPES.includes(type) ? type : 'fall', enabled: false, off: [], extra: [] };
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
  if (!id || id === 'item' || DECOR_RESERVED_IDS.includes(id)) return null;
  const e = decorNewEffect(id, cleanString(raw.name) || id);
  e.type = DECOR_TYPES.includes(raw.type) ? raw.type : 'fall';
  e.enabled = raw.enabled === true;
  e.off = Array.isArray(raw.off) ? raw.off.map(f => path.basename(String(f))).filter(f => DECOR_IMAGE_EXT.test(f)).slice(0, 500) : [];
  e.extra = decorCleanExtra(raw.extra);
  for (const k of Object.keys(DECOR_LIMITS)) e[k] = decorClamp(k, raw[k], e[k]);
  return e;
}

// Picture library keys look like "folder/file.png" (a folder inside assets/decor).
function decorCleanExtra(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const parts = String(item || '').split('/');
    if (parts.length !== 2) continue;
    const folder = tradeupSlug(parts[0]), file = path.basename(parts[1]);
    if (!folder || folder !== parts[0] || folder === 'item' || file !== parts[1] || !DECOR_IMAGE_EXT.test(file)) continue;
    const key = `${folder}/${file}`;
    if (!out.includes(key)) out.push(key);
  }
  return out.slice(0, 300);
}

// Every picture in every folder under assets/decor (the "picture library").
function decorLibrary() {
  let folders = [];
  try { folders = fs.readdirSync(DECOR_ART_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_') && tradeupSlug(d.name) === d.name).map(d => d.name).sort(); } catch (_error) { folders = []; }
  const out = [];
  for (const folder of folders) for (const file of decorFiles(folder)) out.push({ key: `${folder}/${file}`, folder, file, url: `/decor-art/${folder}/${encodeURIComponent(file)}` });
  return out;
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
  const library = decorLibrary();
  const byKey = new Map(library.map(x => [x.key, x]));
  return {
    ok: true,
    rev: decor.rev,
    limits: DECOR_LIMITS,
    library,
    effects: decor.effects.map(e => {
      const files = decorFiles(e.id);
      const own = files.filter(f => !e.off.includes(f)).map(f => `/decor-art/${e.id}/${encodeURIComponent(f)}`);
      // Borrowed from other folders via the picture library (skip ones that were moved/removed).
      const borrowed = (e.extra || []).filter(k => byKey.has(k) && !k.startsWith(`${e.id}/`)).map(k => byKey.get(k).url);
      return { ...e, files, images: own.concat(borrowed) };
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
      const base = id;
      while (decorFind(id) || DECOR_RESERVED_IDS.includes(id)) id = `${base}-${n++}`;
      const e = decorNewEffect(id, name, body.type);
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

    // "Switch to this one": turn this effect on and every other effect off.
    let m = /^\/api\/decor\/effects\/([a-z0-9-]+)\/solo$/.exec(pathname);
    if (m && method === 'POST') {
      const e = decorFind(m[1]);
      if (!e) return sendJson(res, 404, { ok: false, error: 'No such effect.' });
      for (const other of decor.effects) other.enabled = other.id === e.id;
      saveDecor();
      return sendJson(res, 200, { ok: true });
    }

    m = /^\/api\/decor\/effects\/([a-z0-9-]+)$/.exec(pathname);
    if (m && (method === 'PATCH' || method === 'POST')) {
      const e = decorFind(m[1]);
      if (!e) return sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const body = await readBody(req);
      if (typeof body.name === 'string' && cleanString(body.name)) e.name = cleanString(body.name).slice(0, 40);
      if (typeof body.enabled === 'boolean') e.enabled = body.enabled;
      if (DECOR_TYPES.includes(body.type)) e.type = body.type;
      for (const k of Object.keys(DECOR_LIMITS)) if (body[k] !== undefined) e[k] = decorClamp(k, body[k], e[k]);
      if (Array.isArray(body.off)) e.off = body.off.map(f => path.basename(String(f))).filter(f => DECOR_IMAGE_EXT.test(f)).slice(0, 500);
      if (Array.isArray(body.extra)) e.extra = decorCleanExtra(body.extra);
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

    // Upload into the picture library (assets/decor/misc): { dataUrl, name }
    if (pathname === '/api/decor/library' && method === 'POST') {
      const body = await readBody(req);
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = tradeupSlug(String(body.name || 'art').replace(/\.[a-z0-9]+$/i, ''));
      const dir = path.join(DECOR_ART_DIR, 'misc');
      fs.mkdirSync(dir, { recursive: true });
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      saveDecor();
      return sendJson(res, 200, { ok: true, key: `misc/${filename}` });
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
  { id: 'timer', icon: '⏳', name: 'Countdowns', url: '/countdown-control.html', desc: 'Starting soon / BRB countdowns - themes, size, your own text and end message' },
  { id: 'worldclock', icon: '🌍', name: 'World Time Bar', url: '/worldclock-control.html', desc: 'Time zone clocks overlay' },
  { id: 'poll', icon: '🗳️', name: 'Badge Vote', url: '/poll-control.html', desc: 'Let chat vote on badges with !vote - images, live results, winner reveal' },
  { id: 'newsticker', icon: '📰', name: 'News Ticker', url: '/newsticker-control.html', desc: 'Scrolling news bar along the bottom of stream - messages, alert, colours, speed' },
  { id: 'steam', icon: '🏅', name: 'Steam Achievements', url: '/steam-control.html', desc: 'Aniimo achievement pop-ups + progress on stream, read from Steam' },
  { id: 'party', icon: '🎂', name: 'Cake Sign-Ups', url: '/party-control.html', desc: 'Chat signs up for overprep roles with !tomato PaliaName - events, roles, spots, waitlist' },
  { id: 'avatars', icon: '👻', name: 'Chat Avatars', url: '/chat-avatars-control.html', desc: 'Chatters become little sprites wandering the bottom of stream with speech bubbles' },
  { id: 'paliaclock', icon: '🕰️', name: 'Palia Clock', url: '/palia-clock-control.html', desc: 'In-game Palia time on stream, with alarms at Palia times' },
  { id: 'hunt', icon: '🎃', name: 'Team Hunt', url: '/hunt-control.html', desc: 'Team contest - chat joins with !team a, finds score with !cloth / !plushie, each worth its own points' },
  { id: 'spritejar', icon: '🫙', name: 'Sprite Jar', url: '/sprite-jar-control.html', desc: 'Stream overlay - !jonesy gold floats that sprite out of the jar into the sticker book' },
  { id: 'spritetv', icon: '📺', name: 'Sprite TV', url: '/sprite-tv-control.html', desc: 'Retro TV showing the last sprite caught - pick what shows, text position, effects' },
  { id: 'sprites', icon: '🎮', name: 'Fortnite Sprites', url: '/sprites-control.html', desc: 'Every sprite + variant this season - tap the circles as you catch them' },
  { id: 'aniimo', icon: '✨', name: 'Aniimo Dex', url: '/aniimo-control.html', desc: 'Catch & variant checklist - progress overlay, new-catch pop-ups, chat !need look-ups, quick checker' },
  { id: 'desktop', icon: '🖥️', name: 'Desktop Widgets', url: '/desktop-control.html', desc: 'Put any widget on your desktop over your game - move, size, show/hide from here' },
  { id: 'sashimi', icon: '🥗', name: 'Poke Bowl Sign-up', url: '/sashimi-signin-control.html', desc: 'Sesh-style event sign-ups from chat - time in world time zones, countdown, roles with their own !commands' },
  { id: 'bbsignup', icon: '🍔', name: 'Bean Burger Sign-Up', url: '/beanburger-signup-control.html', desc: 'Its own sign-up widget (a copy of the Poke Bowl Sign-up) - events, roles with !commands, world times, countdown. Pops up with !burger' },
  { id: 'ftsignup', icon: '🌳', name: 'Flow Tree Sign-Up', url: '/flowtree-signup-control.html', desc: 'Its own sign-up widget (a copy of the Poke Bowl Sign-up) - events, roles with !commands, world times, countdown. Pops up with !flow' },
  { id: 'eventtime', icon: '🕒', name: 'Event Time Converter', url: '/eventtime-control.html', desc: 'Type when an event starts - shows that time + day in PDT, MDT, CDT, EDT, GMT+1, GMT+2' },
  { id: 'teams', icon: '🏆', name: 'Team Contest', url: '/teams-control.html', desc: 'Grinding-party teams: chat joins with !team a, scores with !cloth +2 - live board' },
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
// Subscriber-only pictures (Baby, 2026-10-01): never in the random pool;
// only subscribers can have them. Person art "subs:<file>" points here.
const WALKERS_SUB_ART_DIR = path.join(APP_DIR, 'assets', 'decor', 'unicorn-subs');
try { fs.mkdirSync(WALKERS_SUB_ART_DIR, { recursive: true }); } catch (_error) {}
// Personal pictures (Baby, 2026-10-03): one person's own picture of their
// choice, uploaded from their row on the dashboard. Never used for anyone
// else, never random. Person art "personal:<file>"; person.personal remembers it.
const WALKERS_PERSONAL_DIR = path.join(APP_DIR, 'assets', 'decor', 'unicorn-personal');
try { fs.mkdirSync(WALKERS_PERSONAL_DIR, { recursive: true }); } catch (_error) {}
const WALKERS_DEFAULT_SETTINGS = {
  enabled: true,
  whoGets: 'everyone',  // 'everyone' (Baby, 2026-10-01) | 'subs' (the original rule)
  subsAuto: true,       // subscribers with no picked picture get a random subscriber-only one
  artFacesLeft: false,  // set true if the unicorn pictures face LEFT (so they never walk backwards)
  size: 140,            // unicorn height in px
  speed: 1,             // walking speed multiplier
  afkMinutes: 10,       // walk off after this long without chatting
  bubbleSeconds: 7,     // how long a chat bubble stays up
  reminderEveryMinutes: 4,
  trickGap: 8,          // average seconds between tricks
  entrance: 'drop',
  exitStyle: 'walk',
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
const WALKERS_LIMITS = { trickGap: [2, 30], size: [50, 300], speed: [0.3, 3], afkMinutes: [1, 120], bubbleSeconds: [2, 20], reminderEveryMinutes: [0, 60], nameSize: [10, 72], nameOutlineWidth: [0, 8], chatTextSize: [12, 44] };
// Animations (Baby, 2026-10-01): every movement style and trick can be
// switched on/off and given a "how often" (1-10) on the dashboard.
// kind 'move' = how they get around (each unicorn switches between the ones
// that are on every so often); kind 'trick' = random things they do.
const WALKERS_ANIMS = [
  { id: 'hop',       kind: 'move',  label: 'Hop',          desc: 'Bounces along the ground', on: true, often: 5 },
  { id: 'glide',     kind: 'move',  label: 'Glide',        desc: 'Slides smoothly, leaning forward, no bouncing', on: true, often: 3 },
  { id: 'float',     kind: 'move',  label: 'Float',        desc: 'Hovers above the ground, drifting up and down', on: true, often: 2 },
  { id: 'skip',      kind: 'move',  label: 'Skip',         desc: 'Two little hops then a big one, over and over', on: true, often: 3 },
  { id: 'trot',      kind: 'move',  label: 'Trot',         desc: 'Quick little steps, a bit faster', on: true, often: 2 },
  { id: 'waddle',    kind: 'move',  label: 'Waddle',       desc: 'Rocks side to side with small, slow steps', on: true, often: 2 },
  { id: 'pause',     kind: 'trick', label: 'Stop & look',  desc: 'Stops for a moment', on: true, often: 3 },
  { id: 'bighop',    kind: 'trick', label: 'Big hop',      desc: 'One big jump', on: true, often: 3 },
  { id: 'spin',      kind: 'trick', label: 'Spin',         desc: 'Spins around on the spot', on: true, often: 2 },
  { id: 'sparkle',   kind: 'trick', label: 'Sparkles',     desc: 'A burst of sparkles, hearts and stars', on: true, often: 2 },
  { id: 'turn',      kind: 'trick', label: 'Turn around',  desc: 'Changes its mind and goes the other way', on: true, often: 2 },
  { id: 'flip',      kind: 'trick', label: 'Backflip',     desc: 'Jumps and flips all the way over', on: true, often: 2 },
  { id: 'twirljump', kind: 'trick', label: 'Twirl jump',   desc: 'Leaps up and twirls twice in the air', on: true, often: 1 },
  { id: 'bounce',    kind: 'trick', label: 'Bouncy',       desc: 'Three quick bounces in place', on: true, often: 2 },
  { id: 'dance',     kind: 'trick', label: 'Dance',        desc: 'Wiggles and wobbles to the music', on: true, often: 2 },
  { id: 'hearts',    kind: 'trick', label: 'Hearts',       desc: 'Little hearts float up from it', on: true, often: 2 },
  { id: 'zoomies',   kind: 'trick', label: 'Zoomies',      desc: 'Sprints super fast for a moment', on: true, often: 1 },
  { id: 'rainbow',   kind: 'trick', label: 'Rainbow dash', desc: 'Runs fast leaving a rainbow trail', on: true, often: 1 },
  { id: 'grow',      kind: 'trick', label: 'Puff up',      desc: 'Grows big, then pops back to normal', on: true, often: 1 },
  { id: 'nap',       kind: 'trick', label: 'Little nap',   desc: 'Sits still for a few seconds with a Zzz', on: false, often: 1 },
];
const WALKERS_ENTRANCES = { drop: 'Drop in from above', pop: 'Pop in (grows out of nothing)', floatdown: 'Float down slowly', slide: 'Walk in from the side' };
const WALKERS_EXITS = { walk: 'Sleepy Zzz, then walk off', floataway: 'Sleepy Zzz, then float up and away', poof: 'Sleepy Zzz, then vanish in sparkles' };
function walkerCleanAnims(src, prev) {
  const out = {};
  for (const a of WALKERS_ANIMS) {
    const old = (prev && prev[a.id]) || { on: a.on, often: a.often };
    const inc = (src && src[a.id]) || {};
    const often = Number(inc.often);
    out[a.id] = {
      on: typeof inc.on === 'boolean' ? inc.on : old.on !== false,
      often: Number.isFinite(often) ? Math.min(10, Math.max(1, Math.round(often))) : Math.min(10, Math.max(1, Number(old.often) || a.often)),
    };
  }
  return out;
}
let walkerTry = { id: null, at: 0 };   // "▶ Try" on the dashboard: every unicorn does it now

const WALKERS_FONTS = ['Baloo 2', 'Comic Sans MS', 'Arial', 'Arial Black', 'Trebuchet MS', 'Segoe UI', 'Verdana', 'Georgia', 'Impact', 'Courier New', 'Times New Roman'];
const WALKERS_COLOR = /^#[0-9a-f]{6}$/i;
// Checks the look settings (shared by load + the settings route).
function walkerCleanLook(s, src) {
  if (['above', 'below', 'hidden'].includes(src.namePosition)) s.namePosition = src.namePosition;
  if (WALKERS_FONTS.includes(src.nameFont)) s.nameFont = src.nameFont;
  for (const k of ['nameColor', 'nameOutlineColor', 'nameBgColor']) if (WALKERS_COLOR.test(String(src[k] || ''))) s[k] = String(src[k]).toLowerCase();
  for (const k of ['nameBold', 'nameBackground', 'showChat', 'subsAuto']) if (typeof src[k] === 'boolean') s[k] = src[k];
  if (['everyone', 'subs'].includes(src.whoGets)) s.whoGets = src.whoGets;
  return s;
}

function loadWalkers() {
  const raw = readJson(WALKERS_FILE, {}) || {};
  const s = { ...WALKERS_DEFAULT_SETTINGS, ...(raw.settings || {}) };
  s.enabled = s.enabled !== false;
  s.artFacesLeft = s.artFacesLeft === true;
  const look = walkerCleanLook({ ...WALKERS_DEFAULT_SETTINGS }, s);
  for (const k of ['namePosition', 'nameFont', 'nameColor', 'nameOutlineColor', 'nameBgColor', 'nameBold', 'nameBackground', 'showChat', 'subsAuto', 'whoGets']) s[k] = look[k];
  for (const [k, [lo, hi]] of Object.entries(WALKERS_LIMITS)) {
    const n = Number(s[k]);
    s[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : WALKERS_DEFAULT_SETTINGS[k];
  }
  s.reminders = (Array.isArray(s.reminders) ? s.reminders : []).map(r => cleanString(r).slice(0, 140)).filter(Boolean).slice(0, 30);
  s.anims = walkerCleanAnims(s.anims, null);
  if (!WALKERS_ENTRANCES[s.entrance]) s.entrance = 'drop';
  if (!WALKERS_EXITS[s.exitStyle]) s.exitStyle = 'walk';
  const people = {};
  for (const [key, p] of Object.entries(raw.people || {})) {
    if (!p || !p.name) continue;
    people[key.toLowerCase()] = {
      name: cleanString(p.name).slice(0, 40),
      allowed: p.allowed === true ? true : (p.allowed === false ? false : null), // null = automatic (subs)
      art: walkerCleanArtRef(p.art),
      lastSeen: p.lastSeen || null,
      personal: p.personal && DECOR_IMAGE_EXT.test(path.basename(String(p.personal))) ? path.basename(String(p.personal)) : null,
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
function walkerSubArt() {
  try { return fs.readdirSync(WALKERS_SUB_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b)); }
  catch (_error) { return []; }
}
// A person's picked picture: "file.png" (everyone's pool) or "subs:file.png" (subscriber-only).
function walkerCleanArtRef(ref) {
  if (!ref) return null;
  const str = String(ref);
  if (str.startsWith('subs:')) { const f = path.basename(str.slice(5)); return DECOR_IMAGE_EXT.test(f) ? `subs:${f}` : null; }
  if (str.startsWith('personal:')) { const f = path.basename(str.slice(9)); return DECOR_IMAGE_EXT.test(f) ? `personal:${f}` : null; }
  const f = path.basename(str);
  return DECOR_IMAGE_EXT.test(f) ? f : null;
}
function walkerArtUrl(ref) {
  if (ref.startsWith('personal:')) return `/decor-art/unicorn-personal/${encodeURIComponent(ref.slice(9))}`;
  return ref.startsWith('subs:') ? `/decor-art/unicorn-subs/${encodeURIComponent(ref.slice(5))}` : `/decor-art/unicorn/${encodeURIComponent(ref)}`;
}
function walkerHash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

function walkerIsSub(name) {
  const key = findEntrantKey(name);
  const e = key ? giveaway.entrants[key] : null;
  return !!(e && e.counts && e.counts.subMonths > 0);
}

function walkerAllowed(name) {
  if (!name || isBlocked(name)) return false;
  const p = walkers.people[name.toLowerCase()];
  if (p && p.allowed !== null && p.allowed !== undefined) return p.allowed;
  return walkers.settings.whoGets === 'subs' ? walkerIsSub(name) : true;
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
  const art = walkerArt(), subArt = walkerSubArt();
  const pick = {};
  for (const [key, p] of Object.entries(walkers.people)) {
    const ref = p.art;
    if (ref && ref.startsWith('personal:')) {
      if (p.personal === ref.slice(9) && fs.existsSync(path.join(WALKERS_PERSONAL_DIR, p.personal))) { pick[key] = walkerArtUrl(ref); continue; }
    }
    if (ref && !ref.startsWith('subs:') && !ref.startsWith('personal:') && art.includes(ref)) { pick[key] = walkerArtUrl(ref); continue; }
    // Subscriber-only pictures go to subscribers only - never the random pool.
    if (!walkerIsSub(p.name)) continue;
    if (ref && ref.startsWith('subs:') && subArt.includes(ref.slice(5))) pick[key] = walkerArtUrl(ref);
    else if (!ref && walkers.settings.subsAuto && subArt.length) pick[key] = walkerArtUrl(`subs:${subArt[walkerHash(key) % subArt.length]}`);
  }
  return {
    ok: true,
    settings: walkers.settings,
    art: art.map(f => `/decor-art/unicorn/${encodeURIComponent(f)}`),
    pick,                       // lowercase name -> chosen art
    seq: walkerSeq,
    events: walkerEvents.filter(e => e.seq > since),
    clearAt: walkers.clearAt || 0,
    tryAnim: walkerTry,
  };
}

function walkerAdminState() {
  const art = walkerArt();
  const names = new Map();
  for (const p of Object.values(walkers.people)) names.set(p.name.toLowerCase(), p.name);
  for (const e of Object.values(giveaway.entrants || {})) if (e && e.username && !names.has(e.username.toLowerCase())) names.set(e.username.toLowerCase(), e.username);
  const people = [...names.entries()].filter(([, n]) => !isBlocked(n)).map(([key, name]) => {
    const p = walkers.people[key] || {};
    return { name, isSub: walkerIsSub(name), override: p.allowed === undefined ? null : p.allowed, allowed: walkerAllowed(name), art: p.art || null, personal: p.personal || null, lastSeen: p.lastSeen || null };
  }).sort((a, b) => (b.allowed - a.allowed) || String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || a.name.localeCompare(b.name));
  return { ok: true, settings: walkers.settings, art, subArt: walkerSubArt(), people, fonts: WALKERS_FONTS, anims: WALKERS_ANIMS, entrances: WALKERS_ENTRANCES, exits: WALKERS_EXITS };
}

// ---------------------------------------------------------------------------
// BADGE VOTE (Baby, 2026-10-03) - post badge pictures, chat votes with
// "!vote 2" (several numbers allowed: "!vote 1 3"), "!unvote 2" takes one back.
// Each person can vote for several badges, once each. Subscribers' votes count
// double. Results can be shown or hidden on stream from the dashboard.
//   - Overlay:   /poll.html      - Dashboard: /poll-control.html
//   - Art:       assets/poll/    - Saved in data/poll.json
// ---------------------------------------------------------------------------
const POLL_FILE = path.join(DATA_DIR, 'poll.json');
const POLL_ART_DIR = path.join(APP_DIR, 'assets', 'poll');
try { fs.mkdirSync(POLL_ART_DIR, { recursive: true }); } catch (_error) {}
function pollDefaults() {
  return { title: 'Vote for the badges you want to earn!', options: [], open: false, showResults: false, endsAt: null,
    subWeight: 2, revealed: false, votes: {}, seq: 1 };
}
function pollLoad() {
  const raw = readJson(POLL_FILE, null) || {};
  const p = { ...pollDefaults(), ...raw };
  p.options = (Array.isArray(p.options) ? p.options : []).filter(o => o && o.id).map(o => ({ id: String(o.id).slice(0, 20), label: cleanString(o.label).slice(0, 60), image: o.image ? path.basename(String(o.image)) : null }));
  p.votes = p.votes && typeof p.votes === 'object' ? p.votes : {};
  p.subWeight = [1, 2, 3].includes(Number(p.subWeight)) ? Number(p.subWeight) : 2;
  return p;
}
let poll = pollLoad();
function pollSave() { writeJson(POLL_FILE, poll); broadcast('poll', pollPublic()); }
function pollIsOpen() { return poll.open && (!poll.endsAt || Date.now() < poll.endsAt); }
function pollResults() {
  const rows = poll.options.map((o, i) => ({ id: o.id, number: i + 1, label: o.label, image: o.image ? `/assets/poll/${encodeURIComponent(o.image)}` : null, points: 0, voters: 0, subVoters: 0 }));
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const v of Object.values(poll.votes)) {
    for (const id of v.picks || []) {
      const r = byId.get(id); if (!r) continue;
      r.voters += 1; if (v.sub) r.subVoters += 1;
      r.points += v.sub ? poll.subWeight : 1;
    }
  }
  const total = rows.reduce((a, r) => a + r.points, 0);
  const max = rows.reduce((a, r) => Math.max(a, r.points), 0);
  for (const r of rows) { r.percent = total ? Math.round(r.points / total * 100) : 0; r.leading = max > 0 && r.points === max; }
  return { rows, total, people: Object.keys(poll.votes).length };
}
function pollPublic() {
  const res = pollResults();
  return { ok: true, title: poll.title, open: pollIsOpen(), openFlag: poll.open, endsAt: poll.endsAt, now: Date.now(), showResults: poll.showResults, revealed: poll.revealed,
    subWeight: poll.subWeight, ...res };
}
function pollChat(name, parts) {
  if (!pollIsOpen()) return false;
  name = cleanString(name).replace(/^@/, '').slice(0, 40);
  if (!name || isBlocked(name)) return false;
  const text = (parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ').trim();
  const m = /^!(un)?vote\b(.*)$/i.exec(text);
  if (!m) return false;
  const nums = (m[2].match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= poll.options.length).slice(0, 20);
  if (!nums.length) return false;
  const key = name.toLowerCase();
  const v = poll.votes[key] || (poll.votes[key] = { name, picks: [], sub: false, at: 0 });
  v.name = name; v.sub = walkerIsSub(name); v.at = Date.now();
  for (const n of nums) {
    const id = poll.options[n - 1].id;
    if (m[1]) v.picks = v.picks.filter(x => x !== id);
    else if (!v.picks.includes(id)) v.picks.push(id);
  }
  if (!v.picks.length) delete poll.votes[key];
  pollSave();
  return true;
}
async function handlePollApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/poll' && method === 'GET') return sendJson(res, 200, pollPublic());
    if (pathname === '/api/poll/admin' && method === 'GET') {
      const voters = Object.values(poll.votes).map(v => ({ name: v.name, sub: v.sub, picks: v.picks.map(id => poll.options.findIndex(o => o.id === id) + 1).filter(n => n > 0) })).sort((a, b) => a.name.localeCompare(b.name));
      const art = (() => { try { return fs.readdirSync(POLL_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort(); } catch (_e) { return []; } })();
      return sendJson(res, 200, { ...pollPublic(), options: poll.options, voters, art });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
    if (pathname === '/api/poll/settings' && method !== 'GET') {
      if (typeof body.title === 'string') poll.title = cleanString(body.title).slice(0, 120);
      if (typeof body.showResults === 'boolean') poll.showResults = body.showResults;
      if ([1, 2, 3].includes(Number(body.subWeight))) poll.subWeight = Number(body.subWeight);
      pollSave(); return sendJson(res, 200, { ok: true });
    }
    // Badges: { options: [{id?, label, image}] } replaces the list (order = vote numbers).
    if (pathname === '/api/poll/options' && method !== 'GET') {
      if (!Array.isArray(body.options)) return sendJson(res, 400, { ok: false, error: 'options must be a list.' });
      const next = [];
      for (const o of body.options.slice(0, 30)) {
        if (!o) continue;
        const image = o.image ? path.basename(String(o.image)) : null;
        const id = (o.id && /^[a-z0-9]{1,20}$/i.test(String(o.id))) ? String(o.id) : `b${poll.seq++}`;
        next.push({ id, label: cleanString(o.label).slice(0, 60), image: image && fs.existsSync(path.join(POLL_ART_DIR, image)) ? image : null });
      }
      poll.options = next;
      const ids = new Set(next.map(o => o.id));
      for (const [k, v] of Object.entries(poll.votes)) { v.picks = (v.picks || []).filter(id => ids.has(id)); if (!v.picks.length) delete poll.votes[k]; }
      pollSave(); return sendJson(res, 200, { ok: true });
    }
    // Upload a badge picture: { dataUrl, name } -> adds a new badge with it.
    if (pathname === '/api/poll/image' && method === 'POST') {
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = tradeupSlug(String(body.name || 'badge').replace(/\.[a-z0-9]+$/i, ''));
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(POLL_ART_DIR, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(POLL_ART_DIR, filename), buffer);
      if (body.addBadge !== false && poll.options.length < 30) {
        const label = cleanString(body.label || String(body.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')).slice(0, 60);
        poll.options.push({ id: `b${poll.seq++}`, label, image: filename });
      }
      pollSave(); return sendJson(res, 200, { ok: true, file: filename });
    }
    // Open voting: { minutes } (0 or missing = no timer). Close: stops counting.
    if (pathname === '/api/poll/open' && method === 'POST') {
      if (!poll.options.length) return sendJson(res, 400, { ok: false, error: 'Add at least one badge first.' });
      const minutes = Number(body.minutes);
      poll.open = true; poll.revealed = false;
      poll.endsAt = Number.isFinite(minutes) && minutes > 0 ? Date.now() + Math.min(240, minutes) * 60000 : null;
      pollSave(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/poll/close' && method === 'POST') { poll.open = false; poll.endsAt = null; pollSave(); return sendJson(res, 200, { ok: true }); }
    if (pathname === '/api/poll/reveal' && method === 'POST') { poll.revealed = body.revealed !== false; if (poll.revealed) { poll.open = false; poll.endsAt = null; poll.showResults = true; } pollSave(); return sendJson(res, 200, { ok: true }); }
    if (pathname === '/api/poll/reset' && method === 'POST') { poll.votes = {}; poll.revealed = false; pollSave(); return sendJson(res, 200, { ok: true }); }
    // Test vote from the dashboard: { name, text }
    if (pathname === '/api/poll/test' && method === 'POST') {
      const ok = pollChat(cleanString(body.name) || 'TestViewer', [{ t: 'text', v: cleanString(body.text) || '!vote 1' }]);
      return sendJson(res, 200, { ok: true, counted: ok });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown poll route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Poll request failed.' });
  }
}
// The timer runs out even if nobody votes: tell the overlay/dashboard once.
setInterval(() => { if (poll.open && poll.endsAt && Date.now() >= poll.endsAt) { poll.open = false; poll.endsAt = null; pollSave(); } }, 1000);

// ---------------------------------------------------------------------------
// TEAM CONTEST (Baby, 2026-10-05) - grinding-party contest on stream.
// Chat joins with "!team a" (b, c, d... up to the number of teams set on the
// dashboard). Once on a team they're LOCKED - only Baby can move them.
// She picks ONE thing to count (e.g. command "cloth"); then "!cloth" = +1,
// "!cloth +2" = +2, "!cloth -1" = -1 (never below 0, no upper limit).
// Points are saved per item, so switching back to an old item brings its
// points back. Team totals = sum of their players.
//   - Overlay:   /teams.html      - Dashboard: /teams-control.html
//   - Saved in data/teams.json
// ---------------------------------------------------------------------------
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const TEAM_LETTERS = 'abcdefgh';
const TEAM_COLORS = ['#ff6fb5', '#5ec8ff', '#7ee081', '#ffd166', '#b77cff', '#ff9f5a', '#4ee6c8', '#ff5c6c'];
function teamsDefaults() {
  return {
    title: 'Grinding Party Contest!',
    teamCount: 2,
    teams: TEAM_LETTERS.split('').map((l, i) => ({ letter: l, name: `Team ${l.toUpperCase()}`, color: TEAM_COLORS[i] })),
    item: { command: 'cloth', aliases: '', label: 'Tattered Cloth', image: null },
    presets: [
      { command: 'cloth', aliases: '', label: 'Tattered Cloth', image: 'tattered_cloth.png' },
      { command: 'spore', aliases: 'spores', label: 'Shmole Spores', image: 'Shmole_Spores.png' },
      { command: 'plushie', aliases: 'plush', label: 'Plushies', image: null },
    ],
    joinOpen: true, counting: true, showPlayers: 8, showBanner: true, visible: true,
    players: {}, log: [], seq: 1,
  };
}
function teamsCleanCmd(v) { return cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24); }
function teamsCleanItem(o) {
  o = o || {};
  const image = o.image ? path.basename(String(o.image)) : null;
  return {
    command: teamsCleanCmd(o.command) || 'point',
    aliases: String(o.aliases || '').split(/[\s,]+/).map(teamsCleanCmd).filter(Boolean).slice(0, 6).join(', '),
    label: cleanString(o.label).slice(0, 60),
    image: image && DECOR_IMAGE_EXT.test(image) ? image : null,
  };
}
function teamsLoad() {
  const raw = readJson(TEAMS_FILE, null) || {};
  const d = teamsDefaults();
  const t = { ...d, ...raw };
  t.teamCount = Math.max(2, Math.min(8, Math.round(Number(t.teamCount) || 2)));
  t.teams = d.teams.map((def, i) => {
    const r = (Array.isArray(raw.teams) ? raw.teams : []).find(x => x && x.letter === def.letter) || {};
    return { letter: def.letter, name: cleanString(r.name).slice(0, 40) || def.name, color: /^#[0-9a-f]{6}$/i.test(String(r.color || '')) ? r.color : def.color };
  });
  t.item = teamsCleanItem(t.item);
  t.presets = (Array.isArray(t.presets) ? t.presets : []).slice(0, 30).map(teamsCleanItem);
  t.players = t.players && typeof t.players === 'object' ? t.players : {};
  for (const p of Object.values(t.players)) { if (!p.points || typeof p.points !== 'object') p.points = {}; }
  t.log = Array.isArray(t.log) ? t.log.slice(-200) : [];
  t.showPlayers = Math.max(0, Math.min(30, Math.round(Number(t.showPlayers)) || 0));
  return t;
}
let teams = teamsLoad();
function teamsSave() { writeJson(TEAMS_FILE, teams); broadcast('teams', teamsPublic()); }
function teamsActive() { return teams.teams.slice(0, teams.teamCount); }
function teamsBoard() {
  const cmd = teams.item.command;
  const board = teamsActive().map(tm => ({ letter: tm.letter, name: tm.name, color: tm.color, total: 0, players: [] }));
  const byLetter = new Map(board.map(b => [b.letter, b]));
  for (const p of Object.values(teams.players)) {
    const b = byLetter.get(p.team); if (!b) continue;
    const pts = Number(p.points[cmd]) || 0;
    b.players.push({ name: p.name, points: pts, joined: p.joined || 0 });
    b.total += pts;
  }
  for (const b of board) b.players.sort((x, y) => (y.points - x.points) || (x.joined - y.joined));
  const max = board.reduce((a, b) => Math.max(a, b.total), 0);
  for (const b of board) b.leading = max > 0 && b.total === max;
  return board;
}
function teamsPublic() {
  const item = teams.item;
  // If the picture is one of her tracker cards, reuse that card's number box so
  // the grand total sits right in the art's empty box.
  let valueBox = null;
  try { const c = item.image && (resourceTrackers.cards || []).find(x => x && x.image === item.image && x.valueBox); if (c) valueBox = c.valueBox; } catch (_e) {}
  return { ok: true, title: teams.title, teamCount: teams.teamCount, item: { ...item, imageUrl: item.image ? `/assets/resources/${encodeURIComponent(item.image)}` : null, valueBox },
    joinOpen: teams.joinOpen, counting: teams.counting, showPlayers: teams.showPlayers, showBanner: teams.showBanner, visible: teams.visible,
    board: teamsBoard(), recent: teams.log.slice(-12), now: Date.now() };
}
function teamsLog(entry) { entry.id = teams.seq++; entry.at = Date.now(); teams.log.push(entry); if (teams.log.length > 200) teams.log = teams.log.slice(-200); }
// Returns a short result string (for the dashboard's test box) or '' if ignored.
function teamsChat(name, parts) {
  name = cleanString(name).replace(/^@/, '').slice(0, 40);
  if (!name || isBlocked(name)) return '';
  const text = (parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ').trim();
  if (text[0] !== '!') return '';
  const key = name.toLowerCase();
  let m = /^!team\s+([a-h])\b/i.exec(text);
  if (m) {
    const letter = m[1].toLowerCase();
    if (TEAM_LETTERS.indexOf(letter) >= teams.teamCount) return `${name}: there is no team ${letter.toUpperCase()}`;
    const existing = teams.players[key];
    if (existing && existing.team) return `${name} is already on ${teamsName(existing.team)} (locked)`;
    if (!teams.joinOpen) return `${name}: joining is closed`;
    teams.players[key] = { name, team: letter, points: (existing && existing.points) || {}, joined: Date.now() };
    teamsLog({ kind: 'join', name, team: letter });
    teamsSave();
    return `${name} joined ${teamsName(letter)}`;
  }
  const cmds = [teams.item.command].concat(teams.item.aliases ? teams.item.aliases.split(/,\s*/) : []).filter(Boolean);
  m = /^!([a-z0-9_]+)(?:\s+([+-]?)\s*(\d{1,6}))?(?:\s|$)/i.exec(text);
  if (!m || cmds.indexOf(m[1].toLowerCase()) < 0) return '';
  if (!teams.counting) return `${name}: counting is paused`;
  const p = teams.players[key];
  if (!p || !p.team || TEAM_LETTERS.indexOf(p.team) >= teams.teamCount) return `${name} isn't on a team yet`;
  let amount = m[3] ? Number(m[3]) : 1;
  if (m[2] === '-') amount = -amount;
  if (!amount) return '';
  return teamsAdd(key, amount, 'chat');
}
function teamsName(letter) { const t = teams.teams.find(x => x.letter === letter); return t ? t.name : `Team ${String(letter).toUpperCase()}`; }
function teamsAdd(key, amount, how) {
  const p = teams.players[key]; if (!p) return '';
  const cmd = teams.item.command;
  const before = Number(p.points[cmd]) || 0;
  const after = Math.max(0, before + amount);
  const applied = after - before;
  if (!applied) return `${p.name} is already at 0`;
  p.points[cmd] = after;
  teamsLog({ kind: 'points', name: p.name, key, team: p.team, item: cmd, amount: applied, total: after, how });
  teamsSave();
  return `${p.name} ${applied > 0 ? '+' : ''}${applied} → ${after}`;
}
// ---------------------------------------------------------------------------
// EVENT TIME CONVERTER (Baby, 2026-10-06) - she types when an event happens
// (in her own time zone) and the overlay shows that same moment in each zone
// with its day, e.g. "PDT  Sat, Oct 10  5:00 PM". The server turns her wall
// time into one exact moment (epoch ms); the overlay formats it per zone with
// Intl, so daylight-saving changes (PDT -> PST) are handled automatically.
//   - Overlay:   /eventtime.html      - Dashboard: /eventtime-control.html
//   - Saved in data/eventtime.json
// ---------------------------------------------------------------------------
const EVENTTIME_FILE = path.join(DATA_DIR, 'eventtime.json');
function eventTimeDefaults() {
  return {
    title: 'Next Event', subtitle: '', date: '', time: '', sourceTz: 'America/Chicago', at: null,
    visible: true, showCountdown: true, layout: 'row',
    zones: [
      { label: '', tz: 'America/Los_Angeles', visible: true },
      { label: '', tz: 'America/Denver', visible: true },
      { label: '', tz: 'America/Chicago', visible: true },
      { label: '', tz: 'America/New_York', visible: true },
      { label: 'GMT +1', tz: 'Etc/GMT-1', visible: true },
      { label: 'GMT +2', tz: 'Etc/GMT-2', visible: true },
    ],
  };
}
function etValidTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true; } catch (_e) { return false; } }
// Offset (ms) of a zone at a given instant: wall-clock-as-UTC minus the instant.
function etOffset(ms, tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000;
}
// "2026-10-10" + "19:00" in America/Chicago -> exact epoch ms (or null).
function etToEpoch(date, time, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')); const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!d || !t || !etValidTz(tz)) return null;
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let ms = guess - etOffset(guess, tz);
  ms = guess - etOffset(ms, tz); // second pass settles DST edges
  return ms;
}
function eventTimeLoad() {
  const raw = readJson(EVENTTIME_FILE, null) || {};
  const e = { ...eventTimeDefaults(), ...raw };
  e.zones = (Array.isArray(e.zones) ? e.zones : eventTimeDefaults().zones).slice(0, 12)
    .filter(z => z && etValidTz(z.tz)).map(z => ({ label: cleanString(z.label).slice(0, 30), tz: String(z.tz), visible: z.visible !== false }));
  if (!etValidTz(e.sourceTz)) e.sourceTz = 'America/Chicago';
  return e;
}
let eventTime = eventTimeLoad();
function eventTimeSave() { writeJson(EVENTTIME_FILE, eventTime); broadcast('eventtime', { ...eventTime, ok: true, now: Date.now() }); }
async function handleEventTimeApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/eventtime' && method === 'GET') return sendJson(res, 200, { ok: true, ...eventTime, now: Date.now() });
    if (pathname === '/api/eventtime' && method === 'POST') {
      const b = await readBody(req);
      if (typeof b.title === 'string') eventTime.title = cleanString(b.title).slice(0, 80);
      if (typeof b.subtitle === 'string') eventTime.subtitle = cleanString(b.subtitle).slice(0, 120);
      if (typeof b.visible === 'boolean') eventTime.visible = b.visible;
      if (typeof b.showCountdown === 'boolean') eventTime.showCountdown = b.showCountdown;
      if (b.layout === 'row' || b.layout === 'column') eventTime.layout = b.layout;
      if (typeof b.sourceTz === 'string' && etValidTz(b.sourceTz)) eventTime.sourceTz = b.sourceTz;
      if (typeof b.date === 'string') eventTime.date = b.date.slice(0, 10);
      if (typeof b.time === 'string') eventTime.time = b.time.slice(0, 5);
      if (Array.isArray(b.zones)) {
        const z = b.zones.slice(0, 12).filter(x => x && etValidTz(x.tz)).map(x => ({ label: cleanString(x.label).slice(0, 30), tz: String(x.tz), visible: x.visible !== false }));
        if (z.length) eventTime.zones = z;
      }
      eventTime.at = etToEpoch(eventTime.date, eventTime.time, eventTime.sourceTz);
      if ((b.date || b.time) && eventTime.at === null) return sendJson(res, 400, { ok: false, error: 'Pick a date and a time.' });
      eventTimeSave();
      return sendJson(res, 200, { ok: true, ...eventTime, now: Date.now() });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown event time route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Event time request failed.' });
  }
}

// ---------------------------------------------------------------------------
// PARTY SIGN-UPS (Baby, 2026-10-06) - chat signs up for overprep roles at
// her Palia parties: "!tomato BabyPalia" puts their Palia name in the Tomato
// role. Roles only (no plain join). One sign-up per person: a different role
// command swaps them, "!leave" drops them. Each role has a spot limit she sets;
// once full, extra people go on that role's waitlist and move up when a spot
// opens. Several events can be saved; ONE is live (chat + overlay use it).
//   - Overlay:   /party.html      - Dashboard: /party-control.html
//   - Saved in data/parties.json
// ---------------------------------------------------------------------------
const PARTY_FILE = path.join(DATA_DIR, 'parties.json');
function partyCmd(v) { return cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24); }
const PARTY_RESERVED = new Set(['leave', 'team', 'vote', 'unvote', 'here', 'checkin', 'signin', 'party', 'show', 'hide']);
const PARTY_CHECKIN_CMDS = new Set(['here', 'checkin', 'signin']);
function partyNewEvent(seq) {
  return { id: `e${seq}`, title: 'Overprep Party', when: '', subtitle: '', open: true,
    roles: [
      { id: 'r1', command: 'tomato', label: 'Tomato', emoji: '🍅', spots: 2, group: 'Overprep', bring: '' },
      { id: 'r2', command: 'rice', label: 'Rice', emoji: '🍚', spots: 2, group: 'Overprep', bring: '' },
    ], signups: [], rseq: 3 };
}
function partyCleanRole(r, ev) {
  const id = r && /^r\d{1,5}$/.test(String(r.id || '')) ? String(r.id) : `r${ev.rseq++}`;
  return { id, command: partyCmd(r && r.command), label: cleanString(r && r.label).slice(0, 40), emoji: cleanString(r && r.emoji).slice(0, 8),
    spots: Math.max(1, Math.min(50, Math.round(Number(r && r.spots)) || 1)),
    // 2026-10-07: any kind of role, grouped into sections on the board (Overprep, Cooking,
    // Helpers...), plus what that role must bring - shown on stream under the role.
    group: cleanString(r && r.group).slice(0, 30),
    bring: cleanString(r && r.bring).slice(0, 200) };
}
function partyLoad() {
  const raw = readJson(PARTY_FILE, null);
  if (!raw || !Array.isArray(raw.events) || !raw.events.length) {
    return { seq: 2, liveId: 'e1', visible: true, showTwitch: false, names: {}, events: [partyNewEvent(1)], slots: ['e1', null, null, null, null, null, null] };
  }
  raw.names = raw.names && typeof raw.names === 'object' ? raw.names : {};
  for (const ev of raw.events) { ev.signups = Array.isArray(ev.signups) ? ev.signups : []; ev.roles = Array.isArray(ev.roles) ? ev.roles : []; ev.rseq = ev.rseq || 100; }
  if (!raw.events.some(e => e.id === raw.liveId)) raw.liveId = raw.events[0].id;
  // 2026-10-07: up to 7 boards live at once. slots[i] = event id shown on Board i+1 (null = empty).
  // Older saves had one liveId - it becomes Board 1.
  const ids = new Set(raw.events.map(e => e.id));
  raw.slots = Array.isArray(raw.slots) ? raw.slots.slice(0, PARTY_SLOTS).map(x => (x && ids.has(x) ? x : null)) : [raw.liveId];
  while (raw.slots.length < PARTY_SLOTS) raw.slots.push(null);
  return { visible: true, showTwitch: false, seq: 100, ...raw };
}
const PARTY_SLOTS = 7;
// Her own art per party (2026-10-07): pictures live in assets/party/ (upload on the dashboard or drop files in).
const PARTY_ART_DIR = path.join(APP_DIR, 'assets', 'party');
try { fs.mkdirSync(PARTY_ART_DIR, { recursive: true }); } catch (_error) {}
const partyArtUrl = f => (f ? `/assets/party/${encodeURIComponent(f)}` : null);
function partyArtFile(v) { const f = v ? path.basename(String(v)) : null; return f && DECOR_IMAGE_EXT.test(f) && fs.existsSync(path.join(PARTY_ART_DIR, f)) ? f : null; }
let parties = partyLoad();
// One-time import (2026-10-07): if data/party-seed.json exists, its events are ADDED (existing events
// and sign-ups are never touched) and put on the boards it names, then the file is renamed so it
// never imports twice. Lets Claude set up Baby's weekly parties while ICB is running.
(function partyImportSeed() {
  const file = path.join(DATA_DIR, 'party-seed.json');
  if (!fs.existsSync(file)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const se of (Array.isArray(seed.events) ? seed.events : []).slice(0, 20)) {
      const ev = partyNewEvent(parties.seq++);
      ev.title = cleanString(se.title).slice(0, 80) || ev.title;
      ev.when = cleanString(se.when).slice(0, 80);
      ev.subtitle = cleanString(se.subtitle).slice(0, 140);
      ev.open = se.open !== false;
      ev.roles = (Array.isArray(se.roles) ? se.roles : []).slice(0, 20).map(r => partyCleanRole({ ...r, id: undefined }, ev)).filter(r => r.command && !PARTY_RESERVED.has(r.command));
      for (const r of ev.roles) if (!r.label) r.label = r.command;
      parties.events.push(ev);
      const n = Math.round(Number(se.board));
      if (n >= 1 && n <= PARTY_SLOTS && !(se.boardIfEmpty && parties.slots[n - 1])) { parties.slots = parties.slots.map(x => (x === ev.id ? null : x)); parties.slots[n - 1] = ev.id; }
    }
    writeJson(PARTY_FILE, parties);
    fs.renameSync(file, path.join(DATA_DIR, `party-seed.imported-${Date.now()}.json`));
    console.log('[party] imported party-seed.json');
  } catch (error) { console.log('[party] party-seed.json not imported:', error.message); }
})();
// Board 1's event (kept for older callers) and every live board.
function partyLive() { return parties.events.find(e => e.id === parties.slots[0]) || parties.events.find(e => e.id === parties.liveId) || parties.events[0]; }
function partyLiveBoards() {
  const out = [];
  parties.slots.forEach((id, i) => { const ev = id && parties.events.find(e => e.id === id); if (ev && !out.some(o => o.ev === ev)) out.push({ slot: i + 1, ev }); });
  return out;
}
// How many live boards use each role command - shared ones get the board number added (e.g. !tomato3).
function partySharedCmds() {
  const count = {};
  // Only boards with sign-ups OPEN compete for a command, so closed nights don't force numbers.
  for (const { ev } of partyLiveBoards()) if (ev.open) for (const c of new Set(ev.roles.map(r => r.command).filter(Boolean))) count[c] = (count[c] || 0) + 1;
  return count;
}
// SPOTLIGHT board (2026-10-07): one extra Meld layer (/party.html?board=spot) that rotates through
// every live board; a viewer can type "!party 3" to pull Board 3 up for spotHoldSec so they can sign up.
let partySpot = { slot: null, until: 0, by: '' };
function partySpotRequest(n, by) {
  if (!(n >= 1 && n <= PARTY_SLOTS) || !parties.slots[n - 1]) return false;
  partySpot = { slot: n, until: Date.now() + (parties.spotHoldSec || 60) * 1000, by: by || '' };
  return true;
}
function partySpotSlot() {
  const live = partyLiveBoards().map(b => b.slot);
  if (!live.length) return null;
  if (partySpot.slot && Date.now() < partySpot.until && live.includes(partySpot.slot)) return partySpot.slot;
  const step = Math.max(5, parties.spotRotateSec || 20) * 1000;
  return live[Math.floor(Date.now() / step) % live.length];
}
function partySpotInfo() {
  const held = partySpot.slot && Date.now() < partySpot.until;
  return { slot: partySpotSlot(), held: !!held, by: held ? partySpot.by : '', leftSec: held ? Math.ceil((partySpot.until - Date.now()) / 1000) : 0,
    rotateSec: parties.spotRotateSec || 20, holdSec: parties.spotHoldSec || 60, chat: parties.spotChat !== false,
    boards: partyLiveBoards().map(b => ({ slot: b.slot, title: b.ev.title })) };
}
// "Hidden until chat asks" (2026-10-15): with parties.onDemand on, boards stay invisible until chat types
// "!show" / "!party" (all live boards) or "!show 3" / "!party 3" (Board 3), or someone signs up (showOnSignup).
const partyShowUntil = {};   // slot -> ms ; 'all' -> ms
let partyChatHidden = false;   // "!hide cake" from chat (2026-10-20)
function partyReveal(n, sec) {
  const until = Date.now() + (sec || parties.showSec || 30) * 1000;
  if (n === 'all') partyShowUntil.all = until; else if (n >= 1 && n <= PARTY_SLOTS) partyShowUntil[n] = until;
  broadcast('party', partyPublic());
}
function partyShown(n) {
  if (!parties.visible || partyChatHidden) return false;
  if (!parties.onDemand) return true;
  const now = Date.now();
  if (n === 'spot') return now < (partyShowUntil.all || 0) || !!(partySpot.slot && now < partySpot.until);
  return now < (partyShowUntil.all || 0) || now < (partyShowUntil[n] || 0);
}
function partySlotOf(evId) { const i = parties.slots.indexOf(evId); return i >= 0 ? i + 1 : null; }
// Who is in a role vs waiting: first `spots` sign-ups (by time) are in.
function partyView(ev) {
  const roles = ev.roles.map(r => {
    const list = ev.signups.filter(s => s.role === r.id).sort((a, b) => a.at - b.at);
    const pv = s => ({ twitch: s.twitch, palia: s.palia, in: !!s.checkedIn });
    return { ...r, collapsed: !!(ev.collapsed && ev.collapsed[r.id]), people: list.slice(0, r.spots).map(pv), waitlist: list.slice(r.spots).map(pv) };
  });
  const filled = roles.reduce((a, r) => a + r.people.length, 0);
  const spots = roles.reduce((a, r) => a + r.spots, 0);
  const checkedIn = ev.signups.filter(s => s.checkedIn).length;
  // The exact command chat should type on this board (board number added when another live board shares it).
  const slot = partySlotOf(ev.id), shared = partySharedCmds();
  for (const r of roles) r.cmdShown = slot && ev.open && shared[r.command] > 1 ? r.command + slot : r.command;
  return { id: ev.id, title: ev.title, when: ev.when, subtitle: ev.subtitle, open: ev.open, roles, filled, spots, checkedIn,
    startAt: Number(ev.startAt) || null, warnMin: Number(ev.warnMin) || 10, slot,
    art: { bg: partyArtUrl(ev.bgImage), title: partyArtUrl(ev.titleImage), fit: ev.bgFit === 'contain' ? 'contain' : 'cover',
      panel: ev.panel === undefined ? 86 : Number(ev.panel), roleCards: ev.roleCards === undefined ? 40 : Number(ev.roleCards), border: ev.border !== false,
      bgFile: ev.bgImage || null, titleFile: ev.titleImage || null } };
}
function partyPublic(slot) {
  const n = Math.max(1, Math.min(PARTY_SLOTS, Number(slot) || 1));
  const id = parties.slots[n - 1], ev = id && parties.events.find(e => e.id === id);
  return { ok: true, visible: partyShown(n), visibleSetting: parties.visible, chatHidden: partyChatHidden, onDemand: !!parties.onDemand, showTwitch: parties.showTwitch, board: n, empty: !ev, event: ev ? partyView(ev) : null, now: Date.now() };
}
function partySave() { writeJson(PARTY_FILE, parties); broadcast('party', partyPublic()); }
// Meld sends chat text HTML-encoded (an apostrophe arrives as &#39;) - turn it back into plain text.
function partyDecode(t) {
  return String(t || '').replace(/&#(\d{1,6});/g, (_m, n) => String.fromCodePoint(Math.min(0x10FFFF, Number(n))))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n) => String.fromCodePoint(Math.min(0x10FFFF, parseInt(n, 16))))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function partyChat(name, parts) {
  // NOTE: no isBlocked() here on purpose - the giveaway block list includes Baby herself
  // (IJustABabyTv), and she signs up for roles at her own parties (2026-10-07).
  name = cleanString(name).replace(/^@/, '').slice(0, 40);
  if (!name) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim();
  const m = /^!([a-z0-9_]+)\b\s*(.*)$/i.exec(text);
  if (!m) return '';
  const key = name.toLowerCase(); const cmd = m[1].toLowerCase();
  const boards = partyLiveBoards();
  // Sign in when they arrive: "!here" (or !checkin / !signin) - on every live board they're signed up for.
  if (PARTY_CHECKIN_CMDS.has(cmd)) {
    const mine = boards.map(b => b.ev.signups.find(x => x.key === key)).filter(Boolean);
    if (!mine.length) return `${name} isn't signed up for a role`;
    const fresh = mine.filter(x => !x.checkedIn);
    if (!fresh.length) return `${mine[0].palia} is already signed in`;
    for (const x of fresh) x.checkedIn = Date.now();
    partySave(); return `${fresh[0].palia} signed in ✅` + (fresh.length > 1 ? ` (${fresh.length} parties)` : '');
  }
  // "!party 3" (or !party3 / !show 3) puts Board 3 on the Spotlight layer for a while.
  const pm = /^(?:party|show)([1-7])?$/.exec(cmd);
  if (pm) {
    const n = Number(pm[1] || (/^\s*([1-7])\b/.exec(m[2]) || [])[1]);
    if (!n) { if (parties.onDemand && boards.length) { partyReveal('all'); return 'Showing the party boards'; } return ''; }
    if (parties.onDemand && parties.slots[n - 1]) partyReveal(n);
    if (parties.spotChat === false) return parties.onDemand ? `Showing Board ${n}` : '';
    return partySpotRequest(n, name) ? `Spotlight → Board ${n}` : `Board ${n} isn't live`;
  }
  // "!leave" drops them from every live board; "!leave3" only from Board 3.
  const lv = /^leave([1-7])?$/.exec(cmd);
  if (lv) {
    let removed = 0;
    for (const b of boards) {
      if (lv[1] && b.slot !== Number(lv[1])) continue;
      const before = b.ev.signups.length; b.ev.signups = b.ev.signups.filter(x => x.key !== key); removed += before - b.ev.signups.length;
    }
    if (!removed) return `${name} wasn't signed up`;
    partySave(); return `${name} left` + (removed > 1 ? ` ${removed} parties` : '');
  }
  // Which board? An exact command on a board whose command isn't shared, or "<command><board#>" (e.g. !tomato3).
  // A plain shared command (e.g. !tomato on two boards) goes to the lowest-numbered board that has it.
  let ev = null, role = null;
  // Prefer a board with sign-ups open; fall back to any board (so a closed board still says "closed").
  for (const b of boards.filter(x => x.ev.open).concat(boards.filter(x => !x.ev.open))) { const r = b.ev.roles.find(x => x.command && x.command === cmd); if (r) { ev = b.ev; role = r; break; } }
  if (!role) {
    const sm = /^([a-z0-9_]+?)([1-7])$/.exec(cmd);
    if (sm) { const b = boards.find(x => x.slot === Number(sm[2])); const r = b && b.ev.roles.find(x => x.command === sm[1]); if (r) { ev = b.ev; role = r; } }
  }
  if (!role) return '';
  if (!ev.open) return `${name}: sign-ups are closed`;
  let palia = cleanString(m[2]).replace(/[<>]/g, '').replace(/^\[|\]$/g, '').trim().slice(0, 32);
  if (!palia) palia = partyDecode(parties.names[key] || '') || name;
  parties.names[key] = palia;
  const existing = ev.signups.find(s => s.key === key);
  if (existing && existing.role === role.id) { existing.palia = palia; partySave(); return `${name} updated name to ${palia} (${role.label})`; }
  ev.signups = ev.signups.filter(s => s.key !== key);
  ev.signups.push({ key, twitch: name, palia, role: role.id, at: Date.now(), checkedIn: existing ? existing.checkedIn || null : null });
  if (parties.onDemand && parties.showOnSignup !== false) { const sl = partySlotOf(ev.id); if (sl) partyReveal(sl); }
  partySave();
  const pos = ev.signups.filter(s => s.role === role.id).length;
  return pos > role.spots ? `${palia} is on the ${role.label} waitlist (#${pos - role.spots})` : `${palia} signed up for ${role.label}`;
}
async function handlePartyApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/party' && method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const bq = String(q.get('board') || q.get('slot') || '');
      if (bq === 'spot' || bq === 'spotlight') {
        const sl = partySpotSlot();
        return sendJson(res, 200, { ...(sl ? partyPublic(sl) : { ok: true, showTwitch: parties.showTwitch, empty: true, event: null, now: Date.now() }), visible: partyShown('spot'), spot: partySpotInfo() });
      }
      let slot = Number(bq) || 1;
      if (q.get('event')) { const sl = partySlotOf(String(q.get('event'))); if (sl) slot = sl; }
      return sendJson(res, 200, partyPublic(slot));
    }
    if (pathname === '/api/party/admin' && method === 'GET') {
      const art = (() => { try { return fs.readdirSync(PARTY_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort((x, y) => x.localeCompare(y)); } catch (_e) { return []; } })();
      return sendJson(res, 200, { ...partyPublic(), visible: parties.visible, showSec: parties.showSec || 30, showOnSignup: parties.showOnSignup !== false, art, liveId: parties.slots[0] || null, slots: parties.slots, spot: partySpotInfo(),
        events: parties.events.map(e => ({ id: e.id, title: e.title, when: e.when, count: e.signups.length, slot: partySlotOf(e.id) })),
        full: parties.events.map(e => ({ ...partyView(e), signups: e.signups.slice().sort((a, b) => a.at - b.at) })) });
    }
    const b = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
    const findEv = id => parties.events.find(e => e.id === String(id || '')) || null;
    if (pathname === '/api/party/settings' && method === 'POST') {
      if (typeof b.visible === 'boolean') parties.visible = b.visible;
      if (typeof b.showTwitch === 'boolean') parties.showTwitch = b.showTwitch;
      if (b.liveId && findEv(b.liveId)) { parties.liveId = String(b.liveId); parties.slots[0] = String(b.liveId); }
      // Put an event on a board: { board: 1-7, eventId | null }. An event sits on one board at a time.
      if (b.board !== undefined) {
        const n = Math.round(Number(b.board));
        if (!(n >= 1 && n <= PARTY_SLOTS)) return sendJson(res, 400, { ok: false, error: 'Board must be 1-7.' });
        const id = b.eventId && findEv(b.eventId) ? String(b.eventId) : null;
        if (id) parties.slots = parties.slots.map(x => (x === id ? null : x));
        parties.slots[n - 1] = id;
        if (n === 1 && id) parties.liveId = id;
      }
      if (b.spotRotateSec !== undefined) parties.spotRotateSec = Math.max(5, Math.min(300, Math.round(Number(b.spotRotateSec)) || 20));
      if (b.spotHoldSec !== undefined) parties.spotHoldSec = Math.max(10, Math.min(600, Math.round(Number(b.spotHoldSec)) || 60));
      if (typeof b.spotChat === 'boolean') parties.spotChat = b.spotChat;
      if (b.spotShow !== undefined) partySpotRequest(Number(b.spotShow), 'dashboard');
      if (typeof b.onDemand === 'boolean') parties.onDemand = b.onDemand;
      if (typeof b.showOnSignup === 'boolean') parties.showOnSignup = b.showOnSignup;
      if (b.showSec !== undefined) parties.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { partyChatHidden = false; partyReveal(b.showNow === 'all' ? 'all' : Number(b.showNow)); }
      if (b.hideNow) { for (const k of Object.keys(partyShowUntil)) delete partyShowUntil[k]; partySpot.until = 0; partyChatHidden = true; }
      partySave(); return sendJson(res, 200, { ok: true });
    }
    // Create a new event: { copyFrom? } copies title/roles (not sign-ups).
    if (pathname === '/api/party/event/new' && method === 'POST') {
      const ev = partyNewEvent(parties.seq++);
      const src = findEv(b.copyFrom);
      if (src) { ev.title = src.title; ev.subtitle = src.subtitle; ev.roles = JSON.parse(JSON.stringify(src.roles)); ev.rseq = src.rseq;
        for (const k of ['bgImage', 'titleImage', 'bgFit', 'panel', 'roleCards', 'border']) if (src[k] !== undefined) ev[k] = src[k]; }
      parties.events.push(ev);
      if (b.makeLive) { const free = parties.slots.indexOf(null); if (free >= 0) parties.slots[free] = ev.id; }
      partySave(); return sendJson(res, 200, { ok: true, id: ev.id });
    }
    if (pathname === '/api/party/event' && method === 'POST') {
      const ev = findEv(b.id); if (!ev) return sendJson(res, 404, { ok: false, error: 'Event not found.' });
      if (b.delete) {
        if (parties.events.length <= 1) return sendJson(res, 400, { ok: false, error: 'Keep at least one event.' });
        parties.events = parties.events.filter(e => e !== ev);
        parties.slots = parties.slots.map(x => (x === ev.id ? null : x));
        if (parties.liveId === ev.id) parties.liveId = parties.slots.find(Boolean) || parties.events[0].id;
        partySave(); return sendJson(res, 200, { ok: true });
      }
      if (typeof b.title === 'string') ev.title = cleanString(b.title).slice(0, 80);
      if (typeof b.when === 'string') ev.when = cleanString(b.when).slice(0, 80);
      if (typeof b.subtitle === 'string') ev.subtitle = cleanString(b.subtitle).slice(0, 140);
      if (typeof b.open === 'boolean') ev.open = b.open;
      // Party countdown: startAt = exact moment (ms) the party starts, null = no countdown.
      // Names not signed in turn yellow `warnMin` minutes before, red once it starts.
      if (b.startAt !== undefined) ev.startAt = b.startAt === null ? null : (Number(b.startAt) > 0 ? Math.round(Number(b.startAt)) : null);
      if (b.warnMin !== undefined) ev.warnMin = Math.max(1, Math.min(120, Math.round(Number(b.warnMin)) || 10));
      if (b.resetCheckins) for (const x of ev.signups) x.checkedIn = null;
      // Art: background picture, title banner picture, fit, panel darkness % (0 = see-through), role card darkness %, border.
      if (b.bgImage !== undefined) ev.bgImage = partyArtFile(b.bgImage);
      if (b.titleImage !== undefined) ev.titleImage = partyArtFile(b.titleImage);
      if (b.bgFit === 'cover' || b.bgFit === 'contain') ev.bgFit = b.bgFit;
      if (b.panel !== undefined) ev.panel = Math.max(0, Math.min(100, Math.round(Number(b.panel)) || 0));
      if (b.roleCards !== undefined) ev.roleCards = Math.max(0, Math.min(100, Math.round(Number(b.roleCards)) || 0));
      if (typeof b.border === 'boolean') ev.border = b.border;
      if (b.artToAll) { for (const o of parties.events) for (const k of ['bgImage', 'titleImage', 'bgFit', 'panel', 'roleCards', 'border']) o[k] = ev[k]; }
      if (Array.isArray(b.roles)) {
        const roles = b.roles.slice(0, 20).map(r => partyCleanRole(r, ev)).filter(r => r.command && !PARTY_RESERVED.has(r.command));
        const seen = new Set(); const dup = roles.find(r => { if (seen.has(r.command)) return true; seen.add(r.command); return false; });
        if (dup) return sendJson(res, 400, { ok: false, error: `Two roles use !${dup.command}.` });
        for (const r of roles) if (!r.label) r.label = r.command;
        ev.roles = roles;
        const ids = new Set(roles.map(r => r.id));
        ev.signups = ev.signups.filter(s => ids.has(s.role));
      }
      if (b.clearSignups) ev.signups = [];
      partySave(); return sendJson(res, 200, { ok: true });
    }
    // Her edits to one person: { id (event), key, role?, palia?, remove? } or add { id, twitch, palia, role }.
    if (pathname === '/api/party/signup' && method === 'POST') {
      const ev = findEv(b.id); if (!ev) return sendJson(res, 404, { ok: false, error: 'Event not found.' });
      const key = cleanString(b.key || b.twitch).replace(/^@/, '').toLowerCase().slice(0, 40);
      if (!key) return sendJson(res, 400, { ok: false, error: 'Name needed.' });
      let s = ev.signups.find(x => x.key === key);
      if (b.remove) { ev.signups = ev.signups.filter(x => x.key !== key); partySave(); return sendJson(res, 200, { ok: true }); }
      const role = b.role ? ev.roles.find(r => r.id === b.role) : null;
      if (!s) {
        if (!role) return sendJson(res, 400, { ok: false, error: 'Pick a role.' });
        const twitch = cleanString(b.twitch).replace(/^@/, '').slice(0, 40);
        s = { key, twitch, palia: cleanString(b.palia).slice(0, 32) || twitch, role: role.id, at: Date.now() };
        ev.signups.push(s);
      } else {
        if (role && role.id !== s.role) { s.role = role.id; s.at = Date.now(); }
        if (typeof b.palia === 'string' && cleanString(b.palia)) s.palia = cleanString(b.palia).slice(0, 32);
        if (b.top) s.at = Math.min(...ev.signups.map(x => x.at)) - 1; // move to the front of the role (off the waitlist)
        if (typeof b.checkedIn === 'boolean') s.checkedIn = b.checkedIn ? Date.now() : null;
      }
      partySave(); return sendJson(res, 200, { ok: true });
    }
    // Fold / unfold role panels on stream (2026-10-07): { id: eventId, roleId, collapsed? } toggles one;
    // { id, all: true|false } folds or opens every role. Clicking a role header on the Meld board calls this too.
    if (pathname === '/api/party/collapse' && method === 'POST') {
      const ev = findEv(b.id); if (!ev) return sendJson(res, 404, { ok: false, error: 'Event not found.' });
      ev.collapsed = ev.collapsed && typeof ev.collapsed === 'object' ? ev.collapsed : {};
      if (typeof b.all === 'boolean') { ev.collapsed = {}; if (b.all) for (const r of ev.roles) ev.collapsed[r.id] = true; }
      else {
        const r = ev.roles.find(x => x.id === String(b.roleId || '')); if (!r) return sendJson(res, 404, { ok: false, error: 'Role not found.' });
        const want = typeof b.collapsed === 'boolean' ? b.collapsed : !ev.collapsed[r.id];
        if (want) ev.collapsed[r.id] = true; else delete ev.collapsed[r.id];
      }
      partySave(); return sendJson(res, 200, { ok: true });
    }
    // Upload a picture for party boards: { dataUrl, name } -> assets/party/<name>.png
    if (pathname === '/api/party/image' && method === 'POST') {
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 9 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Picture is too large (max 8MB) - the dashboard shrinks big pictures automatically.' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = tradeupSlug(String(b.name || 'party-art').replace(/\.[a-z0-9]+$/i, '')) || 'party-art';
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(PARTY_ART_DIR, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(PARTY_ART_DIR, filename), buffer);
      return sendJson(res, 200, { ok: true, file: filename });
    }
    if (pathname === '/api/party/test' && method === 'POST') {
      const r = partyChat(cleanString(b.name) || 'TestViewer', [{ t: 'text', v: cleanString(b.text) }]);
      return sendJson(res, 200, { ok: true, result: r || 'ignored (not a sign-up command on any live board)' });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown party route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Party request failed.' });
  }
}

// ---------------------------------------------------------------------------
// STEAM ACHIEVEMENTS (Baby, 2026-10-07) - Aniimo writes no gameplay events to
// its logs, so ICB reads her Steam achievements through Steam's official Web
// API instead (allowed; no game memory/network touching). Polls every N sec;
// a newly unlocked achievement becomes an on-stream pop-up. Needs her own free
// Steam Web API key + SteamID, and "Game details" set to Public on Steam.
//   - Overlays: /steam.html?view=popup | ?view=progress | ?view=both
//   - Dashboard: /steam-control.html     - Saved in data/steam.json
//   The API key never leaves the server (overlays never see it).
// ---------------------------------------------------------------------------
const STEAM_FILE = path.join(DATA_DIR, 'steam.json');
const STEAM_API = process.env.ICB_STEAM_API_BASE || 'https://api.steampowered.com';
function steamDefaults() {
  return { apiKey: '', steamId: '', appId: 4126040, gameName: 'Aniimo', enabled: true, pollSec: 60, popupSec: 9, showRarity: true,
    progressTitle: 'Aniimo Achievements', pinnedStats: [], cardImage: null, cardBox: null, known: null, schema: {}, statDefs: {}, stats: {}, rarity: {},
    popups: [], seq: 1, lastPoll: null, lastOk: null, lastError: '', schemaAt: 0 };
}
function steamLoad() { const raw = readJson(STEAM_FILE, null) || {}; return { ...steamDefaults(), ...raw }; }
let steam = steamLoad();
function steamSave() { writeJson(STEAM_FILE, steam); broadcast('steam', steamPublic()); }
function steamGet(pathAndQuery) {
  const mod = STEAM_API.startsWith('https') ? require('https') : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(STEAM_API + pathAndQuery, { timeout: 15000, headers: { 'User-Agent': 'ICB-Clean' } }, (res) => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => { data += c; if (data.length > 5e6) req.destroy(new Error('Steam reply too large')); });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(data); } catch (_e) {}
        if (json && json.playerstats) return resolve(json); // e.g. 403 "Profile is not public" comes with a JSON reason
        if (res.statusCode === 403 || res.statusCode === 401) return reject(new Error('Steam rejected the API key (check it was copied fully).'));
        if (res.statusCode >= 400 && !(json && json.playerstats)) return reject(new Error(`Steam answered ${res.statusCode}.`));
        if (!json) return reject(new Error('Steam sent something unreadable.'));
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Steam took too long to answer.')));
    req.on('error', reject);
  });
}
const steamQ = (o) => '?' + Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
// Accepts a 17-digit SteamID64, a profile URL (/profiles/<id> or /id/<vanity>), or a bare vanity name.
async function steamResolveId(input) {
  const s = cleanString(input).trim();
  let m = /(\d{17})/.exec(s); if (m) return m[1];
  m = /steamcommunity\.com\/id\/([^\/?#\s]+)/i.exec(s);
  const vanity = m ? m[1] : (/^[A-Za-z0-9_-]{2,32}$/.test(s) ? s : '');
  if (!vanity) throw new Error('That doesn\'t look like a Steam profile link or ID.');
  if (!steam.apiKey) throw new Error('Add the API key first.');
  const r = await steamGet('/ISteamUser/ResolveVanityURL/v1/' + steamQ({ key: steam.apiKey, vanityurl: vanity }));
  if (r && r.response && r.response.success === 1 && r.response.steamid) return r.response.steamid;
  throw new Error('Steam couldn\'t find that profile name.');
}
async function steamLoadSchema(force) {
  if (!force && Object.keys(steam.schema).length && Date.now() - steam.schemaAt < 12 * 3600e3) return;
  const r = await steamGet('/ISteamUserStats/GetSchemaForGame/v2/' + steamQ({ key: steam.apiKey, appid: steam.appId, l: 'english' }));
  const g = (r && r.game) || {};
  const ach = (g.availableGameStats && g.availableGameStats.achievements) || [];
  const st = (g.availableGameStats && g.availableGameStats.stats) || [];
  if (g.gameName) steam.gameName = String(g.gameName).slice(0, 80);
  steam.schema = {};
  for (const a of ach) steam.schema[a.name] = { name: String(a.displayName || a.name).slice(0, 120), desc: String(a.description || '').slice(0, 300), icon: a.icon || '', iconGray: a.icongray || '', hidden: !!a.hidden };
  steam.statDefs = {};
  for (const s of st) steam.statDefs[s.name] = String(s.displayName || s.name).slice(0, 80);
  steam.schemaAt = Date.now();
  try {
    const p = await steamGet('/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/' + steamQ({ gameid: steam.appId }));
    const list = (p && p.achievementpercentages && p.achievementpercentages.achievements) || [];
    steam.rarity = {}; for (const a of list) steam.rarity[a.name] = Math.round(Number(a.percent) * 10) / 10;
  } catch (_e) { /* rarity is a nice-to-have */ }
}
let steamBusy = false;
async function steamPoll(force) {
  if (steamBusy) return { ok: false, error: 'Already checking.' };
  if (!steam.apiKey || !steam.steamId) return { ok: false, error: 'Add your API key and Steam profile first.' };
  steamBusy = true; steam.lastPoll = Date.now();
  try {
    await steamLoadSchema(force);
    const r = await steamGet('/ISteamUserStats/GetPlayerAchievements/v1/' + steamQ({ key: steam.apiKey, steamid: steam.steamId, appid: steam.appId }));
    const ps = r && r.playerstats;
    if (!ps || ps.success === false) {
      const why = String((ps && ps.error) || 'no data');
      throw new Error(/not public/i.test(why) ? 'Your Steam "Game details" are private - set them to Public (see step 3).' : /requested app has no stats/i.test(why) ? 'Steam says this game has no achievements for that account yet.' : `Steam: ${why}`);
    }
    const now = {};
    for (const a of ps.achievements || []) if (a.achieved) now[a.apiname] = Number(a.unlocktime) || Math.floor(Date.now() / 1000);
    if (steam.known && typeof steam.known === 'object') {
      for (const [api, t] of Object.entries(now)) if (!(api in steam.known)) {
        steam.popups.push({ id: steam.seq++, apiname: api, unlocktime: t, at: Date.now() });
        logActivity({ type: 'steam_achievement', game: steam.gameName, name: (steam.schema[api] || {}).name || api });
      }
      if (steam.popups.length > 40) steam.popups = steam.popups.slice(-40);
    }
    steam.known = now; // first successful check = baseline, no pop-up flood
    try {
      const s = await steamGet('/ISteamUserStats/GetUserStatsForGame/v2/' + steamQ({ key: steam.apiKey, steamid: steam.steamId, appid: steam.appId }));
      const list = (s && s.playerstats && s.playerstats.stats) || [];
      steam.stats = {}; for (const x of list) steam.stats[x.name] = Number(x.value) || 0;
    } catch (_e) { /* many games publish no stats - fine */ }
    steam.lastOk = Date.now(); steam.lastError = '';
    steamSave();
    return { ok: true };
  } catch (error) {
    steam.lastError = error.message || 'Steam check failed.'; steamSave();
    return { ok: false, error: steam.lastError };
  } finally { steamBusy = false; }
}
function steamAch(api) {
  const s = steam.schema[api] || {};
  return { apiname: api, name: s.name || api, desc: s.desc || '', icon: s.icon || '', rarity: steam.rarity[api] === undefined ? null : steam.rarity[api] };
}
function steamPublic() {
  const total = Object.keys(steam.schema).length;
  const known = steam.known || {};
  const recent = Object.entries(known).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([api, t]) => ({ ...steamAch(api), unlocktime: t }));
  const stats = (steam.pinnedStats || []).filter(p => p && p.name in steam.stats).map(p => ({ name: p.name, label: p.label || steam.statDefs[p.name] || p.name, value: steam.stats[p.name] }));
  return { ok: true, configured: !!(steam.apiKey && steam.steamId), connected: !!steam.lastOk && !steam.lastError, gameName: steam.gameName, title: steam.progressTitle,
    total, unlocked: Object.keys(known).length, recent, stats, popupSec: steam.popupSec, showRarity: steam.showRarity,
    popups: steam.popups.slice(-10).map(p => ({ id: p.id, at: p.at, test: !!p.test, ...steamAch(p.apiname) })),
    card: steam.cardImage ? { url: `/assets/resources/${encodeURIComponent(steam.cardImage)}`, box: steam.cardBox || { left: 25, top: 60, width: 50, height: 25 } } : null, now: Date.now() };
}
setInterval(() => { if (steam.enabled && steam.apiKey && steam.steamId && (!steam.lastPoll || Date.now() - steam.lastPoll >= Math.max(30, steam.pollSec) * 1000)) steamPoll(false).catch(() => {}); }, 5000);
async function handleSteamApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/steam' && method === 'GET') return sendJson(res, 200, steamPublic());
    if (pathname === '/api/steam/admin' && method === 'GET') {
      const known = steam.known || {};
      const achievements = Object.keys(steam.schema).map(api => ({ ...steamAch(api), unlocked: api in known, unlocktime: known[api] || null, hidden: steam.schema[api].hidden }))
        .sort((a, b) => (b.unlocked - a.unlocked) || ((b.unlocktime || 0) - (a.unlocktime || 0)) || ((b.rarity || 0) - (a.rarity || 0)));
      const stats = Object.keys(steam.stats).map(n => ({ name: n, label: steam.statDefs[n] || n, value: steam.stats[n], pinned: (steam.pinnedStats || []).some(p => p.name === n) }));
      const art = (() => { try { return fs.readdirSync(RESOURCE_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort((a, c) => a.localeCompare(c)); } catch (_e) { return []; } })();
      return sendJson(res, 200, { ...steamPublic(), art, cardImage: steam.cardImage, cardBox: steam.cardBox, keySet: !!steam.apiKey, keyHint: steam.apiKey ? '••••' + steam.apiKey.slice(-4) : '', steamId: steam.steamId, appId: steam.appId,
        enabled: steam.enabled, pollSec: steam.pollSec, lastPoll: steam.lastPoll, lastOk: steam.lastOk, lastError: steam.lastError, achievements, statList: stats, pinnedStats: steam.pinnedStats });
    }
    const b = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
    if (pathname === '/api/steam/settings' && method === 'POST') {
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
        const k = b.apiKey.trim();
        if (!/^[A-F0-9]{32}$/i.test(k)) return sendJson(res, 400, { ok: false, error: 'A Steam API key is 32 letters/numbers - check it was copied fully.' });
        steam.apiKey = k.toUpperCase(); steam.schemaAt = 0;
      }
      if (typeof b.steamId === 'string' && b.steamId.trim()) {
        const id = await steamResolveId(b.steamId);
        if (id !== steam.steamId) { steam.steamId = id; steam.known = null; steam.popups = []; }
      }
      if (b.appId !== undefined && /^\d{1,10}$/.test(String(b.appId)) && Number(b.appId) !== steam.appId) { steam.appId = Number(b.appId); steam.schema = {}; steam.schemaAt = 0; steam.known = null; steam.popups = []; steam.stats = {}; }
      if (typeof b.enabled === 'boolean') steam.enabled = b.enabled;
      if (typeof b.showRarity === 'boolean') steam.showRarity = b.showRarity;
      if (b.pollSec !== undefined) steam.pollSec = Math.max(30, Math.min(600, Math.round(Number(b.pollSec)) || 60));
      if (b.popupSec !== undefined) steam.popupSec = Math.max(3, Math.min(30, Math.round(Number(b.popupSec)) || 9));
      if (typeof b.progressTitle === 'string') steam.progressTitle = cleanString(b.progressTitle).slice(0, 80);
      // Her own art card for the progress count (like the Palia tracker cards).
      if (b.cardImage !== undefined) { const f = b.cardImage ? path.basename(String(b.cardImage)) : null; steam.cardImage = f && DECOR_IMAGE_EXT.test(f) && fs.existsSync(path.join(RESOURCE_ART_DIR, f)) ? f : null; }
      if (b.cardBox && typeof b.cardBox === 'object') { const n = k => Math.max(0, Math.min(100, Number(b.cardBox[k]) || 0)); steam.cardBox = { left: n('left'), top: n('top'), width: n('width') || 50, height: n('height') || 25 }; }
      if (Array.isArray(b.pinnedStats)) steam.pinnedStats = b.pinnedStats.slice(0, 6).filter(p => p && typeof p.name === 'string').map(p => ({ name: p.name.slice(0, 80), label: cleanString(p.label).slice(0, 40) }));
      steamSave();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/steam/check' && method === 'POST') { const r = await steamPoll(true); return sendJson(res, r.ok ? 200 : 400, r); }
    if (pathname === '/api/steam/test-popup' && method === 'POST') {
      const api = steam.schema[b.apiname] ? b.apiname : Object.keys(steam.schema)[0];
      if (!api) return sendJson(res, 400, { ok: false, error: 'Connect to Steam first so ICB knows the achievement list.' });
      steam.popups.push({ id: steam.seq++, apiname: api, at: Date.now(), test: true }); steamSave();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/steam/forget' && method === 'POST') { steam.apiKey = ''; steam.known = null; steam.popups = []; steam.lastOk = null; steam.lastError = ''; steamSave(); return sendJson(res, 200, { ok: true }); }
    return sendJson(res, 404, { ok: false, error: 'Unknown steam route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Steam request failed.' });
  }
}

// ---------------------------------------------------------------------------
// NEWS TICKER (Baby, 2026-10-08) - a full-width bar along the bottom of the
// stream that scrolls her messages one after another, forever. Separate from
// the older framed "Ticker Banner" (/ticker.html). She edits everything on the
// dashboard: messages (add / reorder / turn off), a label pill ("📰 NEWS"),
// colours, speed, size, and a one-off ALERT that takes over the bar for a while.
//   - Overlay:   /newsticker.html      - Dashboard: /newsticker-control.html
//   - Saved in data/newsticker.json
// ---------------------------------------------------------------------------
const NEWS_FILE = path.join(DATA_DIR, 'newsticker.json');
function newsDefaults() {
  return { visible: true, label: '📰 NEWS', showLabel: true, separator: '✦', speed: 110, gap: 1,
    barColor: '#1c0e28', barOpacity: 88, textColor: '#ffffff', labelColor: '#ff8fd8', labelText: '#1b0f2a', accent: '#b77cff', font: 34,
    messages: [{ id: 'm1', text: 'Welcome to ijustababyTv! 🦄', on: true }], seq: 2,
    alert: { text: '', until: 0, color: '#ff4655' } };
}
const newsHex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : null);
function newsLoad() { const raw = readJson(NEWS_FILE, null) || {}; const d = newsDefaults(); return { ...d, ...raw, alert: { ...d.alert, ...(raw.alert || {}) } }; }
let news = newsLoad();
function newsPublic() {
  const alertOn = !!(news.alert.text && Date.now() < news.alert.until);
  return { ok: true, visible: news.visible, label: news.label, showLabel: news.showLabel, separator: news.separator, speed: news.speed, gap: news.gap === undefined ? 1 : news.gap,
    barColor: news.barColor, barOpacity: news.barOpacity, textColor: news.textColor, labelColor: news.labelColor, labelText: news.labelText, accent: news.accent, font: news.font,
    messages: news.messages.filter(m => m.on && m.text).map(m => m.text),
    alert: alertOn ? { text: news.alert.text, color: news.alert.color, leftSec: Math.ceil((news.alert.until - Date.now()) / 1000) } : null, now: Date.now() };
}
function newsSave() { writeJson(NEWS_FILE, news); broadcast('newsticker', newsPublic()); }
async function handleNewsApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/newsticker' && method === 'GET') return sendJson(res, 200, newsPublic());
    if (pathname === '/api/newsticker/admin' && method === 'GET') return sendJson(res, 200, { ...newsPublic(), all: news.messages, alertRaw: news.alert });
    if (pathname === '/api/newsticker' && method === 'POST') {
      const b = await readBody(req);
      if (typeof b.visible === 'boolean') news.visible = b.visible;
      if (typeof b.showLabel === 'boolean') news.showLabel = b.showLabel;
      if (typeof b.label === 'string') news.label = cleanString(b.label).slice(0, 40);
      if (typeof b.separator === 'string') news.separator = cleanString(b.separator).slice(0, 8);
      if (b.speed !== undefined) news.speed = Math.max(20, Math.min(600, Math.round(Number(b.speed)) || 110));
      // Seconds the bar stays empty after a message has fully left the screen (2026-10-09: one message at a time).
      if (b.gap !== undefined) news.gap = Math.max(0, Math.min(30, Math.round(Number(b.gap) * 10) / 10 || 0));
      if (b.font !== undefined) news.font = Math.max(14, Math.min(90, Math.round(Number(b.font)) || 34));
      if (b.barOpacity !== undefined) news.barOpacity = Math.max(0, Math.min(100, Math.round(Number(b.barOpacity)) || 0));
      for (const k of ['barColor', 'textColor', 'labelColor', 'labelText', 'accent']) if (b[k] !== undefined && newsHex(b[k])) news[k] = b[k];
      if (Array.isArray(b.messages)) {
        news.messages = b.messages.slice(0, 40).map(m => ({ id: m && /^m\d{1,6}$/.test(String(m.id || '')) ? String(m.id) : `m${news.seq++}`,
          text: cleanString(m && m.text).slice(0, 300), on: !(m && m.on === false) })).filter(m => m.text);
      }
      // Alert: { alert: { text, seconds, color } } shows instead of the messages; { alert: null } stops it.
      if (b.alert === null) news.alert.until = 0;
      else if (b.alert && typeof b.alert === 'object') {
        const t = cleanString(b.alert.text).slice(0, 300);
        if (t) { news.alert.text = t; news.alert.until = Date.now() + Math.max(5, Math.min(3600, Math.round(Number(b.alert.seconds)) || 60)) * 1000; }
        if (newsHex(b.alert.color)) news.alert.color = b.alert.color;
      }
      newsSave(); return sendJson(res, 200, { ok: true, ...newsPublic() });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown news ticker route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'News ticker request failed.' });
  }
}

// ---------------------------------------------------------------------------
// STREAM EVENT SIGN-UP (was "Sashimi Sign-Up"; Baby 2026-10-09 -> 2026-10-12 "like Sesh, but for stream").
// Each saved event has: name, description, a start time (date + time in her zone) shown converted
// into the world time zones she ticks, a live countdown, and OPTIONAL roles - each role has its
// own chat command (e.g. "!fish Moon Pie"), an optional number of spots and a waitlist past that.
//   - No roles on an event: chat signs up with "!" + Palia name (e.g. "!Moon Pie"), like before.
//   - With roles: "!<role command> PaliaName" (or just "!<role command>" = remembered / Twitch name).
//     Switching role = typing another role's command. One sign-up per Twitch account per event.
//   - "!leave" takes their own name off (even when sign-ups are closed).
//   - Each event has a GAME (Palia, Aniimo...). ICB remembers every viewer's in-game name per game
//     (sashi.names[gameKey][twitch]) the first time they sign up, so next time "!<role command>"
//     or "!signup" alone is enough.
// She sets up roles herself on the dashboard (never pre-fill or guess roles for her).
//   - Overlay:   /sashimi-signin.html      - Dashboard: /sashimi-signin-control.html  (names kept so Meld links still work)
//   - Saved in data/sashimi-signin.json (several saved events, one live)
// No isBlocked() on purpose: Baby can sign herself up too.
// ---------------------------------------------------------------------------
const SASHI_FILE = path.join(DATA_DIR, 'sashimi-signin.json');
const SASHI_BUILTIN_IGNORE = ['here', 'checkin', 'signin', 'leave', 'party', 'show', 'team', 'vote', 'unvote', 'lurk', 'unlurk', 'discord', 'socials',
  'so', 'shoutout', 'hug', 'commands', 'uptime', 'followage', 'raid', 'giveaway', 'enter', 'join', 'help', 'points', 'unicorns', 'jar', 'sashimi', 'sr', 'song', 'time', 'signup', 'need', 'dex', 'event', 'hide', 'burger', 'burgers', 'beanburger', 'flow', 'flowtree', 'flowtrees'];
const SASHI_RESERVED = new Set(['leave', 'here', 'checkin', 'signin', 'party', 'show', 'team', 'vote', 'unvote', 'signup', 'need', 'dex', 'event', 'hide', 'burger', 'burgers', 'beanburger', 'flow', 'flowtree', 'flowtrees']);
const sashiGameKey = g => (cleanString(g).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'palia').slice(0, 30);
// World clocks she can tick on the dashboard (shared by all events).
const SASHI_ZONE_PRESETS = [
  { label: 'Hawaii', tz: 'Pacific/Honolulu' }, { label: 'Alaska', tz: 'America/Anchorage' }, { label: 'Pacific', tz: 'America/Los_Angeles' },
  { label: 'Arizona', tz: 'America/Phoenix' }, { label: 'Mountain', tz: 'America/Denver' }, { label: 'Central', tz: 'America/Chicago' },
  { label: 'Eastern', tz: 'America/New_York' }, { label: 'Brazil', tz: 'America/Sao_Paulo' }, { label: 'UK', tz: 'Europe/London' },
  { label: 'Central Europe', tz: 'Europe/Berlin' }, { label: 'Eastern Europe', tz: 'Europe/Athens' }, { label: 'India', tz: 'Asia/Kolkata' },
  { label: 'Philippines', tz: 'Asia/Manila' }, { label: 'Japan', tz: 'Asia/Tokyo' }, { label: 'Sydney', tz: 'Australia/Sydney' }, { label: 'New Zealand', tz: 'Pacific/Auckland' }];
const SASHI_ZONE_DEFAULT_ON = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];
function sashiDefaults() {
  return { visible: true, open: true, live: 'e1', seq: 2, font: 26, cols: 2, title: '🍣 Sashimi Sign-Up', max: 0, ignore: '',
    accent: '#ff8fd8', panelColor: '#1c0e28', panelOpacity: 85, showZones: true, showCountdown: true, names: {}, rseq: 1,
    zones: SASHI_ZONE_PRESETS.map(z => ({ ...z, on: SASHI_ZONE_DEFAULT_ON.includes(z.tz) })),
    events: [{ id: 'e1', name: 'Friday Sashimi', guests: [] }] };
}
function sashiFixEvent(ev) {
  ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
  ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
  ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
  ev.date = typeof ev.date === 'string' ? ev.date : ''; ev.time = typeof ev.time === 'string' ? ev.time : '';
  ev.tz = etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
  ev.game = cleanString(ev.game).slice(0, 30) || 'Palia';
  for (const g of ev.guests) if (typeof g.role !== 'string' || !ev.roles.some(r => r.id === g.role)) g.role = '';
  return ev;
}
function sashiLoad() {
  const raw = readJson(SASHI_FILE, null) || {}; const s = { ...sashiDefaults(), ...raw };
  if (!Array.isArray(s.events) || !s.events.length) s.events = sashiDefaults().events;
  if (s.title === '🍣 Sashimi Sign-In') s.title = '🍣 Sashimi Sign-Up';
  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = sashiDefaults().zones;
  s.zones = s.zones.filter(z => z && etValidTz(z.tz));
  s.names = s.names && typeof s.names === 'object' ? s.names : {};
  // 2026-10-12: names are kept per game. Older saves had one flat {twitch: name} list - that was Palia.
  if (Object.keys(s.names).some(k => typeof s.names[k] === 'string')) {
    const flat = s.names; s.names = { palia: {} };
    for (const k of Object.keys(flat)) if (typeof flat[k] === 'string') s.names.palia[k] = flat[k]; else s.names[k] = flat[k];
  }
  s.events.forEach(sashiFixEvent);
  return s;
}
let sashi = sashiLoad();
const sashiEv = id => sashi.events.find(e => e.id === (id || sashi.live)) || null;
const sashiRenumber = ev => { ev.guests.forEach((g, i) => { g.n = i + 1; }); };
const sashiEpoch = ev => (ev && ev.date && ev.time ? etToEpoch(ev.date, ev.time, ev.tz) : null);
// "Hidden until chat asks" (2026-10-15): with sashi.onDemand on, the overlay stays invisible until chat types
// "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
let sashiShowUntil = 0;
let sashiChatHidden = false;   // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
function sashiReveal(sec) { sashiShowUntil = Date.now() + (sec || sashi.showSec || 30) * 1000; broadcast('sashimi', sashiPublic()); }
function sashiPublic() {
  const ev = sashiEv();
  return { ok: true, visible: sashi.visible && !sashiChatHidden && (!sashi.onDemand || Date.now() < sashiShowUntil), visibleSetting: sashi.visible, chatHidden: sashiChatHidden, onDemand: !!sashi.onDemand,
    showSec: sashi.showSec || 30, showOnSignup: sashi.showOnSignup !== false, shownLeft: sashi.onDemand ? Math.max(0, Math.ceil((sashiShowUntil - Date.now()) / 1000)) : 0, open: sashi.open, title: sashi.title, font: sashi.font, cols: sashi.cols, max: sashi.max,
    accent: sashi.accent, panelColor: sashi.panelColor, panelOpacity: sashi.panelOpacity, showZones: sashi.showZones, showCountdown: sashi.showCountdown,
    zones: sashi.zones.filter(z => z.on).map(z => ({ label: z.label, tz: z.tz })),
    event: ev ? { id: ev.id, name: ev.name, game: ev.game, desc: ev.desc, date: ev.date, time: ev.time, tz: ev.tz, start: sashiEpoch(ev),
      roles: ev.roles.map(r => ({ id: r.id, label: r.label, cmd: r.cmd, spots: r.spots || 0, color: r.color || '' })),
      guests: ev.guests.map(g => ({ n: g.n, name: g.name, twitch: g.twitch || '', at: g.at || 0, role: g.role || '' })) } : null,
    total: ev ? ev.guests.length : 0, now: Date.now() };
}
function sashiSave() { writeJson(SASHI_FILE, sashi); broadcast('sashimi', sashiPublic()); }
const sashiPop = () => { if (sashi.onDemand && sashi.showOnSignup !== false) sashiShowUntil = Math.max(sashiShowUntil, Date.now() + (sashi.showSec || 30) * 1000); };
const sashiCleanName = x => cleanString(x).replace(/^\s*\d+[.)\-:]\s+/, '').replace(/[<>]/g, '').trim().slice(0, 40);
const sashiCleanCmd = v => cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
function sashiAddNames(ev, names, role) {
  role = ev.roles.some(r => r.id === role) ? role : '';
  for (const raw of names) {
    const name = sashiCleanName(raw);
    if (!name || ev.guests.some(g => g.name.toLowerCase() === name.toLowerCase()) || ev.guests.length >= 200) continue;
    ev.guests.push({ n: 0, name, twitch: '', at: Date.now(), role });
  }
  sashiRenumber(ev);
}
// Every command word some other feature uses right now, so "!tomato" is never mistaken for a Palia name.
function sashiIgnored() {
  const set = new Set(SASHI_BUILTIN_IGNORE);
  for (const w of String(sashi.ignore || '').split(/[\s,]+/)) { const c = w.toLowerCase().replace(/^!+/, ''); if (c) set.add(c); }
  try { for (const b of partyLiveBoards()) for (const r of b.ev.roles) if (r.command) { set.add(r.command); for (let i = 1; i <= 7; i++) set.add(r.command + i); } } catch (_e) {}
  for (const c of signupRoleCmds()) set.add(c);
  try { [teams.item.command].concat(teams.item.aliases ? teams.item.aliases.split(/,\s*/) : []).forEach(c => { if (c) set.add(String(c).toLowerCase()); }); } catch (_e) {}
  return set;
}
// Party-board role commands that are live right now (to warn her about clashes).
function sashiPartyCmds() { const set = new Set(); try { for (const b of partyLiveBoards()) for (const r of b.ev.roles) if (r.command) set.add(r.command); } catch (_e) {} return set; }
function sashiNames(ev) { const k = sashiGameKey(ev.game); return sashi.names[k] || (sashi.names[k] = {}); }
// Remember their in-game name for this event's game (also for names she fixes on the dashboard).
function sashiRemember(ev, twitch, name) { if (twitch && name) sashiNames(ev)[String(twitch).toLowerCase()] = name; }
// A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
function sashiChatName(v) {
  const name = String(v || '').replace(/^\[|\]$/g, '').replace(/[<>]/g, '').trim();
  if (name.length < 2 || name.length > 32 || !/[a-z]/i.test(name) || name.split(' ').length > 3 || /@|https?:|www\./i.test(name)) return '';
  return name;
}
function sashiChat(sender, parts) {
  const twitch = cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!twitch) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
  const ev = sashiEv(); if (!ev) return '';
  const key = twitch.toLowerCase();
  // "!show" / "!event" pops the sign-up on screen when it's set to "hidden until chat asks".
  if (/^!(show|event)$/i.test(text)) { if (sashi.onDemand && sashi.visible) { sashiReveal(); return 'Showing the event sign-up'; } return ''; }
  // "!leave" takes their own name off the list (2026-10-11). Works even when sign-ups are closed.
  // (Party Sign-ups also hears !leave - that's fine, each only removes its own entries.)
  if (/^!leave$/i.test(text)) {
    const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
    if (!mine) return '';
    ev.guests = ev.guests.filter(g => g !== mine); sashiRenumber(ev); sashiSave();
    return `${mine.name} left`;
  }
  const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
  // ----- events WITH roles: "!<role command> [Palia name]" -----
  if (ev.roles.length) {
    const m = /^!([a-z0-9_]+)(?: (.+))?$/i.exec(text);
    if (!m) return '';
    const role = ev.roles.find(r => r.cmd === m[1].toLowerCase());
    if (!role) return '';
    if (!sashi.open) return `${twitch}: sign-ups are closed`;
    let name = m[2] ? sashiChatName(m[2]) : '';
    if (m[2] && !name) return '';
    if (!name) name = (mine && mine.name) || sashiNames(ev)[key] || twitch;
    const taken = ev.guests.find(g => g.name.toLowerCase() === name.toLowerCase() && g !== mine);
    if (taken) return `${name} is already signed up`;
    sashiRemember(ev, twitch, name);
    if (mine) {
      const moved = mine.role !== role.id;
      mine.name = name;
      if (moved) { mine.role = role.id; mine.at = Date.now(); ev.guests = ev.guests.filter(g => g !== mine).concat([mine]); sashiRenumber(ev); }
      sashiPop(); sashiSave(); return moved ? `${name} switched to ${role.label}` : `${name} updated`;
    }
    if (sashi.max && ev.guests.length >= sashi.max) return `Event is full (${sashi.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: role.id });
    sashiPop(); sashiSave();
    const pos = ev.guests.filter(g => g.role === role.id).length;
    return role.spots && pos > role.spots ? `${name} is on the ${role.label} waitlist (#${pos - role.spots})` : `${name} signed up for ${role.label}`;
  }
  // ----- events WITHOUT roles: "!Palia Name" (2026-10-10 / -11 rules) -----
  if (!sashi.open) return '';
  // "!signup" alone = use the name we remember for this game (from their first sign-up).
  if (/^!signup$/i.test(text)) {
    const known = sashiNames(ev)[key];
    if (!known) return `${twitch}: type ! + your ${ev.game} name the first time`;
    if (mine) return '';
    if (ev.guests.some(g => g.name.toLowerCase() === known.toLowerCase())) return `${known} is already signed up`;
    if (sashi.max && ev.guests.length >= sashi.max) return `Event is full (${sashi.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name: known, twitch, at: Date.now(), role: '' });
    sashiPop(); sashiSave(); return `${known} signed up (#${ev.guests.length})`;
  }
  const m = /^!([^\s!][^!]{0,31})$/.exec(text);
  if (!m) return '';
  const name = sashiChatName(m[1]);
  if (!name) return '';
  const low = name.toLowerCase(), first = low.split(' ')[0];
  // The first word decides whether it's another command ("!vote 2", "!tomato Kitsuu", "!hug Bob").
  const ign = sashiIgnored();
  if (ign.has(first) || ign.has(low) || /^(leave|party|show|here)\d*$/.test(first)) return '';
  const taken = ev.guests.find(g => g.name.toLowerCase() === low);
  if (taken) return taken.twitch.toLowerCase() === key ? '' : `${name} is already signed up`;
  sashiRemember(ev, twitch, name);
  if (mine) { mine.name = name; sashiPop(); sashiSave(); return `${twitch} changed their name to ${name} (#${mine.n})`; }
  if (sashi.max && ev.guests.length >= sashi.max) return `Event is full (${sashi.max})`;
  ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: '' });
  sashiPop(); sashiSave(); return `${name} signed up (#${ev.guests.length})`;
}
async function handleSashiApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/sashimi' && method === 'GET') return sendJson(res, 200, sashiPublic());
    if (pathname === '/api/sashimi/admin' && method === 'GET') {
      const ev = sashiEv(), pc = new Set([...sashiPartyCmds(), ...signupRoleCmds('sashi')]);
      return sendJson(res, 200, { ...sashiPublic(), visible: sashi.visible, live: sashi.live, ignore: sashi.ignore, builtinIgnore: SASHI_BUILTIN_IGNORE, allZones: sashi.zones,
        clashes: ev ? ev.roles.filter(r => pc.has(r.cmd)).map(r => r.cmd) : [],
        remembered: ev ? Object.entries(sashi.names[sashiGameKey(ev.game)] || {}).map(([twitch, name]) => ({ twitch, name })) : [],
        games: Array.from(new Set(sashi.events.map(e => e.game).concat(['Palia', 'Aniimo']))),
        events: sashi.events.map(e => ({ id: e.id, name: e.name, count: e.guests.length })) });
    }
    if (pathname === '/api/sashimi' && method === 'POST') {
      const b = await readBody(req);
      for (const k of ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup']) if (typeof b[k] === 'boolean') sashi[k] = b[k];
      if (b.showSec !== undefined) sashi.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { sashiChatHidden = false; sashiShowUntil = Date.now() + (sashi.showSec || 30) * 1000; }
      if (b.hideNow) { sashiShowUntil = 0; sashiChatHidden = true; }
      if (typeof b.title === 'string') sashi.title = cleanString(b.title).slice(0, 60);
      if (typeof b.ignore === 'string') sashi.ignore = cleanString(b.ignore).slice(0, 500);
      if (b.font !== undefined) sashi.font = Math.max(12, Math.min(70, Math.round(Number(b.font)) || 26));
      if (b.cols !== undefined) sashi.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
      if (b.max !== undefined) sashi.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
      if (b.panelOpacity !== undefined) sashi.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && newsHex(b[k])) sashi[k] = b[k];
      // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
      if (Array.isArray(b.zones)) {
        sashi.zones = b.zones.slice(0, 24).filter(z => z && etValidTz(z.tz)).map(z => ({ tz: String(z.tz), label: cleanString(z.label).slice(0, 24) || String(z.tz).split('/').pop().replace(/_/g, ' '), on: !!z.on }));
      }
      if (b.newEvent) { const id = `e${sashi.seq++}`; sashi.events.push(sashiFixEvent({ id, name: cleanString(b.newEvent).slice(0, 60) || 'Event', guests: [] })); sashi.live = id; }
      if (b.copyEvent) { // duplicate an event's details + roles (empty list) - handy for weekly repeats
        const src = sashiEv(String(b.copyEvent));
        if (src) { const id = `e${sashi.seq++}`; sashi.events.push(sashiFixEvent({ id, name: (src.name + ' (copy)').slice(0, 60), desc: src.desc, date: src.date, time: src.time, tz: src.tz, roles: JSON.parse(JSON.stringify(src.roles)), guests: [] })); sashi.live = id; }
      }
      if (b.live && sashiEv(String(b.live))) sashi.live = String(b.live);
      const ev = sashiEv(b.event ? String(b.event) : null);
      if (ev) {
        if (typeof b.name === 'string' && cleanString(b.name)) ev.name = cleanString(b.name).slice(0, 60);
        if (typeof b.game === 'string' && cleanString(b.game)) ev.game = cleanString(b.game).slice(0, 30);
        if (typeof b.desc === 'string') ev.desc = String(b.desc).replace(/[<>]/g, '').slice(0, 400);
        if (typeof b.date === 'string') ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
        if (typeof b.time === 'string') ev.time = /^\d{1,2}:\d{2}$/.test(b.time) ? b.time : '';
        if (typeof b.tz === 'string' && etValidTz(b.tz)) ev.tz = b.tz;
        // Roles (her own): full list [{id?, label, cmd, spots, color}] replaces the event's roles.
        if (Array.isArray(b.roles)) {
          const used = new Set(), out = [];
          for (const r of b.roles.slice(0, 12)) {
            const cmd = sashiCleanCmd(r && r.cmd), label = cleanString(r && r.label).slice(0, 40);
            if (!cmd || !label || used.has(cmd) || SASHI_RESERVED.has(cmd)) continue;
            used.add(cmd);
            const old = r.id && ev.roles.find(x => x.id === String(r.id));
            out.push({ id: old ? old.id : `r${sashi.rseq++}`, label, cmd, spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)), color: newsHex(r.color) || '' });
          }
          ev.roles = out; sashiFixEvent(ev);
        }
        if (Array.isArray(b.add)) sashiAddNames(ev, b.add, b.addRole);
        if (b.remove !== undefined) { ev.guests = ev.guests.filter(g => g.n !== Number(b.remove)); sashiRenumber(ev); }
        if (b.move && b.move.n) { const i = ev.guests.findIndex(g => g.n === Number(b.move.n)), j = i + (Number(b.move.dir) < 0 ? -1 : 1);
          if (i >= 0 && j >= 0 && j < ev.guests.length) { const t = ev.guests[i]; ev.guests[i] = ev.guests[j]; ev.guests[j] = t; sashiRenumber(ev); } }
        if (b.rename && b.rename.n) { const g = ev.guests.find(x => x.n === Number(b.rename.n)); const nn = sashiCleanName(b.rename.name); if (g && nn) { g.name = nn; sashiRemember(ev, g.twitch, nn); } }
        if (b.setRole && b.setRole.n) { const g = ev.guests.find(x => x.n === Number(b.setRole.n)); if (g) g.role = ev.roles.some(r => r.id === b.setRole.role) ? b.setRole.role : ''; }
        if (b.clear) ev.guests = [];
      }
      if (b.forget && b.forget.game && b.forget.twitch) { const m = sashi.names[sashiGameKey(b.forget.game)]; if (m) delete m[String(b.forget.twitch).toLowerCase()]; }
      if (b.deleteEvent && sashi.events.length > 1) {
        sashi.events = sashi.events.filter(e => e.id !== String(b.deleteEvent));
        if (!sashiEv()) sashi.live = sashi.events[0].id;
      }
      sashiSave(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/sashimi/test' && method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 200, { ok: true, reply: sashiChat(cleanString(b.name) || 'TestViewer', [{ t: 'text', v: cleanString(b.text) }]) || 'ignored' });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown sashimi route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Event sign-up request failed.' });
  }
}

// ---------------------------------------------------------------------------
// BEAN BURGER SIGN-UP (Baby, 2026-10-20): its own copy of the Poke Bowl Sign-up (STREAM EVENT SIGN-UP above),
// so changing this one never touches the others. Same features; generated from that section.
//   - Overlay: /beanburger-signup.html   - Dashboard: /beanburger-signup-control.html   - data/beanburger-signup.json
//   - Pops up (hidden-until-asked) with !burger / !burgers / !beanburger only. Remembered in-game names are
//     shared with the Poke Bowl Sign-up (sashi.names), so viewers only type their name once.
// ---------------------------------------------------------------------------
const BBSU_FILE = path.join(DATA_DIR, 'beanburger-signup.json');
function bbsuDefaults() {
  return { visible: true, open: true, live: 'e1', seq: 2, font: sashi.font || 26, cols: sashi.cols || 2, title: '🍔 Bean Burger Sign-Up', max: 0, ignore: '',
    accent: sashi.accent || '#ff8fd8', panelColor: sashi.panelColor || '#1c0e28', panelOpacity: sashi.panelOpacity === undefined ? 85 : sashi.panelOpacity, showZones: true, showCountdown: true, rseq: 1,
    onDemand: !!sashi.onDemand, showSec: sashi.showSec || 30, showOnSignup: sashi.showOnSignup !== false,
    zones: sashi.zones.map(z => ({ ...z })),
    events: [{ id: 'e1', name: 'Bean Burgers', guests: [] }] };
}
function bbsuFixEvent(ev) {
  ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
  ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
  ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
  ev.date = typeof ev.date === 'string' ? ev.date : ''; ev.time = typeof ev.time === 'string' ? ev.time : '';
  ev.tz = etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
  ev.game = cleanString(ev.game).slice(0, 30) || 'Palia';
  for (const g of ev.guests) if (typeof g.role !== 'string' || !ev.roles.some(r => r.id === g.role)) g.role = '';
  return ev;
}
function bbsuLoad() {
  const raw = readJson(BBSU_FILE, null) || {}; const s = { ...bbsuDefaults(), ...raw };
  if (!Array.isArray(s.events) || !s.events.length) s.events = bbsuDefaults().events;
  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = bbsuDefaults().zones;
  s.zones = s.zones.filter(z => z && etValidTz(z.tz));
  delete s.names;
  s.events.forEach(bbsuFixEvent);
  return s;
}
let bbsu = bbsuLoad();
const bbsuEv = id => bbsu.events.find(e => e.id === (id || bbsu.live)) || null;
const bbsuRenumber = ev => { ev.guests.forEach((g, i) => { g.n = i + 1; }); };
const bbsuEpoch = ev => (ev && ev.date && ev.time ? etToEpoch(ev.date, ev.time, ev.tz) : null);
// "Hidden until chat asks" (2026-10-15): with bbsu.onDemand on, the overlay stays invisible until chat types
// "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
let bbsuShowUntil = 0;
let bbsuChatHidden = false;   // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
function bbsuReveal(sec) { bbsuShowUntil = Date.now() + (sec || bbsu.showSec || 30) * 1000; broadcast('beanburger-signup', bbsuPublic()); }
function bbsuPublic() {
  const ev = bbsuEv();
  return { ok: true, visible: bbsu.visible && !bbsuChatHidden && (!bbsu.onDemand || Date.now() < bbsuShowUntil), visibleSetting: bbsu.visible, chatHidden: bbsuChatHidden, onDemand: !!bbsu.onDemand,
    showSec: bbsu.showSec || 30, showOnSignup: bbsu.showOnSignup !== false, shownLeft: bbsu.onDemand ? Math.max(0, Math.ceil((bbsuShowUntil - Date.now()) / 1000)) : 0, open: bbsu.open, title: bbsu.title, font: bbsu.font, cols: bbsu.cols, max: bbsu.max,
    accent: bbsu.accent, panelColor: bbsu.panelColor, panelOpacity: bbsu.panelOpacity, showZones: bbsu.showZones, showCountdown: bbsu.showCountdown,
    zones: bbsu.zones.filter(z => z.on).map(z => ({ label: z.label, tz: z.tz })),
    event: ev ? { id: ev.id, name: ev.name, game: ev.game, desc: ev.desc, date: ev.date, time: ev.time, tz: ev.tz, start: bbsuEpoch(ev),
      roles: ev.roles.map(r => ({ id: r.id, label: r.label, cmd: r.cmd, spots: r.spots || 0, color: r.color || '' })),
      guests: ev.guests.map(g => ({ n: g.n, name: g.name, twitch: g.twitch || '', at: g.at || 0, role: g.role || '' })) } : null,
    total: ev ? ev.guests.length : 0, now: Date.now() };
}
function bbsuSave() { writeJson(BBSU_FILE, bbsu); broadcast('beanburger-signup', bbsuPublic()); }
const bbsuPop = () => { if (bbsu.onDemand && bbsu.showOnSignup !== false) bbsuShowUntil = Math.max(bbsuShowUntil, Date.now() + (bbsu.showSec || 30) * 1000); };
const bbsuCleanName = x => cleanString(x).replace(/^\s*\d+[.)\-:]\s+/, '').replace(/[<>]/g, '').trim().slice(0, 40);
const bbsuCleanCmd = v => cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
function bbsuAddNames(ev, names, role) {
  role = ev.roles.some(r => r.id === role) ? role : '';
  for (const raw of names) {
    const name = bbsuCleanName(raw);
    if (!name || ev.guests.some(g => g.name.toLowerCase() === name.toLowerCase()) || ev.guests.length >= 200) continue;
    ev.guests.push({ n: 0, name, twitch: '', at: Date.now(), role });
  }
  bbsuRenumber(ev);
}
// Every command word some other feature uses right now, so "!tomato" is never mistaken for a Palia name.
function bbsuIgnored() {
  const set = new Set(SASHI_BUILTIN_IGNORE);
  for (const w of String(bbsu.ignore || '').split(/[\s,]+/)) { const c = w.toLowerCase().replace(/^!+/, ''); if (c) set.add(c); }
  try { for (const b of partyLiveBoards()) for (const r of b.ev.roles) if (r.command) { set.add(r.command); for (let i = 1; i <= 7; i++) set.add(r.command + i); } } catch (_e) {}
  for (const c of signupRoleCmds()) set.add(c);
  try { [teams.item.command].concat(teams.item.aliases ? teams.item.aliases.split(/,\s*/) : []).forEach(c => { if (c) set.add(String(c).toLowerCase()); }); } catch (_e) {}
  return set;
}
// Party-board role commands that are live right now (to warn her about clashes).
function bbsuPartyCmds() { const set = new Set(); try { for (const b of partyLiveBoards()) for (const r of b.ev.roles) if (r.command) set.add(r.command); } catch (_e) {} return set; }
function bbsuNames(ev) { const k = sashiGameKey(ev.game); return sashi.names[k] || (sashi.names[k] = {}); }
// Remember their in-game name for this event's game (also for names she fixes on the dashboard).
function bbsuRemember(ev, twitch, name) { if (twitch && name && bbsuNames(ev)[String(twitch).toLowerCase()] !== name) { bbsuNames(ev)[String(twitch).toLowerCase()] = name; writeJson(SASHI_FILE, sashi); } }
// A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
function bbsuChatName(v) {
  const name = String(v || '').replace(/^\[|\]$/g, '').replace(/[<>]/g, '').trim();
  if (name.length < 2 || name.length > 32 || !/[a-z]/i.test(name) || name.split(' ').length > 3 || /@|https?:|www\./i.test(name)) return '';
  return name;
}
function bbsuChat(sender, parts) {
  const twitch = cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!twitch) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
  const ev = bbsuEv(); if (!ev) return '';
  const key = twitch.toLowerCase();
  // "!show" / "!event" pops the sign-up on screen when it's set to "hidden until chat asks".
  if (/^!(burger|burgers|beanburger)$/i.test(text)) { if (bbsu.onDemand && bbsu.visible) { bbsuReveal(); return 'Showing the Bean Burger Sign-Up'; } return ''; }
  // "!leave" takes their own name off the list (2026-10-11). Works even when sign-ups are closed.
  // (Party Sign-ups also hears !leave - that's fine, each only removes its own entries.)
  if (/^!leave$/i.test(text)) {
    const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
    if (!mine) return '';
    ev.guests = ev.guests.filter(g => g !== mine); bbsuRenumber(ev); bbsuSave();
    return `${mine.name} left`;
  }
  const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
  // ----- events WITH roles: "!<role command> [Palia name]" -----
  if (ev.roles.length) {
    const m = /^!([a-z0-9_]+)(?: (.+))?$/i.exec(text);
    if (!m) return '';
    const role = ev.roles.find(r => r.cmd === m[1].toLowerCase());
    if (!role) return '';
    if (!bbsu.open) return `${twitch}: sign-ups are closed`;
    let name = m[2] ? bbsuChatName(m[2]) : '';
    if (m[2] && !name) return '';
    if (!name) name = (mine && mine.name) || bbsuNames(ev)[key] || twitch;
    const taken = ev.guests.find(g => g.name.toLowerCase() === name.toLowerCase() && g !== mine);
    if (taken) return `${name} is already signed up`;
    bbsuRemember(ev, twitch, name);
    if (mine) {
      const moved = mine.role !== role.id;
      mine.name = name;
      if (moved) { mine.role = role.id; mine.at = Date.now(); ev.guests = ev.guests.filter(g => g !== mine).concat([mine]); bbsuRenumber(ev); }
      bbsuPop(); bbsuSave(); return moved ? `${name} switched to ${role.label}` : `${name} updated`;
    }
    if (bbsu.max && ev.guests.length >= bbsu.max) return `Event is full (${bbsu.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: role.id });
    bbsuPop(); bbsuSave();
    const pos = ev.guests.filter(g => g.role === role.id).length;
    return role.spots && pos > role.spots ? `${name} is on the ${role.label} waitlist (#${pos - role.spots})` : `${name} signed up for ${role.label}`;
  }
  // ----- events WITHOUT roles: "!Palia Name" (2026-10-10 / -11 rules) -----
  if (!bbsu.open) return '';
  // "!signup" alone = use the name we remember for this game (from their first sign-up).
  if (/^!signup$/i.test(text)) {
    const known = bbsuNames(ev)[key];
    if (!known) return `${twitch}: type ! + your ${ev.game} name the first time`;
    if (mine) return '';
    if (ev.guests.some(g => g.name.toLowerCase() === known.toLowerCase())) return `${known} is already signed up`;
    if (bbsu.max && ev.guests.length >= bbsu.max) return `Event is full (${bbsu.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name: known, twitch, at: Date.now(), role: '' });
    bbsuPop(); bbsuSave(); return `${known} signed up (#${ev.guests.length})`;
  }
  const m = /^!([^\s!][^!]{0,31})$/.exec(text);
  if (!m) return '';
  const name = bbsuChatName(m[1]);
  if (!name) return '';
  const low = name.toLowerCase(), first = low.split(' ')[0];
  // The first word decides whether it's another command ("!vote 2", "!tomato Kitsuu", "!hug Bob").
  const ign = bbsuIgnored();
  if (ign.has(first) || ign.has(low) || /^(leave|party|show|here)\d*$/.test(first)) return '';
  const taken = ev.guests.find(g => g.name.toLowerCase() === low);
  if (taken) return taken.twitch.toLowerCase() === key ? '' : `${name} is already signed up`;
  bbsuRemember(ev, twitch, name);
  if (mine) { mine.name = name; bbsuPop(); bbsuSave(); return `${twitch} changed their name to ${name} (#${mine.n})`; }
  if (bbsu.max && ev.guests.length >= bbsu.max) return `Event is full (${bbsu.max})`;
  ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: '' });
  bbsuPop(); bbsuSave(); return `${name} signed up (#${ev.guests.length})`;
}
async function handleBbsuApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/beanburger-signup' && method === 'GET') return sendJson(res, 200, bbsuPublic());
    if (pathname === '/api/beanburger-signup/admin' && method === 'GET') {
      const ev = bbsuEv(), pc = new Set([...bbsuPartyCmds(), ...signupRoleCmds('bbsu')]);
      return sendJson(res, 200, { ...bbsuPublic(), visible: bbsu.visible, live: bbsu.live, ignore: bbsu.ignore, builtinIgnore: SASHI_BUILTIN_IGNORE, allZones: bbsu.zones,
        clashes: ev ? ev.roles.filter(r => pc.has(r.cmd)).map(r => r.cmd) : [],
        remembered: ev ? Object.entries(sashi.names[sashiGameKey(ev.game)] || {}).map(([twitch, name]) => ({ twitch, name })) : [],
        games: Array.from(new Set(bbsu.events.map(e => e.game).concat(['Palia', 'Aniimo']))),
        events: bbsu.events.map(e => ({ id: e.id, name: e.name, count: e.guests.length })) });
    }
    if (pathname === '/api/beanburger-signup' && method === 'POST') {
      const b = await readBody(req);
      for (const k of ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup']) if (typeof b[k] === 'boolean') bbsu[k] = b[k];
      if (b.showSec !== undefined) bbsu.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { bbsuChatHidden = false; bbsuShowUntil = Date.now() + (bbsu.showSec || 30) * 1000; }
      if (b.hideNow) { bbsuShowUntil = 0; bbsuChatHidden = true; }
      if (typeof b.title === 'string') bbsu.title = cleanString(b.title).slice(0, 60);
      if (typeof b.ignore === 'string') bbsu.ignore = cleanString(b.ignore).slice(0, 500);
      if (b.font !== undefined) bbsu.font = Math.max(12, Math.min(70, Math.round(Number(b.font)) || 26));
      if (b.cols !== undefined) bbsu.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
      if (b.max !== undefined) bbsu.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
      if (b.panelOpacity !== undefined) bbsu.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && newsHex(b[k])) bbsu[k] = b[k];
      // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
      if (Array.isArray(b.zones)) {
        bbsu.zones = b.zones.slice(0, 24).filter(z => z && etValidTz(z.tz)).map(z => ({ tz: String(z.tz), label: cleanString(z.label).slice(0, 24) || String(z.tz).split('/').pop().replace(/_/g, ' '), on: !!z.on }));
      }
      if (b.newEvent) { const id = `e${bbsu.seq++}`; bbsu.events.push(bbsuFixEvent({ id, name: cleanString(b.newEvent).slice(0, 60) || 'Event', guests: [] })); bbsu.live = id; }
      if (b.copyEvent) { // duplicate an event's details + roles (empty list) - handy for weekly repeats
        const src = bbsuEv(String(b.copyEvent));
        if (src) { const id = `e${bbsu.seq++}`; bbsu.events.push(bbsuFixEvent({ id, name: (src.name + ' (copy)').slice(0, 60), desc: src.desc, date: src.date, time: src.time, tz: src.tz, roles: JSON.parse(JSON.stringify(src.roles)), guests: [] })); bbsu.live = id; }
      }
      if (b.live && bbsuEv(String(b.live))) bbsu.live = String(b.live);
      const ev = bbsuEv(b.event ? String(b.event) : null);
      if (ev) {
        if (typeof b.name === 'string' && cleanString(b.name)) ev.name = cleanString(b.name).slice(0, 60);
        if (typeof b.game === 'string' && cleanString(b.game)) ev.game = cleanString(b.game).slice(0, 30);
        if (typeof b.desc === 'string') ev.desc = String(b.desc).replace(/[<>]/g, '').slice(0, 400);
        if (typeof b.date === 'string') ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
        if (typeof b.time === 'string') ev.time = /^\d{1,2}:\d{2}$/.test(b.time) ? b.time : '';
        if (typeof b.tz === 'string' && etValidTz(b.tz)) ev.tz = b.tz;
        // Roles (her own): full list [{id?, label, cmd, spots, color}] replaces the event's roles.
        if (Array.isArray(b.roles)) {
          const used = new Set(), out = [];
          for (const r of b.roles.slice(0, 12)) {
            const cmd = bbsuCleanCmd(r && r.cmd), label = cleanString(r && r.label).slice(0, 40);
            if (!cmd || !label || used.has(cmd) || SASHI_RESERVED.has(cmd)) continue;
            used.add(cmd);
            const old = r.id && ev.roles.find(x => x.id === String(r.id));
            out.push({ id: old ? old.id : `r${bbsu.rseq++}`, label, cmd, spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)), color: newsHex(r.color) || '' });
          }
          ev.roles = out; bbsuFixEvent(ev);
        }
        if (Array.isArray(b.add)) bbsuAddNames(ev, b.add, b.addRole);
        if (b.remove !== undefined) { ev.guests = ev.guests.filter(g => g.n !== Number(b.remove)); bbsuRenumber(ev); }
        if (b.move && b.move.n) { const i = ev.guests.findIndex(g => g.n === Number(b.move.n)), j = i + (Number(b.move.dir) < 0 ? -1 : 1);
          if (i >= 0 && j >= 0 && j < ev.guests.length) { const t = ev.guests[i]; ev.guests[i] = ev.guests[j]; ev.guests[j] = t; bbsuRenumber(ev); } }
        if (b.rename && b.rename.n) { const g = ev.guests.find(x => x.n === Number(b.rename.n)); const nn = bbsuCleanName(b.rename.name); if (g && nn) { g.name = nn; bbsuRemember(ev, g.twitch, nn); } }
        if (b.setRole && b.setRole.n) { const g = ev.guests.find(x => x.n === Number(b.setRole.n)); if (g) g.role = ev.roles.some(r => r.id === b.setRole.role) ? b.setRole.role : ''; }
        if (b.clear) ev.guests = [];
      }
      if (b.forget && b.forget.game && b.forget.twitch) { const m = sashi.names[sashiGameKey(b.forget.game)]; if (m) { delete m[String(b.forget.twitch).toLowerCase()]; writeJson(SASHI_FILE, sashi); } }
      if (b.deleteEvent && bbsu.events.length > 1) {
        bbsu.events = bbsu.events.filter(e => e.id !== String(b.deleteEvent));
        if (!bbsuEv()) bbsu.live = bbsu.events[0].id;
      }
      bbsuSave(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/beanburger-signup/test' && method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 200, { ok: true, reply: bbsuChat(cleanString(b.name) || 'TestViewer', [{ t: 'text', v: cleanString(b.text) }]) || 'ignored' });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown beanburger-signup route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Event sign-up request failed.' });
  }
}

// ---------------------------------------------------------------------------
// FLOW TREE SIGN-UP (Baby, 2026-10-20): its own copy of the Poke Bowl Sign-up (STREAM EVENT SIGN-UP above),
// so changing this one never touches the others. Same features; generated from that section.
//   - Overlay: /flowtree-signup.html   - Dashboard: /flowtree-signup-control.html   - data/flowtree-signup.json
//   - Pops up (hidden-until-asked) with !flow / !flowtree / !flowtrees only. Remembered in-game names are
//     shared with the Poke Bowl Sign-up (sashi.names), so viewers only type their name once.
// ---------------------------------------------------------------------------
const FTSU_FILE = path.join(DATA_DIR, 'flowtree-signup.json');
function ftsuDefaults() {
  return { visible: true, open: true, live: 'e1', seq: 2, font: sashi.font || 26, cols: sashi.cols || 2, title: '🌳 Flow Tree Sign-Up', max: 0, ignore: '',
    accent: sashi.accent || '#ff8fd8', panelColor: sashi.panelColor || '#1c0e28', panelOpacity: sashi.panelOpacity === undefined ? 85 : sashi.panelOpacity, showZones: true, showCountdown: true, rseq: 1,
    onDemand: !!sashi.onDemand, showSec: sashi.showSec || 30, showOnSignup: sashi.showOnSignup !== false,
    zones: sashi.zones.map(z => ({ ...z })),
    events: [{ id: 'e1', name: 'Flow Trees', guests: [] }] };
}
function ftsuFixEvent(ev) {
  ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
  ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
  ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
  ev.date = typeof ev.date === 'string' ? ev.date : ''; ev.time = typeof ev.time === 'string' ? ev.time : '';
  ev.tz = etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
  ev.game = cleanString(ev.game).slice(0, 30) || 'Palia';
  for (const g of ev.guests) if (typeof g.role !== 'string' || !ev.roles.some(r => r.id === g.role)) g.role = '';
  return ev;
}
function ftsuLoad() {
  const raw = readJson(FTSU_FILE, null) || {}; const s = { ...ftsuDefaults(), ...raw };
  if (!Array.isArray(s.events) || !s.events.length) s.events = ftsuDefaults().events;
  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = ftsuDefaults().zones;
  s.zones = s.zones.filter(z => z && etValidTz(z.tz));
  delete s.names;
  s.events.forEach(ftsuFixEvent);
  return s;
}
let ftsu = ftsuLoad();
const ftsuEv = id => ftsu.events.find(e => e.id === (id || ftsu.live)) || null;
const ftsuRenumber = ev => { ev.guests.forEach((g, i) => { g.n = i + 1; }); };
const ftsuEpoch = ev => (ev && ev.date && ev.time ? etToEpoch(ev.date, ev.time, ev.tz) : null);
// "Hidden until chat asks" (2026-10-15): with ftsu.onDemand on, the overlay stays invisible until chat types
// "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
let ftsuShowUntil = 0;
let ftsuChatHidden = false;   // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
function ftsuReveal(sec) { ftsuShowUntil = Date.now() + (sec || ftsu.showSec || 30) * 1000; broadcast('flowtree-signup', ftsuPublic()); }
function ftsuPublic() {
  const ev = ftsuEv();
  return { ok: true, visible: ftsu.visible && !ftsuChatHidden && (!ftsu.onDemand || Date.now() < ftsuShowUntil), visibleSetting: ftsu.visible, chatHidden: ftsuChatHidden, onDemand: !!ftsu.onDemand,
    showSec: ftsu.showSec || 30, showOnSignup: ftsu.showOnSignup !== false, shownLeft: ftsu.onDemand ? Math.max(0, Math.ceil((ftsuShowUntil - Date.now()) / 1000)) : 0, open: ftsu.open, title: ftsu.title, font: ftsu.font, cols: ftsu.cols, max: ftsu.max,
    accent: ftsu.accent, panelColor: ftsu.panelColor, panelOpacity: ftsu.panelOpacity, showZones: ftsu.showZones, showCountdown: ftsu.showCountdown,
    zones: ftsu.zones.filter(z => z.on).map(z => ({ label: z.label, tz: z.tz })),
    event: ev ? { id: ev.id, name: ev.name, game: ev.game, desc: ev.desc, date: ev.date, time: ev.time, tz: ev.tz, start: ftsuEpoch(ev),
      roles: ev.roles.map(r => ({ id: r.id, label: r.label, cmd: r.cmd, spots: r.spots || 0, color: r.color || '' })),
      guests: ev.guests.map(g => ({ n: g.n, name: g.name, twitch: g.twitch || '', at: g.at || 0, role: g.role || '' })) } : null,
    total: ev ? ev.guests.length : 0, now: Date.now() };
}
function ftsuSave() { writeJson(FTSU_FILE, ftsu); broadcast('flowtree-signup', ftsuPublic()); }
const ftsuPop = () => { if (ftsu.onDemand && ftsu.showOnSignup !== false) ftsuShowUntil = Math.max(ftsuShowUntil, Date.now() + (ftsu.showSec || 30) * 1000); };
const ftsuCleanName = x => cleanString(x).replace(/^\s*\d+[.)\-:]\s+/, '').replace(/[<>]/g, '').trim().slice(0, 40);
const ftsuCleanCmd = v => cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
function ftsuAddNames(ev, names, role) {
  role = ev.roles.some(r => r.id === role) ? role : '';
  for (const raw of names) {
    const name = ftsuCleanName(raw);
    if (!name || ev.guests.some(g => g.name.toLowerCase() === name.toLowerCase()) || ev.guests.length >= 200) continue;
    ev.guests.push({ n: 0, name, twitch: '', at: Date.now(), role });
  }
  ftsuRenumber(ev);
}
// Every command word some other feature uses right now, so "!tomato" is never mistaken for a Palia name.
function ftsuIgnored() {
  const set = new Set(SASHI_BUILTIN_IGNORE);
  for (const w of String(ftsu.ignore || '').split(/[\s,]+/)) { const c = w.toLowerCase().replace(/^!+/, ''); if (c) set.add(c); }
  try { for (const b of partyLiveBoards()) for (const r of b.ev.roles) if (r.command) { set.add(r.command); for (let i = 1; i <= 7; i++) set.add(r.command + i); } } catch (_e) {}
  for (const c of signupRoleCmds()) set.add(c);
  try { [teams.item.command].concat(teams.item.aliases ? teams.item.aliases.split(/,\s*/) : []).forEach(c => { if (c) set.add(String(c).toLowerCase()); }); } catch (_e) {}
  return set;
}
// Party-board role commands that are live right now (to warn her about clashes).
function ftsuPartyCmds() { const set = new Set(); try { for (const b of partyLiveBoards()) for (const r of b.ev.roles) if (r.command) set.add(r.command); } catch (_e) {} return set; }
function ftsuNames(ev) { const k = sashiGameKey(ev.game); return sashi.names[k] || (sashi.names[k] = {}); }
// Remember their in-game name for this event's game (also for names she fixes on the dashboard).
function ftsuRemember(ev, twitch, name) { if (twitch && name && ftsuNames(ev)[String(twitch).toLowerCase()] !== name) { ftsuNames(ev)[String(twitch).toLowerCase()] = name; writeJson(SASHI_FILE, sashi); } }
// A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
function ftsuChatName(v) {
  const name = String(v || '').replace(/^\[|\]$/g, '').replace(/[<>]/g, '').trim();
  if (name.length < 2 || name.length > 32 || !/[a-z]/i.test(name) || name.split(' ').length > 3 || /@|https?:|www\./i.test(name)) return '';
  return name;
}
function ftsuChat(sender, parts) {
  const twitch = cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!twitch) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
  const ev = ftsuEv(); if (!ev) return '';
  const key = twitch.toLowerCase();
  // "!show" / "!event" pops the sign-up on screen when it's set to "hidden until chat asks".
  if (/^!(flow|flowtree|flowtrees)$/i.test(text)) { if (ftsu.onDemand && ftsu.visible) { ftsuReveal(); return 'Showing the Flow Tree Sign-Up'; } return ''; }
  // "!leave" takes their own name off the list (2026-10-11). Works even when sign-ups are closed.
  // (Party Sign-ups also hears !leave - that's fine, each only removes its own entries.)
  if (/^!leave$/i.test(text)) {
    const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
    if (!mine) return '';
    ev.guests = ev.guests.filter(g => g !== mine); ftsuRenumber(ev); ftsuSave();
    return `${mine.name} left`;
  }
  const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
  // ----- events WITH roles: "!<role command> [Palia name]" -----
  if (ev.roles.length) {
    const m = /^!([a-z0-9_]+)(?: (.+))?$/i.exec(text);
    if (!m) return '';
    const role = ev.roles.find(r => r.cmd === m[1].toLowerCase());
    if (!role) return '';
    if (!ftsu.open) return `${twitch}: sign-ups are closed`;
    let name = m[2] ? ftsuChatName(m[2]) : '';
    if (m[2] && !name) return '';
    if (!name) name = (mine && mine.name) || ftsuNames(ev)[key] || twitch;
    const taken = ev.guests.find(g => g.name.toLowerCase() === name.toLowerCase() && g !== mine);
    if (taken) return `${name} is already signed up`;
    ftsuRemember(ev, twitch, name);
    if (mine) {
      const moved = mine.role !== role.id;
      mine.name = name;
      if (moved) { mine.role = role.id; mine.at = Date.now(); ev.guests = ev.guests.filter(g => g !== mine).concat([mine]); ftsuRenumber(ev); }
      ftsuPop(); ftsuSave(); return moved ? `${name} switched to ${role.label}` : `${name} updated`;
    }
    if (ftsu.max && ev.guests.length >= ftsu.max) return `Event is full (${ftsu.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: role.id });
    ftsuPop(); ftsuSave();
    const pos = ev.guests.filter(g => g.role === role.id).length;
    return role.spots && pos > role.spots ? `${name} is on the ${role.label} waitlist (#${pos - role.spots})` : `${name} signed up for ${role.label}`;
  }
  // ----- events WITHOUT roles: "!Palia Name" (2026-10-10 / -11 rules) -----
  if (!ftsu.open) return '';
  // "!signup" alone = use the name we remember for this game (from their first sign-up).
  if (/^!signup$/i.test(text)) {
    const known = ftsuNames(ev)[key];
    if (!known) return `${twitch}: type ! + your ${ev.game} name the first time`;
    if (mine) return '';
    if (ev.guests.some(g => g.name.toLowerCase() === known.toLowerCase())) return `${known} is already signed up`;
    if (ftsu.max && ev.guests.length >= ftsu.max) return `Event is full (${ftsu.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name: known, twitch, at: Date.now(), role: '' });
    ftsuPop(); ftsuSave(); return `${known} signed up (#${ev.guests.length})`;
  }
  const m = /^!([^\s!][^!]{0,31})$/.exec(text);
  if (!m) return '';
  const name = ftsuChatName(m[1]);
  if (!name) return '';
  const low = name.toLowerCase(), first = low.split(' ')[0];
  // The first word decides whether it's another command ("!vote 2", "!tomato Kitsuu", "!hug Bob").
  const ign = ftsuIgnored();
  if (ign.has(first) || ign.has(low) || /^(leave|party|show|here)\d*$/.test(first)) return '';
  const taken = ev.guests.find(g => g.name.toLowerCase() === low);
  if (taken) return taken.twitch.toLowerCase() === key ? '' : `${name} is already signed up`;
  ftsuRemember(ev, twitch, name);
  if (mine) { mine.name = name; ftsuPop(); ftsuSave(); return `${twitch} changed their name to ${name} (#${mine.n})`; }
  if (ftsu.max && ev.guests.length >= ftsu.max) return `Event is full (${ftsu.max})`;
  ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: '' });
  ftsuPop(); ftsuSave(); return `${name} signed up (#${ev.guests.length})`;
}
async function handleFtsuApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/flowtree-signup' && method === 'GET') return sendJson(res, 200, ftsuPublic());
    if (pathname === '/api/flowtree-signup/admin' && method === 'GET') {
      const ev = ftsuEv(), pc = new Set([...ftsuPartyCmds(), ...signupRoleCmds('ftsu')]);
      return sendJson(res, 200, { ...ftsuPublic(), visible: ftsu.visible, live: ftsu.live, ignore: ftsu.ignore, builtinIgnore: SASHI_BUILTIN_IGNORE, allZones: ftsu.zones,
        clashes: ev ? ev.roles.filter(r => pc.has(r.cmd)).map(r => r.cmd) : [],
        remembered: ev ? Object.entries(sashi.names[sashiGameKey(ev.game)] || {}).map(([twitch, name]) => ({ twitch, name })) : [],
        games: Array.from(new Set(ftsu.events.map(e => e.game).concat(['Palia', 'Aniimo']))),
        events: ftsu.events.map(e => ({ id: e.id, name: e.name, count: e.guests.length })) });
    }
    if (pathname === '/api/flowtree-signup' && method === 'POST') {
      const b = await readBody(req);
      for (const k of ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup']) if (typeof b[k] === 'boolean') ftsu[k] = b[k];
      if (b.showSec !== undefined) ftsu.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { ftsuChatHidden = false; ftsuShowUntil = Date.now() + (ftsu.showSec || 30) * 1000; }
      if (b.hideNow) { ftsuShowUntil = 0; ftsuChatHidden = true; }
      if (typeof b.title === 'string') ftsu.title = cleanString(b.title).slice(0, 60);
      if (typeof b.ignore === 'string') ftsu.ignore = cleanString(b.ignore).slice(0, 500);
      if (b.font !== undefined) ftsu.font = Math.max(12, Math.min(70, Math.round(Number(b.font)) || 26));
      if (b.cols !== undefined) ftsu.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
      if (b.max !== undefined) ftsu.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
      if (b.panelOpacity !== undefined) ftsu.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && newsHex(b[k])) ftsu[k] = b[k];
      // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
      if (Array.isArray(b.zones)) {
        ftsu.zones = b.zones.slice(0, 24).filter(z => z && etValidTz(z.tz)).map(z => ({ tz: String(z.tz), label: cleanString(z.label).slice(0, 24) || String(z.tz).split('/').pop().replace(/_/g, ' '), on: !!z.on }));
      }
      if (b.newEvent) { const id = `e${ftsu.seq++}`; ftsu.events.push(ftsuFixEvent({ id, name: cleanString(b.newEvent).slice(0, 60) || 'Event', guests: [] })); ftsu.live = id; }
      if (b.copyEvent) { // duplicate an event's details + roles (empty list) - handy for weekly repeats
        const src = ftsuEv(String(b.copyEvent));
        if (src) { const id = `e${ftsu.seq++}`; ftsu.events.push(ftsuFixEvent({ id, name: (src.name + ' (copy)').slice(0, 60), desc: src.desc, date: src.date, time: src.time, tz: src.tz, roles: JSON.parse(JSON.stringify(src.roles)), guests: [] })); ftsu.live = id; }
      }
      if (b.live && ftsuEv(String(b.live))) ftsu.live = String(b.live);
      const ev = ftsuEv(b.event ? String(b.event) : null);
      if (ev) {
        if (typeof b.name === 'string' && cleanString(b.name)) ev.name = cleanString(b.name).slice(0, 60);
        if (typeof b.game === 'string' && cleanString(b.game)) ev.game = cleanString(b.game).slice(0, 30);
        if (typeof b.desc === 'string') ev.desc = String(b.desc).replace(/[<>]/g, '').slice(0, 400);
        if (typeof b.date === 'string') ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
        if (typeof b.time === 'string') ev.time = /^\d{1,2}:\d{2}$/.test(b.time) ? b.time : '';
        if (typeof b.tz === 'string' && etValidTz(b.tz)) ev.tz = b.tz;
        // Roles (her own): full list [{id?, label, cmd, spots, color}] replaces the event's roles.
        if (Array.isArray(b.roles)) {
          const used = new Set(), out = [];
          for (const r of b.roles.slice(0, 12)) {
            const cmd = ftsuCleanCmd(r && r.cmd), label = cleanString(r && r.label).slice(0, 40);
            if (!cmd || !label || used.has(cmd) || SASHI_RESERVED.has(cmd)) continue;
            used.add(cmd);
            const old = r.id && ev.roles.find(x => x.id === String(r.id));
            out.push({ id: old ? old.id : `r${ftsu.rseq++}`, label, cmd, spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)), color: newsHex(r.color) || '' });
          }
          ev.roles = out; ftsuFixEvent(ev);
        }
        if (Array.isArray(b.add)) ftsuAddNames(ev, b.add, b.addRole);
        if (b.remove !== undefined) { ev.guests = ev.guests.filter(g => g.n !== Number(b.remove)); ftsuRenumber(ev); }
        if (b.move && b.move.n) { const i = ev.guests.findIndex(g => g.n === Number(b.move.n)), j = i + (Number(b.move.dir) < 0 ? -1 : 1);
          if (i >= 0 && j >= 0 && j < ev.guests.length) { const t = ev.guests[i]; ev.guests[i] = ev.guests[j]; ev.guests[j] = t; ftsuRenumber(ev); } }
        if (b.rename && b.rename.n) { const g = ev.guests.find(x => x.n === Number(b.rename.n)); const nn = ftsuCleanName(b.rename.name); if (g && nn) { g.name = nn; ftsuRemember(ev, g.twitch, nn); } }
        if (b.setRole && b.setRole.n) { const g = ev.guests.find(x => x.n === Number(b.setRole.n)); if (g) g.role = ev.roles.some(r => r.id === b.setRole.role) ? b.setRole.role : ''; }
        if (b.clear) ev.guests = [];
      }
      if (b.forget && b.forget.game && b.forget.twitch) { const m = sashi.names[sashiGameKey(b.forget.game)]; if (m) { delete m[String(b.forget.twitch).toLowerCase()]; writeJson(SASHI_FILE, sashi); } }
      if (b.deleteEvent && ftsu.events.length > 1) {
        ftsu.events = ftsu.events.filter(e => e.id !== String(b.deleteEvent));
        if (!ftsuEv()) ftsu.live = ftsu.events[0].id;
      }
      ftsuSave(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/flowtree-signup/test' && method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 200, { ok: true, reply: ftsuChat(cleanString(b.name) || 'TestViewer', [{ t: 'text', v: cleanString(b.text) }]) || 'ignored' });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown flowtree-signup route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Event sign-up request failed.' });
  }
}

// "!show <word>" / "!hide <word>" for every sign-up widget (Baby, 2026-10-20):
//   !show poke / !hide poke    -> Poke Bowl Sign-up      !show cake / !hide cake -> Cake Sign-Ups (all party boards)
//   !show burger / !hide burger -> Bean Burger Sign-Up   !show flow / !hide flow -> Flow Tree Sign-Up
// !hide keeps it off screen until !show (or the dashboard's Show button). !show brings it back; when the widget is
// "hidden until chat asks" it shows for its usual N seconds. The dashboard's "Show on stream" switch still wins.
// Returns true when the message was one of these, so the sign-up chat hooks skip it.
const SIGNUP_SH_WORDS = {
  poke: ['poke', 'pokebowl', 'pokebowls', 'bowl', 'sashimi'], cake: ['cake', 'cakes', 'party'],
  burger: ['burger', 'burgers', 'beanburger', 'beanburgers'], flow: ['flow', 'flows', 'flowtree', 'flowtrees', 'tree', 'trees'] };
function signupShowHideChat(sender, parts) {
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ').toLowerCase();
  const m = /^!(show|hide) (.{2,30})$/.exec(text);
  if (!m) return false;
  const word = m[2].replace(/[^a-z]/g, '');
  const which = Object.keys(SIGNUP_SH_WORDS).find(k => SIGNUP_SH_WORDS[k].includes(word));
  if (!which) return false;
  const show = m[1] === 'show';
  if (which === 'cake') {
    partyChatHidden = !show;
    if (show) { if (parties.onDemand) partyReveal('all'); else broadcast('party', partyPublic()); }
    else { for (const k of Object.keys(partyShowUntil)) delete partyShowUntil[k]; partySpot.until = 0; broadcast('party', partyPublic()); }
    return true;
  }
  const w = which === 'poke' ? { set: v => { sashiChatHidden = v; }, s: sashi, until: v => { sashiShowUntil = v; }, pub: sashiPublic, ch: 'sashimi' }
    : which === 'burger' ? { set: v => { bbsuChatHidden = v; }, s: bbsu, until: v => { bbsuShowUntil = v; }, pub: bbsuPublic, ch: 'beanburger-signup' }
    : { set: v => { ftsuChatHidden = v; }, s: ftsu, until: v => { ftsuShowUntil = v; }, pub: ftsuPublic, ch: 'flowtree-signup' };
  w.set(!show);
  w.until(show && w.s.onDemand ? Date.now() + (w.s.showSec || 30) * 1000 : 0);
  broadcast(w.ch, w.pub());
  return true;
}

// Role commands on the live event of every sign-up widget (Poke Bowl, Bean Burger, Flow Tree), except `skip`.
// Used so "!Name" sign-ups never treat another widget's role command as a name, and to warn about clashes.
function signupRoleCmds(skip) {
  const set = new Set();
  const all = { sashi: () => sashiEv(), bbsu: () => bbsuEv(), ftsu: () => ftsuEv() };
  for (const k of Object.keys(all)) { if (k === skip) continue; try { const ev = all[k](); if (ev) for (const r of ev.roles) if (r.cmd) set.add(r.cmd); } catch (_e) {} }
  return set;
}

// ---------------------------------------------------------------------------
// DESKTOP WIDGETS (Baby, 2026-10-11). Her own "widget displayer": a small Electron app
// (desktop-widgets/, started with start-desktop-widgets.bat) puts any widget URL in a
// see-through, always-on-top window on her desktop - over her game (Borderless Windowed).
// Everything is controlled from the dashboard /desktop-control.html:
//   add / remove widgets, position + size (numbers, arrows, corner presets or dragging on
//   the screen map), opacity, zoom, show/hide, and MOVE MODE (unlock to drag the real
//   windows with the mouse; locked = clicks pass through to the game). Ctrl+Alt+M toggles it.
// The app polls GET /api/desktop every second and reports its screens + any drag back.
//   - Saved in data/desktop-widgets.json
// ---------------------------------------------------------------------------
const DESK_FILE = path.join(DATA_DIR, 'desktop-widgets.json');
function deskLoad() {
  const raw = readJson(DESK_FILE, null) || {};
  return { move: false, hideAll: false, seq: 1, widgets: [], ...raw, widgets: Array.isArray(raw.widgets) ? raw.widgets : [] };
}
let desk = deskLoad();
let deskApp = { seen: 0, displays: [], version: '', cams: [] };   // cams: camera names the webcam widget can see
const deskNum = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function deskCleanUrl(u) {
  u = cleanString(u).slice(0, 600);
  if (/^\/[^\s]*$/.test(u)) u = 'http://127.0.0.1:8790' + u;          // "/party.html" -> full ICB link
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : '';
}
function deskApply(w, b) {
  if (typeof b.name === 'string' && cleanString(b.name)) w.name = cleanString(b.name).slice(0, 40);
  if (typeof b.url === 'string') { const u = deskCleanUrl(b.url); if (u) w.url = u; }
  if (b.x !== undefined) w.x = deskNum(b.x, -20000, 20000, w.x);
  if (b.y !== undefined) w.y = deskNum(b.y, -20000, 20000, w.y);
  if (b.w !== undefined) w.w = deskNum(b.w, 60, 8000, w.w);
  if (b.h !== undefined) w.h = deskNum(b.h, 40, 8000, w.h);
  if (b.opacity !== undefined) w.opacity = deskNum(b.opacity, 10, 100, w.opacity);
  if (b.zoom !== undefined) w.zoom = deskNum(b.zoom, 25, 300, w.zoom);
  if (typeof b.on === 'boolean') w.on = b.on;
  if (typeof b.locked === 'boolean') w.locked = b.locked;     // stays click-through even in move mode
  if (typeof b.clickable === 'boolean') w.clickable = b.clickable;   // takes mouse clicks even when Move mode is off (e.g. Aniimo quick checker)
  if (b.reload) w.reloadAt = Date.now();
}
function deskPublic() {
  return { ok: true, move: desk.move, hideAll: desk.hideAll, widgets: desk.widgets,
    app: { online: Date.now() - deskApp.seen < 6000, seen: deskApp.seen, displays: deskApp.displays, version: deskApp.version, cams: deskApp.cams, camStatus: deskApp.camStatus || '', camAt: deskApp.camAt || 0 }, now: Date.now() };
}
function deskSave() { writeJson(DESK_FILE, desk); broadcast('desktop', deskPublic()); }
async function handleDeskApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/desktop' && method === 'GET') {
      if (/[?&]app=1/.test(req.url)) deskApp.seen = Date.now();
      return sendJson(res, 200, deskPublic());
    }
    if (pathname === '/api/desktop' && method === 'POST') {
      const b = await readBody(req);
      if (typeof b.move === 'boolean') desk.move = b.move;
      if (b.toggleMove) desk.move = !desk.move;
      if (typeof b.hideAll === 'boolean') desk.hideAll = b.hideAll;
      if (b.add) {
        const url = deskCleanUrl(b.add.url);
        if (!url) return sendJson(res, 400, { ok: false, error: 'That link does not look right - it should start with http:// or /' });
        const d = (deskApp.displays.find(x => x.primary) || deskApp.displays[0] || { x: 0, y: 0, w: 1920, h: 1080 });
        const w = { id: `w${desk.seq++}`, name: 'Widget', url, x: d.x + 100 + desk.widgets.length * 30, y: d.y + 100 + desk.widgets.length * 30, w: 600, h: 400, opacity: 100, zoom: 100, on: true, locked: false };
        deskApply(w, { ...b.add, url: undefined });
        desk.widgets.push(w);
      }
      if (b.update && b.update.id) { const w = desk.widgets.find(x => x.id === String(b.update.id)); if (w) deskApply(w, b.update); }
      if (b.remove) desk.widgets = desk.widgets.filter(x => x.id !== String(b.remove));
      if (b.order && Array.isArray(b.order)) { const m = new Map(desk.widgets.map(w => [w.id, w])); desk.widgets = b.order.map(id => m.get(id)).filter(Boolean).concat(desk.widgets.filter(w => !b.order.includes(w.id))); }
      deskSave(); return sendJson(res, 200, deskPublic());
    }
    // From the desktop app: its screens (heartbeat) and where she dragged a widget to.
    if (pathname === '/api/desktop/app' && method === 'POST') {
      const b = await readBody(req);
      deskApp.seen = Date.now();
      if (typeof b.version === 'string') deskApp.version = cleanString(b.version).slice(0, 20);
      if (Array.isArray(b.displays)) deskApp.displays = b.displays.slice(0, 8).map((d, i) => ({ id: String(d.id || i), x: deskNum(d.x, -20000, 20000, 0), y: deskNum(d.y, -20000, 20000, 0),
        w: deskNum(d.w, 100, 20000, 1920), h: deskNum(d.h, 100, 20000, 1080), primary: !!d.primary, scale: Number(d.scale) || 1 }));
      if (b.bounds && b.bounds.id) {
        const w = desk.widgets.find(x => x.id === String(b.bounds.id));
        if (w) { deskApply(w, { x: b.bounds.x, y: b.bounds.y, w: b.bounds.w, h: b.bounds.h }); writeJson(DESK_FILE, desk); }
      }
      if (b.toggleMove) { desk.move = !desk.move; writeJson(DESK_FILE, desk); }
      return sendJson(res, 200, deskPublic());
    }
    // From webcam.html: the camera names it found (so the dashboard can offer a list).
    if (pathname === '/api/desktop/cams' && method === 'POST') {
      const b = await readBody(req);
      if (Array.isArray(b.cams)) deskApp.cams = b.cams.slice(0, 12).map(c => cleanString(c).slice(0, 80)).filter(Boolean);
      if (typeof b.status === 'string') { deskApp.camStatus = cleanString(b.status).slice(0, 300); deskApp.camAt = Date.now(); }
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown desktop route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Desktop widgets request failed.' });
  }
}

// ---------------------------------------------------------------------------
// ANIIMO DEX (Baby, 2026-10-14). Built on a catch & variant checklist a friend's Claude made
// ("Aniimo Tracker.html", kept untouched in the ICB folder). Now lives in ICB:
//   - Roster (Aniimo + their forms/specials) seeded once from config/aniimo-roster.json, then
//     owned by data/aniimo-dex.json - Baby adds / edits / removes on the dashboard.
//   - Checks saved on the server (not in a browser), with the time each was checked.
//   - Overlay /aniimo.html: progress + "new catch" pop-up + chat look-ups.
//   - Chat: "!need <Aniimo>" shows what she still needs for it; "!dex" shows overall progress
//     (on the overlay - ICB doesn't post into Twitch chat). Per-person + global cooldown.
//   - Quick checker /aniimo-quick.html (for a clickable Desktop Widget over the game).
//   - Dashboard /aniimo-control.html. Import accepts the friend tracker's backup .json too.
// ---------------------------------------------------------------------------
const DEX_FILE = path.join(DATA_DIR, 'aniimo-dex.json');
const DEX_SEED = path.join(APP_DIR, 'config', 'aniimo-roster.json');
const DEX_ELEMENTS = ['Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Rock', 'Wind', 'Dark', 'Holy'];
function dexDefaults() {
  return { visible: true, title: '✨ Aniimo Dex', chat: true, popupSec: 8, lookupSec: 14, showElements: true, accent: '#7dd3fc', panelColor: '#101522', panelOpacity: 88,
    roster: [], checked: {}, recent: [], seq: 1 };
}
const dexCleanVariant = v => cleanString(v).replace(/Prismana Form Form/g, 'Prismana Form').replace(/[<>|]/g, '').slice(0, 50);
function dexCleanAniimo(a, id) {
  const variants = [];
  for (const v of (Array.isArray(a.variants) ? a.variants : String(a.variants || '').split(/\r?\n|,/))) { const c = dexCleanVariant(v); if (c && !variants.includes(c)) variants.push(c); }
  return { id: id || String(a.id || a.number || '').replace(/[^0-9a-z_-]/gi, '').slice(0, 20), number: cleanString(a.number).slice(0, 10), name: cleanString(a.name).replace(/[<>]/g, '').slice(0, 40),
    element: cleanString(a.element).slice(0, 40), variants: variants.slice(0, 40), image: a.image && DECOR_IMAGE_EXT.test(String(a.image)) ? path.basename(String(a.image)) : '',
    // Photos of individual forms she caught / hatched (2026-10-14): { "Highland Form": "001__highlandform.webp" }
    formImages: a.formImages && typeof a.formImages === 'object' ? Object.fromEntries(Object.entries(a.formImages).filter(([v, f]) => variants.includes(dexCleanVariant(v)) && DECOR_IMAGE_EXT.test(String(f))).map(([v, f]) => [dexCleanVariant(v), path.basename(String(f))])) : {} };
}
function dexLoad() {
  const raw = readJson(DEX_FILE, null);
  const d = { ...dexDefaults(), ...(raw || {}) };
  if (!raw || !Array.isArray(raw.roster) || !raw.roster.length) {
    const seed = readJson(DEX_SEED, null);
    d.roster = (seed && Array.isArray(seed.roster) ? seed.roster : []).map(a => dexCleanAniimo(a)).filter(a => a.id && a.name);
  }
  d.checked = d.checked && typeof d.checked === 'object' ? d.checked : {};
  d.recent = Array.isArray(d.recent) ? d.recent.slice(0, 30) : [];
  return d;
}
let dex = dexLoad();
let dexPopup = null, dexLookup = null;               // what the overlay shows right now
const dexChatSeen = new Map(); let dexChatLast = 0;
const dexKey = (id, v) => `${id}|${v}`;
const dexFind = id => dex.roster.find(a => a.id === String(id));
// Pictures (2026-10-14): assets/aniimo/. A picture she uploads is remembered on the Aniimo (a.image);
// otherwise a file named after the number or name is matched automatically (001.png, 1.png, Emberpup.png...).
const DEX_ART_DIR = path.join(APP_DIR, 'assets', 'aniimo');
try { fs.mkdirSync(DEX_ART_DIR, { recursive: true }); } catch (_error) {}
let dexArtList = null, dexArtAt = 0;
function dexArtFiles() {
  if (!dexArtList || Date.now() - dexArtAt > 5000) {
    dexArtAt = Date.now(); dexArtList = new Map();
    try { for (const f of fs.readdirSync(DEX_ART_DIR)) if (DECOR_IMAGE_EXT.test(f)) dexArtList.set(f.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]/g, ''), f); } catch (_e) {}
  }
  return dexArtList;
}
const dexSlug = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function dexArtUrl(f) { let v = 0; try { v = Math.round(fs.statSync(path.join(DEX_ART_DIR, f)).mtimeMs); } catch (_e) { return null; } return `/assets/aniimo/${encodeURIComponent(f)}?v=${v}`; }
function dexFormImg(a, v) { return a && a.formImages && a.formImages[v] ? dexArtUrl(a.formImages[v]) : null; }
function dexFormImgs(a) { const o = {}; if (a && a.formImages) for (const v of Object.keys(a.formImages)) { const u = dexFormImg(a, v); if (u) o[v] = u; } return o; }
function dexImg(a) {
  if (!a) return null;
  const files = dexArtFiles();
  const url = f => { let v = 0; try { v = Math.round(fs.statSync(path.join(DEX_ART_DIR, f)).mtimeMs); } catch (_e) { return null; } return `/assets/aniimo/${encodeURIComponent(f)}?v=${v}`; };
  if (a.image) { const u = url(a.image); if (u) return u; }
  const tries = [a.number, String(a.number).replace(/^0+/, ''), a.name, String(a.name).split('/')[0], a.id].map(dexSlug).filter(Boolean);
  for (const t of tries) { const f = files.get(t); if (f) return url(f); }
  return null;
}
function dexStats() {
  let total = 0, done = 0, full = 0; const el = {};
  for (const a of dex.roster) {
    let n = 0; for (const v of a.variants) { total++; if (dex.checked[dexKey(a.id, v)]) { done++; n++; } }
    if (a.variants.length && n === a.variants.length) full++;
    for (const e of String(a.element).split('/').map(s => s.trim()).filter(Boolean)) { const o = el[e] || (el[e] = { done: 0, total: 0 }); o.done += n; o.total += a.variants.length; }
  }
  const basic = dex.roster.filter(a => dex.checked[dexKey(a.id, 'Basic Form')]).length;
  return { total, done, pct: total ? Math.round(done / total * 1000) / 10 : 0, species: dex.roster.length, full, basic, elements: el };
}
function dexPublic() {
  const now = Date.now();
  return { ok: true, visible: dex.visible, title: dex.title, chat: dex.chat, showElements: dex.showElements, accent: dex.accent, panelColor: dex.panelColor, panelOpacity: dex.panelOpacity,
    stats: dexStats(), recent: dex.recent.slice(0, 8).map(r => { const a = dexFind(r.id); return { ...r, img: dexFormImg(a, r.variant) || dexImg(a) }; }), popup: dexPopup && dexPopup.until > now ? dexPopup : null, lookup: dexLookup && dexLookup.until > now ? dexLookup : null, now };
}
function dexSave() { writeJson(DEX_FILE, dex); broadcast('aniimo', dexPublic()); }
function dexSet(id, variant, on) {
  const a = dexFind(id); if (!a || !a.variants.includes(variant)) return false;
  const k = dexKey(a.id, variant);
  if (on && !dex.checked[k]) {
    dex.checked[k] = Date.now();
    dex.recent = [{ id: a.id, name: a.name, variant, at: Date.now() }].concat(dex.recent.filter(r => !(r.id === a.id && r.variant === variant))).slice(0, 30);
    const n = a.variants.filter(v => dex.checked[dexKey(a.id, v)]).length;
    dexPopup = { id: a.id, name: a.name, number: a.number, element: a.element, img: dexImg(a), formImg: dexFormImg(a, variant), variant, have: n, of: a.variants.length, complete: n === a.variants.length, until: Date.now() + dex.popupSec * 1000, at: Date.now() };
  } else if (!on && dex.checked[k]) { delete dex.checked[k]; dex.recent = dex.recent.filter(r => !(r.id === a.id && r.variant === variant)); }
  return true;
}
// Find an Aniimo by what someone typed: number, exact name, start of name, then anywhere in name.
function dexSearch(q) {
  q = String(q || '').toLowerCase().replace(/^#/, '').trim(); if (!q) return null;
  const R = dex.roster;
  return R.find(a => a.number === q || a.number.replace(/^0+/, '') === q.replace(/^0+/, '')) || R.find(a => a.name.toLowerCase() === q) ||
    R.find(a => a.name.toLowerCase().split(/\s*\/\s*/).some(n => n === q)) || R.find(a => a.name.toLowerCase().startsWith(q)) || (q.length >= 3 ? R.find(a => a.name.toLowerCase().includes(q)) : null);
}
function dexChat(sender, parts) {
  if (!dex.chat) return '';
  const name = cleanString(sender).replace(/^@/, '').slice(0, 40); if (!name) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
  const m = /^!(need|dex)\b ?(.*)$/i.exec(text); if (!m) return '';
  const now = Date.now(), key = name.toLowerCase();
  if (now - (dexChatSeen.get(key) || 0) < 20000 || now - dexChatLast < 4000) return '';   // 20 s per person, 4 s overall
  dexChatSeen.set(key, now); dexChatLast = now;
  const sec = dex.lookupSec * 1000;
  if (m[1].toLowerCase() === 'dex' || !m[2]) { dexLookup = { kind: 'dex', by: name, until: now + sec, at: now }; broadcast('aniimo', dexPublic()); return 'dex'; }
  const a = dexSearch(m[2]);
  if (!a) { dexLookup = { kind: 'notfound', by: name, q: m[2].slice(0, 30), until: now + 6000, at: now }; broadcast('aniimo', dexPublic()); return 'not found'; }
  const have = a.variants.filter(v => dex.checked[dexKey(a.id, v)]), need = a.variants.filter(v => !dex.checked[dexKey(a.id, v)]);
  dexLookup = { kind: 'need', by: name, id: a.id, name: a.name, number: a.number, element: a.element, img: dexImg(a), formImgs: dexFormImgs(a), have, need, until: now + sec, at: now };
  broadcast('aniimo', dexPublic()); return `${a.name}: needs ${need.length}`;
}
async function handleDexApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/aniimo' && method === 'GET') return sendJson(res, 200, dexPublic());
    if (pathname === '/api/aniimo/admin' && method === 'GET') return sendJson(res, 200, { ...dexPublic(), roster: dex.roster.map(a => ({ ...a, img: dexImg(a), formImgs: dexFormImgs(a) })), checked: dex.checked, popupSec: dex.popupSec, lookupSec: dex.lookupSec, elements: DEX_ELEMENTS });
    if (pathname === '/api/aniimo' && method === 'POST') {
      const b = await readBody(req);
      for (const k of ['visible', 'chat', 'showElements']) if (typeof b[k] === 'boolean') dex[k] = b[k];
      if (typeof b.title === 'string') dex.title = cleanString(b.title).slice(0, 60);
      if (b.popupSec !== undefined) dex.popupSec = Math.max(2, Math.min(60, Math.round(Number(b.popupSec)) || 8));
      if (b.lookupSec !== undefined) dex.lookupSec = Math.max(4, Math.min(60, Math.round(Number(b.lookupSec)) || 14));
      if (b.panelOpacity !== undefined) dex.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && newsHex(b[k])) dex[k] = b[k];
      if (b.check && b.check.id) dexSet(b.check.id, dexCleanVariant(b.check.variant), b.check.on !== false);
      if (b.checkAll && b.checkAll.id) { const a = dexFind(b.checkAll.id); if (a) for (const v of a.variants) dexSet(a.id, v, b.checkAll.on !== false); }
      if (b.lookup) { const a = dexSearch(b.lookup); if (a) { const now = Date.now(); dexLookup = { kind: 'need', by: '', id: a.id, name: a.name, number: a.number, element: a.element, img: dexImg(a), formImgs: dexFormImgs(a),
        have: a.variants.filter(v => dex.checked[dexKey(a.id, v)]), need: a.variants.filter(v => !dex.checked[dexKey(a.id, v)]), until: now + dex.lookupSec * 1000, at: now }; } }
      if (b.lookupDex) { const now = Date.now(); dexLookup = { kind: 'dex', by: '', until: now + dex.lookupSec * 1000, at: now }; }
      if (b.hideNow) { dexPopup = null; dexLookup = null; }
      // Roster editing (hers): save one Aniimo (new or existing), or remove one.
      if (b.saveAniimo) {
        const old = b.saveAniimo.id ? dexFind(b.saveAniimo.id) : null;
        const a = dexCleanAniimo(b.saveAniimo, old ? old.id : `x${dex.seq++}`);
        if (!a.name) return sendJson(res, 400, { ok: false, error: 'An Aniimo needs a name.' });
        if (!a.variants.length) a.variants = ['Basic Form'];
        if (old) {
          a.image = old.image || '';   // the picture is set with /api/aniimo/image, not the edit form
          a.formImages = Object.fromEntries(Object.entries(old.formImages || {}).filter(([v]) => a.variants.includes(v)));
          for (const v of old.variants) if (!a.variants.includes(v)) delete dex.checked[dexKey(old.id, v)];   // removed forms lose their check
          Object.assign(old, a);
        } else dex.roster.push(a);
        dex.roster.sort((x, y) => (parseInt(x.number, 10) || 1e9) - (parseInt(y.number, 10) || 1e9) || x.name.localeCompare(y.name));
      }
      if (b.removeAniimo) { const a = dexFind(b.removeAniimo); if (a) { for (const v of a.variants) delete dex.checked[dexKey(a.id, v)]; dex.roster = dex.roster.filter(x => x !== a); dex.recent = dex.recent.filter(r => r.id !== a.id); } }
      // Add / rename a form on EVERY Aniimo at once (e.g. a new mutation type arrives in a patch).
      if (b.addFormAll) { const v = dexCleanVariant(b.addFormAll); if (v) for (const a of dex.roster) if (!a.variants.includes(v)) a.variants.push(v); }
      if (b.renameForm && b.renameForm.from && b.renameForm.to) {
        const f = dexCleanVariant(b.renameForm.from), t = dexCleanVariant(b.renameForm.to);
        if (f && t && f !== t) for (const a of dex.roster) { const i = a.variants.indexOf(f); if (i >= 0 && !a.variants.includes(t)) { a.variants[i] = t; if (a.formImages && a.formImages[f]) { a.formImages[t] = a.formImages[f]; delete a.formImages[f]; } const k = dexKey(a.id, f); if (dex.checked[k]) { dex.checked[dexKey(a.id, t)] = dex.checked[k]; delete dex.checked[k]; } } }
      }
      // Import: our own backup ({checked:{"id|variant":ts}}) or the friend tracker's ({checked:{"number|name|variant":true}}).
      if (b.import && typeof b.import === 'object') {
        const src = b.import.checked && typeof b.import.checked === 'object' ? b.import.checked : b.import; let n = 0;
        if (Array.isArray(b.import.roster) && b.import.roster.length && b.replaceRoster) dex.roster = b.import.roster.map(a => dexCleanAniimo(a)).filter(a => a.id && a.name);
        for (const k of Object.keys(src)) {
          if (!src[k]) continue;
          const p = k.split('|'), id = p[0], v = dexCleanVariant(p[p.length - 1]);
          const a = dexFind(id) || dex.roster.find(x => p.length > 2 && x.name === p[1]);
          if (a && a.variants.includes(v) && !dex.checked[dexKey(a.id, v)]) { dex.checked[dexKey(a.id, v)] = typeof src[k] === 'number' ? src[k] : Date.now(); n++; }
        }
        dexSave(); return sendJson(res, 200, { ok: true, imported: n });
      }
      if (b.resetChecks === 'yes') { dex.checked = {}; dex.recent = []; }
      dexSave(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/aniimo/export' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="aniimo-dex-backup.json"' });
      return res.end(JSON.stringify({ app: 'ICB Aniimo Dex', exportedAt: new Date().toISOString(), roster: dex.roster, checked: dex.checked }, null, 2));
    }
    // Picture for one Aniimo: { id, dataUrl } saves it (assets/aniimo/<number>.<ext>); { id, remove: true } clears it.
    if (pathname === '/api/aniimo/image' && method === 'POST') {
      const b = await readBody(req); const a = dexFind(b.id);
      if (!a) return sendJson(res, 404, { ok: false, error: 'No Aniimo with that id.' });
      // A photo for ONE form: { id, variant, dataUrl } / { id, variant, remove: true }. Optional tick: true also ticks it.
      if (b.variant) {
        const v = dexCleanVariant(b.variant);
        if (!a.variants.includes(v)) return sendJson(res, 400, { ok: false, error: 'That Aniimo has no such form.' });
        a.formImages = a.formImages || {};
        if (a.formImages[v]) { try { fs.unlinkSync(path.join(DEX_ART_DIR, a.formImages[v])); } catch (_e) {} }
        if (b.remove) { delete a.formImages[v]; dexSave(); return sendJson(res, 200, { ok: true }); }
        const fm = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
        if (!fm) return sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
        const fb = Buffer.from(fm[2], 'base64');
        if (fb.length > 9 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
        const fname = `${(dexSlug(a.number) || dexSlug(a.name) || a.id).slice(0, 30)}__${dexSlug(v).slice(0, 40) || 'form'}.${fm[1] === 'jpeg' ? 'jpg' : fm[1]}`;
        fs.writeFileSync(path.join(DEX_ART_DIR, fname), fb);
        a.formImages[v] = fname;
        if (b.tick) dexSet(a.id, v, true);
        dexSave(); return sendJson(res, 200, { ok: true, img: dexFormImg(a, v) });
      }
      if (b.remove) {
        const cur = dexImg(a);   // her uploaded picture, or a file she dropped in that was matched by name/number
        if (cur) { try { fs.unlinkSync(path.join(DEX_ART_DIR, decodeURIComponent(cur.split('/').pop().split('?')[0]))); } catch (_e) {} }
        a.image = ''; dexArtList = null; dexSave(); return sendJson(res, 200, { ok: true });
      }
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 9 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = (dexSlug(a.number) || dexSlug(a.name) || a.id).slice(0, 30);
      if (a.image) { try { fs.unlinkSync(path.join(DEX_ART_DIR, a.image)); } catch (_e) {} }
      for (const e of ['png', 'jpg', 'jpeg', 'webp', 'gif']) { try { fs.unlinkSync(path.join(DEX_ART_DIR, `${base}.${e}`)); } catch (_e) {} }
      a.image = `${base}.${ext}`;
      fs.writeFileSync(path.join(DEX_ART_DIR, a.image), buffer);
      dexArtList = null; dexSave(); return sendJson(res, 200, { ok: true, img: dexImg(a) });
    }
    if (pathname === '/api/aniimo/test' && method === 'POST') {
      const b = await readBody(req); dexChatSeen.clear(); dexChatLast = 0;
      return sendJson(res, 200, { ok: true, reply: dexChat(cleanString(b.name) || 'TestViewer', [{ t: 'text', v: cleanString(b.text) }]) || 'ignored' });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown aniimo route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Aniimo Dex request failed.' });
  }
}

// ---------------------------------------------------------------------------
// FORTNITE SPRITES (Baby, 2026-10-18). Collection tracker for the season's sprites and their
// variants (Base, Gold, Quack, Cheat Master, Loot Hacker, Bounty Hunter, Trick or Treat...).
//   - Roster seeded once from config/sprites-c7s4.json (27 sprites / 162 variants), then owned by
//     data/sprites.json - she adds / edits / removes on the dashboard. Pictures in assets/sprites/.
//   - Dashboard /sprites-control.html: one panel per sprite with a circle per variant (like the game).
//   - "New season" archives the season to data/sprites-<season>.json and starts an empty list.
//   - GET /api/sprites gives stats + recent + the latest catch (for a stream overlay, still to design).
// ---------------------------------------------------------------------------
const SPR_FILE = path.join(DATA_DIR, 'sprites.json');
const SPR_SEED = path.join(APP_DIR, 'config', 'sprites-c7s4.json');
const SPR_ART_DIR = path.join(APP_DIR, 'assets', 'sprites');
try { fs.mkdirSync(SPR_ART_DIR, { recursive: true }); } catch (_error) {}
const SPR_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Exotic'];
const sprSlug = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const sprCleanVar = v => cleanString(v).replace(/[<>|]/g, '').slice(0, 40);
function sprClean(s, id) {
  const variants = [];
  for (const v of (Array.isArray(s.variants) ? s.variants : String(s.variants || '').split(/\r?\n|,/))) { const c = sprCleanVar(v); if (c && !variants.includes(c)) variants.push(c); }
  return { id: id || sprSlug(s.id || s.name), name: cleanString(s.name).replace(/[<>]/g, '').slice(0, 40), rarity: SPR_RARITIES.includes(s.rarity) ? s.rarity : 'Rare',
    variants: variants.length ? variants.slice(0, 20) : ['Base'], image: s.image && DECOR_IMAGE_EXT.test(String(s.image)) ? path.basename(String(s.image)) : '' };
}
function sprLoad() {
  const raw = readJson(SPR_FILE, null);
  const d = { season: 'Chapter 7 Season 4', sprites: [], caught: {}, recent: [], popupSec: 8, ...(raw || {}) };
  if (!raw) { const seed = readJson(SPR_SEED, null); if (seed) { d.season = seed.season || d.season; d.sprites = (seed.sprites || []).map(s => sprClean(s)).filter(s => s.id && s.name); } }
  d.caught = d.caught && typeof d.caught === 'object' ? d.caught : {};
  d.recent = Array.isArray(d.recent) ? d.recent.slice(0, 30) : [];
  return d;
}
let spr = sprLoad();
let sprPopup = null;
const sprKey = (id, v) => `${id}|${v}`;
const sprFind = id => spr.sprites.find(s => s.id === String(id));
function sprImg(s) {
  if (!s) return null;
  // Her uploaded picture, else a file named after the sprite id (e.g. assets/sprites/jonesy.png).
  const names = (s.image ? [s.image] : []).concat(['png', 'webp', 'jpg', 'jpeg', 'gif'].map(e => `${s.id}.${e}`));
  for (const f of names) { try { return `/assets/sprites/${encodeURIComponent(f)}?v=${Math.round(fs.statSync(path.join(SPR_ART_DIR, f)).mtimeMs)}`; } catch (_e) {} }
  return null;
}
// Drop-file import (2026-10-18): data/sprites-import.json = { caught: { "jonesy": ["Base","Gold"] } }
// is merged in (adds catches only) and renamed to sprites-import.imported-<ms>.json. Checked at
// start-up and every 3 s, so catches read from her screenshots can be added while ICB runs.
const SPR_IMPORT = path.join(DATA_DIR, 'sprites-import.json');
function sprImportCheck() {
  if (!fs.existsSync(SPR_IMPORT)) return;
  try {
    const d = readJson(SPR_IMPORT, null) || {}; let n = 0;
    for (const [id, vars] of Object.entries(d.caught || {})) {
      const s = sprFind(id) || spr.sprites.find(x => x.name.toLowerCase() === String(id).toLowerCase()); if (!s) continue;
      for (const v of (Array.isArray(vars) ? vars : [])) {
        const vv = s.variants.find(x => x.toLowerCase() === String(v).toLowerCase() || x.split(' ')[0].toLowerCase() === String(v).toLowerCase());
        if (vv && !spr.caught[sprKey(s.id, vv)]) { spr.caught[sprKey(s.id, vv)] = Date.now(); n++; }
      }
    }
    // Optional rarity fixes: { rarity: { "overshield": "Rare" } } (read from the game's card colours).
    for (const [id, r] of Object.entries(d.rarity || {})) { const s = sprFind(id); if (s && SPR_RARITIES.includes(r) && s.rarity !== r) { s.rarity = r; n++; } }
    fs.renameSync(SPR_IMPORT, path.join(DATA_DIR, `sprites-import.imported-${Date.now()}.json`));
    sprSave(); console.log(`[sprites] imported ${n} catches`);
  } catch (error) { console.log('[sprites] import failed:', error.message); }
}
sprImportCheck(); setInterval(sprImportCheck, 3000);
function sprStats() {
  let total = 0, done = 0, full = 0, base = 0; const byVar = {}, byRarity = {};
  for (const s of spr.sprites) {
    let n = 0;
    for (const v of s.variants) { total++; const has = !!spr.caught[sprKey(s.id, v)]; if (has) { done++; n++; } const o = byVar[v] || (byVar[v] = { done: 0, total: 0 }); o.total++; if (has) o.done++; }
    if (n === s.variants.length) full++;
    if (spr.caught[sprKey(s.id, s.variants[0])]) base++;
    const r = byRarity[s.rarity] || (byRarity[s.rarity] = { done: 0, total: 0 }); r.total += s.variants.length; r.done += n;
  }
  return { total, done, pct: total ? Math.round(done / total * 1000) / 10 : 0, sprites: spr.sprites.length, full, base, byVar, byRarity };
}
function sprPublic() {
  const now = Date.now();
  return { ok: true, season: spr.season, stats: sprStats(), recent: spr.recent.slice(0, 8).map(r => ({ ...r, img: sprImg(sprFind(r.id)) })),
    popup: sprPopup && sprPopup.until > now ? sprPopup : null, now };
}
function sprSave() { writeJson(SPR_FILE, spr); broadcast('sprites', sprPublic()); if (typeof stvPublic === 'function') broadcast('spritetv', stvPublic()); }
function sprSet(id, v, on) {
  const s = sprFind(id); if (!s || !s.variants.includes(v)) return false;
  const k = sprKey(s.id, v);
  if (on && !spr.caught[k]) {
    spr.caught[k] = Date.now();
    spr.recent = [{ id: s.id, name: s.name, variant: v, at: Date.now() }].concat(spr.recent.filter(r => !(r.id === s.id && r.variant === v))).slice(0, 30);
    const n = s.variants.filter(x => spr.caught[sprKey(s.id, x)]).length;
    sprPopup = { id: s.id, name: s.name, rarity: s.rarity, variant: v, img: sprImg(s), have: n, of: s.variants.length, complete: n === s.variants.length, at: Date.now(), until: Date.now() + (spr.popupSec || 8) * 1000 };
  } else if (!on && spr.caught[k]) { delete spr.caught[k]; spr.recent = spr.recent.filter(r => !(r.id === s.id && r.variant === v)); }
  return true;
}
async function handleSpritesApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/sprites/jar' || pathname.startsWith('/api/sprites/jar/')) return await handleSpriteJarApi(req, res, pathname, method);
    if (pathname === '/api/sprites' && method === 'GET') return sendJson(res, 200, sprPublic());
    if (pathname === '/api/sprites/admin' && method === 'GET') { const ap = sjArtPublic(), art = ap.urls; return sendJson(res, 200, { ...sprPublic(), needArt: ap.need, sprites: spr.sprites.map(s => ({ ...s, img: sprImg(s), art: art[s.id] || {} })), caught: spr.caught, rarities: SPR_RARITIES, popupSec: spr.popupSec }); }
    if (pathname === '/api/sprites' && method === 'POST') {
      const b = await readBody(req);
      if (b.catch && b.catch.id) {
        const had = !!spr.caught[sprKey(b.catch.id, sprCleanVar(b.catch.variant))];
        sprSet(b.catch.id, sprCleanVar(b.catch.variant), b.catch.on !== false);
        const s0 = sprFind(b.catch.id);   // jar overlay: play the float-into-the-book when she ticks it here (her switch)
        if (s0 && b.catch.on !== false && !had && sjCfg().dashPlays) sjPush(s0, sprCleanVar(b.catch.variant), { kind: 'catch' });
      }
      if (b.catchAll && b.catchAll.id) { const s = sprFind(b.catchAll.id); if (s) for (const v of s.variants) sprSet(s.id, v, b.catchAll.on !== false); }
      if (typeof b.season === 'string' && cleanString(b.season)) spr.season = cleanString(b.season).slice(0, 60);
      if (b.popupSec !== undefined) spr.popupSec = Math.max(2, Math.min(60, Math.round(Number(b.popupSec)) || 8));
      if (b.saveSprite) {
        const old = b.saveSprite.id ? sprFind(b.saveSprite.id) : null;
        const s = sprClean(b.saveSprite, old ? old.id : null);
        if (!s.name) return sendJson(res, 400, { ok: false, error: 'A sprite needs a name.' });
        if (old) { s.image = old.image; for (const v of old.variants) if (!s.variants.includes(v)) delete spr.caught[sprKey(old.id, v)]; Object.assign(old, s); }
        else { let id = s.id || 'sprite', n = 2; while (sprFind(id)) id = `${s.id}-${n++}`; s.id = id; spr.sprites.push(s); }
      }
      if (b.removeSprite) { const s = sprFind(b.removeSprite); if (s) { for (const v of s.variants) delete spr.caught[sprKey(s.id, v)]; spr.sprites = spr.sprites.filter(x => x !== s); spr.recent = spr.recent.filter(r => r.id !== s.id); } }
      if (b.move && b.move.id) { const i = spr.sprites.findIndex(s => s.id === b.move.id), j = i + (Number(b.move.dir) < 0 ? -1 : 1);
        if (i >= 0 && j >= 0 && j < spr.sprites.length) { const t = spr.sprites[i]; spr.sprites[i] = spr.sprites[j]; spr.sprites[j] = t; } }
      if (b.addVariantAll) { const v = sprCleanVar(b.addVariantAll); if (v) for (const s of spr.sprites) if (s.variants.length > 1 && !s.variants.includes(v)) s.variants.push(v); }
      // New season: save this season to its own file, then start fresh (keep sprites? her choice).
      if (b.newSeason) {
        const name = cleanString(b.newSeason).slice(0, 60);
        writeJson(path.join(DATA_DIR, `sprites-${sprSlug(spr.season) || 'old'}-${Date.now()}.json`), spr);
        spr = { season: name || 'New season', sprites: b.keepSprites ? spr.sprites : [], caught: {}, recent: [], popupSec: spr.popupSec, jar: spr.jar };
      }
      if (b.resetCatches === 'yes') { spr.caught = {}; spr.recent = []; }
      sprSave(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/sprites/image' && method === 'POST') {
      const b = await readBody(req); const s = sprFind(b.id);
      if (!s) return sendJson(res, 404, { ok: false, error: 'No sprite with that id.' });
      if (s.image) { try { fs.unlinkSync(path.join(SPR_ART_DIR, s.image)); } catch (_e) {} }
      if (b.remove) { s.image = ''; sprSave(); return sendJson(res, 200, { ok: true }); }
      const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
      if (!m) return sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
      const buf = Buffer.from(m[2], 'base64'); if (buf.length > 9 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
      s.image = `${s.id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      fs.writeFileSync(path.join(SPR_ART_DIR, s.image), buf);
      sprSave(); return sendJson(res, 200, { ok: true, img: sprImg(s) });
    }
    if (pathname === '/api/sprites/export' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="sprites-backup.json"' });
      return res.end(JSON.stringify(spr, null, 2));
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown sprites route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Sprites request failed.' });
  }
}

// ---------------------------------------------------------------------------
// SPRITE JAR + STICKER BOOK (Baby, 2026-10-18). Stream overlay for catching sprites:
// a glass jar holds every sprite this season; when she (or a mod on her list) types
// "!jonesy gold" the sticker book pops open and that sprite floats out of the jar into
// its sticker spot. Catches are the same as ticking the circle on the sprites dashboard.
//   - Overlay /sprite-jar.html (full-screen Meld layer), dashboard /sprite-jar-control.html.
//   - Settings live in data/sprites.json under "jar". Jar art: the unicorn jar pair in assets/resources
//     (JAR_BACK.png behind the sprites, JAR_FRONT.png over them); an uploaded picture in assets/sprite-jar/ replaces it.
//   - Meld doesn't tell ICB who is a mod, so she lists who may catch (default: her).
// ---------------------------------------------------------------------------
const SJ_DIR = path.join(APP_DIR, 'assets', 'sprite-jar');
try { fs.mkdirSync(SJ_DIR, { recursive: true }); } catch (_error) {}
function sjDefaults() {
  return { listen: true, visible: true, allowed: 'IJustABabyTv', needPrefix: false, dashPlays: false, removeComplete: false, jarHolds: 'stickers', leaveCaught: false, mode: 'floor', floorL: 2, floorR: 98, floorH: 16, floorB: 1, toySize: 100,
    bookStyle: 'propped', bookTheme: 'spooky', pbX: 1, pbW: 33, pbB: 1.5, pbTilt: -3, pbLean: 10, pbAuto: 0, baseBook: 170, baseToy: 140, baseCelebrate: true, bookOpen: false, catchOpens: true, avoidBook: false, mixSeed: 0,
    jarX: 3, jarY: 38, jarW: 17, bookX: 50, bookY: 50, bookW: 46, bookSec: 9, title: 'Sprite Sticker Book',
    jarImage: '', inL: 10, inT: 22, inW: 80, inH: 64, spriteSize: 100, epoch: 1 };
}
function sjCfg() { spr.jar = { ...sjDefaults(), ...(spr.jar || {}) }; return spr.jar; }
let sjEvents = [], sjSeq = 1, sjLastChat = [];
const sjLev = (a, b) => {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9; const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);   // swapped letters (jonsey)
  }
  return d[m][n];
};
// "jonesy gold", "one wish willow cheat", "jonsey" (typo ok), "crash bandicoot loot hacker"
function sjParse(words) {
  const flat = w => w.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let k = Math.min(words.length, 4); k >= 1; k--) {
    const c = flat(words.slice(0, k)); if (!c) continue;
    let s = spr.sprites.find(x => flat([x.id]) === c || flat([x.name]) === c);
    if (!s && c.length >= 5) s = spr.sprites.find(x => sjLev(flat([x.name]), c) <= (c.length >= 8 ? 2 : 1));
    if (!s) continue;
    const rest = words.slice(k).join(' ').toLowerCase().trim();
    if (!rest) return { s, v: s.variants[0] };
    const v = s.variants.find(x => x.toLowerCase() === rest) || s.variants.find(x => x.toLowerCase().split(' ').includes(rest.split(' ')[0]))
      || s.variants.find(x => x.toLowerCase().startsWith(rest.split(' ')[0]));
    return v ? { s, v } : { s, v: null, bad: rest };
  }
  return null;
}
function sjPush(s, v, extra) {
  const n = s.variants.filter(x => spr.caught[sprKey(s.id, x)]).length;
  const ev = { id: sjSeq++, sprite: s.id, name: s.name, rarity: s.rarity, variant: v, img: sjCut(s) || sprImg(s), have: n, of: s.variants.length,
    complete: n === s.variants.length, stats: sprStats(), at: Date.now(), ...(extra || {}) };
  sjEvents.push(ev); if (sjEvents.length > 100) sjEvents = sjEvents.slice(-100);
  return ev;
}
function sjCatch(s, v, who) {
  const already = !!spr.caught[sprKey(s.id, v)];
  if (!already) { sprSet(s.id, v, true); sprSave(); sjLastChat.push({ id: s.id, v }); if (sjLastChat.length > 20) sjLastChat.shift(); }
  sjPush(s, v, { kind: already ? 'already' : 'catch', who: who || '' });
  return already ? 'already' : 'caught';
}
// Page turning (2026-10-19): { kind: 'turn', dir: 1 | -1 } or { kind: 'turn', sprite: id }.
function sjTurn(dirOrId) {
  const ev = { id: sjSeq++, kind: 'turn', at: Date.now() };
  if (typeof dirOrId === 'number') ev.dir = dirOrId < 0 ? -1 : 1; else ev.sprite = String(dirOrId);
  sjEvents.push(ev); if (sjEvents.length > 100) sjEvents = sjEvents.slice(-100);
  return 'turn';
}
// Mix up the toys: a new layout seed (saved, so it sticks) + an event so the overlay animates the move.
function sjMix() {
  const c = sjCfg(); c.mixSeed = ((Number(c.mixSeed) || 0) + 1) % 100000;
  sjEvents.push({ id: sjSeq++, kind: 'shuffle', at: Date.now() }); if (sjEvents.length > 100) sjEvents = sjEvents.slice(-100);
  sprSave(); return 'mixed';
}
function sjChat(sender, parts) {
  const c = sjCfg(); if (!c.listen) return '';
  const name = cleanString(sender).replace(/^@/, '').toLowerCase();
  const ok = String(c.allowed || '').split(/[\s,]+/).map(x => x.toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (!name || !ok.includes(name)) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim();
  const m = /^!(\S+)\s*(.*)$/.exec(text); if (!m) return '';
  let cmd = m[1].toLowerCase(), words = m[2].split(/\s+/).filter(Boolean);
  // "!open" / "!close": the propped book lies closed on the floor until she opens it (2026-10-19)
  if (cmd === 'mix' || cmd === 'shuffle') return sjMix();
  if (cmd === 'open' || cmd === 'close') { c.bookOpen = cmd === 'open'; sprSave(); return cmd; }
  if (cmd === 'undo' || cmd === 'unsticker') {
    const last = sjLastChat.pop(); const s = last && sprFind(last.id); if (!s) return '';
    sprSet(s.id, last.v, false); sprSave(); sjPush(s, last.v, { kind: 'undo' }); return 'undone';
  }
  // "!page" next page, "!page back" previous, "!page jonesy" / "!book jonesy" turns to that sprite
  if (cmd === 'page' || ((cmd === 'book' || cmd === 'stickers') && words.length)) {
    const w = words.join(' ').toLowerCase();
    if (!w || ['next', 'forward', '>'].includes(w)) return sjTurn(1);
    if (['back', 'prev', 'previous', '<', 'last'].includes(w)) return sjTurn(-1);
    const r = sjParse(words); return r ? sjTurn(r.s.id) : '';
  }
  if (cmd === 'book' || cmd === 'stickers') { const s = (spr.recent[0] && sprFind(spr.recent[0].id)) || spr.sprites[0]; if (s) sjPush(s, '', { kind: 'peek' }); return 'peek'; }
  if (['catch', 'sticker', 'sprite', 'caught'].includes(cmd)) { /* "!catch jonesy gold" */ }
  else if (c.needPrefix) return '';
  else words = [m[1]].concat(words);
  const r = sjParse(words); if (!r) return '';
  if (!r.v) { sjPush(r.s, '', { kind: 'unknown', bad: r.bad }); return 'no-variant'; }
  return sjCatch(r.s, r.v, sender);
}
// Sticker art (2026-10-19): assets/sprites/<Sprite Name>/<Name>_<Variant>.png, e.g. Jonesy/Jonesy_Gold.png,
// Jonesy/Jonesy.png = Base. Folder and file names are matched loosely (case, spaces, "Adventrue" typo).
// Her art is ~1250 px, so the browser (dashboard or overlay) makes 256 px copies in
// assets/sprite-jar/stickers/<id>__<variant>-<source mtime>.webp; a newer source file makes a new copy.
const SJ_STK_DIR = path.join(SJ_DIR, 'stickers');
try { fs.mkdirSync(SJ_STK_DIR, { recursive: true }); } catch (_error) {}
const sjFlat = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function sjArtScan() {
  const out = {};
  let dirs = []; try { dirs = fs.readdirSync(SPR_ART_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (_e) {}
  let thumbs = []; try { thumbs = fs.readdirSync(SJ_STK_DIR); } catch (_e) {}
  for (const sp of spr.sprites) {
    const dir = dirs.find(d => sjFlat(d) === sjFlat(sp.name) || sjFlat(d) === sjFlat(sp.id)); if (!dir) continue;
    let files = []; try { files = fs.readdirSync(path.join(SPR_ART_DIR, dir)).filter(f => /\.(png|webp|jpe?g|gif)$/i.test(f)); } catch (_e) {}
    for (const f of files) {
      const stem = f.replace(/\.[a-z0-9]+$/i, ''), us = stem.indexOf('_');
      let v = null;
      let score = 3;
      if (us < 0) v = sp.variants[0];
      else {
        const raw = stem.slice(us + 1), suf = sjFlat(raw);
        v = sp.variants.find(x => sjFlat(x) === suf); score = 3;
        if (!v) { v = sp.variants.find(x => sjFlat(x).startsWith(suf) || suf.startsWith(sjFlat(x))); score = 2; }
        if (!v && suf === 'base') { v = sp.variants[0]; score = 3; }
        if (!v) {   // near-miss names like "Klombo_Loot_Master": go by the first word (Loot -> Loot Hacker) when only one variant starts with it
          const w0 = sjFlat(raw.split(/[_\s-]+/)[0]), hits = sp.variants.filter(x => w0 && sjFlat(x.split(/\s+/)[0]) === w0);
          if (hits.length === 1) { v = hits[0]; score = 1; }
        }
      }
      if (!v) continue;
      let st = null; try { st = fs.statSync(path.join(SPR_ART_DIR, dir, f)); } catch (_e) { continue; }
      const mt = Math.round(st.mtimeMs), isWebp = /\.webp$/i.test(f), had = (out[sp.id] || {})[v];
      if (had && had.score > score) continue;   // an exact name beats a near-miss
      if (had && had.score === score && had.webp && !isWebp) continue;   // her small .webp copy wins over the big .png (2026-10-19)
      const key = `${sp.id}__${sprSlug(v)}`, thumb = `${key}-${mt}.webp`;
      const src = `/assets/sprites/${encodeURIComponent(dir)}/${encodeURIComponent(f)}`;
      const direct = isWebp && st.size <= 700 * 1024;   // small webp: use it as-is, no copy needed
      (out[sp.id] || (out[sp.id] = {}))[v] = { src, key, thumb, webp: isWebp, score, direct: direct ? `${src}?v=${mt}` : null, ready: direct || thumbs.includes(thumb) };
    }
  }
  return out;
}
function sjArtPublic() {
  const art = sjArtScan(), urls = {}, need = [];
  for (const [id, vs] of Object.entries(art)) for (const [v, a] of Object.entries(vs)) {
    if (a.direct) (urls[id] || (urls[id] = {}))[v] = a.direct;
    else if (a.ready) (urls[id] || (urls[id] = {}))[v] = `/assets/sprite-jar/stickers/${encodeURIComponent(a.thumb)}`;
    else need.push({ id, variant: v, src: a.src });
  }
  return { urls, need };
}
// The jar uses the see-through cut-out (same picture as the chat avatar, assets/avatars/<id>.png) when there is one.
function sjCut(s) {
  for (const e of ['png', 'webp', 'gif']) { const f = `${s.id}.${e}`; try { return `/assets/avatars/${f}?v=${Math.round(fs.statSync(path.join(APP_DIR, 'assets', 'avatars', f)).mtimeMs)}`; } catch (_e) {} }
  return null;
}
function sjPublic() {
  const c = sjCfg(), art = sjArtPublic();
  return { ok: true, season: spr.season, settings: { ...c, jarBack: '/resource-art/JAR_BACK.png', jarFront: '/resource-art/JAR_FRONT.png', jarUrl: c.jarImage ? `/assets/sprite-jar/${encodeURIComponent(c.jarImage)}?v=${(() => { try { return Math.round(fs.statSync(path.join(SJ_DIR, c.jarImage)).mtimeMs); } catch (_e) { return 0; } })()}` : '' },
    sprites: spr.sprites.map(s => ({ id: s.id, name: s.name, rarity: s.rarity, img: sjCut(s) || sprImg(s), variants: s.variants, caught: s.variants.filter(v => spr.caught[sprKey(s.id, v)]), art: art.urls[s.id] || {} })),
    needArt: art.need,
    stats: sprStats(), recent: spr.recent[0] ? spr.recent[0].id : null, last: sjSeq - 1 };
}
async function handleSpriteJarApi(req, res, pathname, method) {
  if (pathname === '/api/sprites/jar' && method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams, since = Number(q.get('since')) || 0;
    return sendJson(res, 200, { ...sjPublic(), events: q.get('first') ? [] : sjEvents.filter(e => e.id > since) });
  }
  if (pathname === '/api/sprites/jar' && method === 'POST') {
    const b = await readBody(req), c = sjCfg();
    for (const k of ['listen', 'visible', 'needPrefix', 'dashPlays', 'removeComplete', 'leaveCaught', 'baseCelebrate', 'bookOpen', 'catchOpens', 'avoidBook']) if (typeof b[k] === 'boolean') c[k] = b[k];
    if (['stickers', 'sprites'].includes(b.jarHolds)) c.jarHolds = b.jarHolds;
    if (['jar', 'floor'].includes(b.mode)) c.mode = b.mode;
    if (['propped', 'pop'].includes(b.bookStyle)) c.bookStyle = b.bookStyle;   // propped = always on screen, leaning on the floor (2026-10-19)
    if (['spooky', 'cute'].includes(b.bookTheme)) c.bookTheme = b.bookTheme;   // floor = toys scattered along the bottom of the stream (2026-10-19)
    const nums = { jarX: [0, 95], jarY: [0, 95], jarW: [4, 60], bookX: [10, 90], bookY: [10, 90], bookW: [20, 90], bookSec: [3, 60], inL: [0, 90], inT: [0, 90], inW: [10, 100], inH: [10, 100], spriteSize: [30, 250], floorL: [0, 90], floorR: [10, 100], floorH: [3, 60], floorB: [0, 60], toySize: [30, 300], pbX: [0, 80], pbW: [10, 60], pbB: [0, 60], pbTilt: [-20, 20], pbLean: [0, 40], pbAuto: [0, 300], baseBook: [100, 230], baseToy: [60, 250] };
    for (const [k, [lo, hi]] of Object.entries(nums)) if (b[k] !== undefined && Number.isFinite(Number(b[k]))) c[k] = Math.max(lo, Math.min(hi, Number(b[k])));
    for (const k of ['allowed', 'title']) if (typeof b[k] === 'string') c[k] = cleanString(b[k]).slice(0, 400);
    if (b.play && b.play.id) { const s = sprFind(b.play.id); const v = s && (s.variants.includes(b.play.variant) ? b.play.variant : s.variants[0]); if (s) sjPush(s, v, { kind: 'catch', test: true }); }
    if (b.catchCmd) { const r = sjParse(String(b.catchCmd).replace(/^!/, '').split(/\s+/).filter(Boolean)); if (!r || !r.v) return sendJson(res, 400, { ok: false, error: 'No sprite/variant matches that.' }); sjCatch(r.s, r.v, 'dashboard'); }
    if (b.showBook) { const s = (spr.recent[0] && sprFind(spr.recent[0].id)) || spr.sprites[0]; if (s) sjPush(s, '', { kind: 'peek' }); }
    if (b.shuffle) sjMix();
    if (b.turn) sjTurn(b.turn.sprite ? String(b.turn.sprite) : Number(b.turn.dir) || 1);
    if (b.removeJar) { if (c.jarImage) { try { fs.unlinkSync(path.join(SJ_DIR, c.jarImage)); } catch (_e) {} } c.jarImage = ''; }
    if (b.reset) c.epoch++;
    sprSave(); return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/sprites/jar/sticker' && method === 'POST') {
    const b = await readBody(req), a = (sjArtScan()[String(b.id)] || {})[String(b.variant)];
    if (!a) return sendJson(res, 404, { ok: false, error: 'No sticker art for that.' });
    const m = /^data:image\/(webp|png);base64,(.+)$/.exec(String(b.dataUrl || ''));
    if (!m) return sendJson(res, 400, { ok: false, error: 'Bad picture.' });
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Too large.' });
    for (const f of fs.readdirSync(SJ_STK_DIR)) if (f.startsWith(a.key + '-')) { try { fs.unlinkSync(path.join(SJ_STK_DIR, f)); } catch (_e) {} }
    fs.writeFileSync(path.join(SJ_STK_DIR, a.thumb), buf);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/sprites/jar/image' && method === 'POST') {
    const b = await readBody(req), c = sjCfg();
    const m = /^data:image\/(png|webp|gif|jpeg|jpg);base64,(.+)$/.exec(String(b.dataUrl || ''));
    if (!m) return sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, WEBP, GIF, or JPG.' });
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 12 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
    if (c.jarImage) { try { fs.unlinkSync(path.join(SJ_DIR, c.jarImage)); } catch (_e) {} }
    c.jarImage = `jar-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`; fs.writeFileSync(path.join(SJ_DIR, c.jarImage), buf);
    sprSave(); return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { ok: false, error: 'Unknown sprite jar route.' });
}

// ---------------------------------------------------------------------------
// SPRITE TV (Baby, 2026-10-22). A tiny retro-TV overlay showing the last sprite
// caught (image + name + variant), styled like a CRT screen. Sits over her little
// TV prop in the stream layout. Dashboard: /sprite-tv-control.html.
//   - Overlay: /sprite-tv.html  (Meld layer over the TV)
//   - Settings: data/sprite-tv.json
//   - SSE channel: 'spritetv'
// ---------------------------------------------------------------------------
const STV_FILE = path.join(DATA_DIR, 'sprite-tv.json');
function stvDefaults() {
  return {
    visible: true,
    mode: 'last',           // 'last' = auto (most recent catch), 'pinned' = manual pick
    pinnedId: '',           // sprite id when mode === 'pinned'
    pinnedVariant: '',      // variant when pinned
    showName: true,
    showVariant: true,
    showRarity: true,       // colour the name by rarity
    flashMs: 500,           // white-flash duration on new catch
    staticMs: 240,          // static-burst duration on channel change
    idleBars: true,         // show colour bars when nothing caught yet
    textPos: 'bottom',      // 'bottom', 'top', 'overlay' (over the image)
    textSize: 100,          // percentage scale for text (50-200)
    imgSize: 100,           // percentage scale for sprite image (30-200)
    // slideshow / broadcast interrupt
    slideshow: false,        // enable the slideshow loop
    ssDelay: 8,              // seconds of idle bars before slideshow starts
    ssInterval: 5,           // seconds each sprite shows
    ssPool: 'caught',        // 'caught', 'uncaught', 'all'
    ssMessage: 'WE INTERRUPT THIS BROADCAST...', // interrupt banner text
    ssSubMessage: 'HAVE YOU SEEN THESE SPRITES?', // subtitle
    ssShowInterrupt: true,   // show the interrupt banner before slideshow
    seq: 1
  };
}
function stvLoad() { const raw = readJson(STV_FILE, null) || {}; return { ...stvDefaults(), ...raw }; }
let stv = stvLoad();
function stvSave() { writeJson(STV_FILE, stv); broadcast('spritetv', stvPublic()); }
function stvPublic() {
  const last = spr.recent && spr.recent[0] ? spr.recent[0] : null;
  let display = null;
  if (stv.mode === 'pinned' && stv.pinnedId) {
    const s = sprFind(stv.pinnedId);
    if (s) {
      const v = stv.pinnedVariant || 'Base';
      display = { id: s.id, name: s.name, variant: v, rarity: s.rarity, img: sprImg(s) };
    }
  }
  if (!display && last) {
    const s = sprFind(last.id);
    display = { id: last.id, name: last.name, variant: last.variant, rarity: s ? s.rarity : '', img: last.img || (s ? sprImg(s) : null) };
  }
  // variant art from the sticker scan
  if (display) {
    const art = (sjArtPublic().urls[display.id] || {})[display.variant];
    if (art) display.variantImg = art;
  }
  return { ok: true, settings: stv, display, now: Date.now() };
}
// Build the slideshow sprite list based on pool setting
function stvSlideshow() {
  const allSprites = spr.all || [];
  const caughtIds = new Set((spr.recent || []).map(r => r.id));
  const artUrls = sjArtPublic().urls || {};
  let pool = [];
  if (stv.ssPool === 'caught') {
    // recently caught sprites (unique)
    const seen = new Set();
    for (const r of (spr.recent || [])) {
      if (seen.has(r.id + '|' + r.variant)) continue;
      seen.add(r.id + '|' + r.variant);
      const s = sprFind(r.id);
      const art = (artUrls[r.id] || {})[r.variant];
      pool.push({ id: r.id, name: r.name, variant: r.variant, rarity: s ? s.rarity : '', img: art || (s ? sprImg(s) : r.img) });
    }
  } else if (stv.ssPool === 'uncaught') {
    for (const s of allSprites) {
      if (caughtIds.has(s.id)) continue;
      const art = (artUrls[s.id] || {})['Base'];
      pool.push({ id: s.id, name: s.name, variant: 'Base', rarity: s.rarity || '', img: art || sprImg(s) });
    }
  } else {
    for (const s of allSprites) {
      const art = (artUrls[s.id] || {})['Base'];
      pool.push({ id: s.id, name: s.name, variant: 'Base', rarity: s.rarity || '', img: art || sprImg(s) });
    }
  }
  return pool;
}
async function handleSpriteTvApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/sprite-tv' && method === 'GET') return sendJson(res, 200, stvPublic());
    if (pathname === '/api/sprite-tv/slideshow' && method === 'GET') return sendJson(res, 200, { ok: true, sprites: stvSlideshow() });
    if (pathname === '/api/sprite-tv' && method === 'POST') {
      const b = await readBody(req), s = b.set || {};
      for (const k of ['visible', 'showName', 'showVariant', 'showRarity', 'idleBars', 'slideshow', 'ssShowInterrupt']) if (typeof s[k] === 'boolean') stv[k] = s[k];
      if (typeof s.mode === 'string' && ['last', 'pinned'].includes(s.mode)) stv.mode = s.mode;
      if (typeof s.pinnedId === 'string') stv.pinnedId = cleanString(s.pinnedId).slice(0, 60);
      if (typeof s.pinnedVariant === 'string') stv.pinnedVariant = cleanString(s.pinnedVariant).slice(0, 40);
      if (typeof s.textPos === 'string' && ['bottom', 'top', 'overlay'].includes(s.textPos)) stv.textPos = s.textPos;
      if (typeof s.ssPool === 'string' && ['caught', 'uncaught', 'all'].includes(s.ssPool)) stv.ssPool = s.ssPool;
      if (typeof s.ssMessage === 'string') stv.ssMessage = cleanString(s.ssMessage).slice(0, 120);
      if (typeof s.ssSubMessage === 'string') stv.ssSubMessage = cleanString(s.ssSubMessage).slice(0, 120);
      for (const [k, lo, hi] of [['flashMs', 0, 2000], ['staticMs', 0, 2000], ['textSize', 50, 200], ['imgSize', 30, 200], ['ssDelay', 1, 120], ['ssInterval', 2, 60]]) {
        if (s[k] !== undefined && Number.isFinite(Number(s[k]))) stv[k] = Math.max(lo, Math.min(hi, Math.round(Number(s[k]))));
      }
      stv.seq++;
      stvSave();
      return sendJson(res, 200, stvPublic());
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown sprite-tv route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Sprite TV request failed.' });
  }
}

// ---------------------------------------------------------------------------
// COUNTDOWNS (Baby, 2026-10-19). Replaces her Meld/Spark "timer-7pm-cst" element with an ICB one she
// controls from the dashboard: themes, size, position, text, the message when it's over.
//   - Overlay /countdown.html?id=<id> (one Meld layer per countdown), dashboard /countdown-control.html.
//   - data/countdowns.json { list: [ { id, name, ...look/text settings, status, endsAt, leftMs } ] }
//   - status: idle | running | paused | done. endsAt = ms epoch while running; leftMs while paused.
// ---------------------------------------------------------------------------
const CD_FILE = path.join(DATA_DIR, 'countdowns.json');
function cdDefaults(id, name) {
  return { id, name: name || 'Countdown', heading: 'STREAM STARTS IN', subheading: 'GRAB A SNACK 🌸', endText: '✨ WE\'RE LIVE! ✨', endSub: '',
    icon: '✨', theme: 'flowtree', font: 'Outfit', accent1: '#38bdf8', accent2: '#c084fc', textColor: '#ffffff', plate: '#1c1130', plateAlpha: 92,
    scale: 100, x: 50, y: 50, showHours: 'auto', showLabels: true, showBadge: true, showSub: true, pulseDot: true, floaty: true, flowBorder: true,
    labelH: 'HOURS', labelM: 'MINUTES', labelS: 'SECONDS', celebrate: true, hideAfter: 0, idleShow: 'dim',
    lastMinutes: 10, lastTime: '19:00', lastTz: 'America/Chicago', status: 'idle', endsAt: 0, leftMs: 0, doneAt: 0 };
}
function cdLoad() {
  const raw = readJson(CD_FILE, null);
  const list = raw && Array.isArray(raw.list) && raw.list.length ? raw.list : [cdDefaults('main', 'Main countdown')];
  return { list: list.map(c => ({ ...cdDefaults(c.id, c.name), ...c })) };
}
let cdState = cdLoad();
function cdSave() { writeJson(CD_FILE, cdState); broadcast('countdowns', { ok: true }); }
const cdFind = id => cdState.list.find(c => c.id === String(id || 'main')) || null;
function cdTick() {   // a running countdown that reaches zero becomes "done" (so the dashboard shows it too)
  let changed = false; const now = Date.now();
  for (const c of cdState.list) if (c.status === 'running' && c.endsAt && c.endsAt <= now) { c.status = 'done'; c.doneAt = c.endsAt; changed = true; }
  if (changed) cdSave();
}
setInterval(cdTick, 1000);
const CD_TEXT = ['name', 'heading', 'subheading', 'endText', 'endSub', 'icon', 'labelH', 'labelM', 'labelS', 'lastTime', 'lastTz'];
const CD_THEMES = ['flowtree', 'spooky', 'pink', 'gold', 'fortnite', 'glass', 'custom'];
const CD_FONTS = ['Outfit', 'Comfortaa', 'Fredoka', 'Chewy', 'Creepster', 'Bungee', 'Quicksand', 'Orbitron'];
async function handleCountdownsApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/countdowns' && method === 'GET') {
      cdTick();
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      if (id) { const c = cdFind(id); return sendJson(res, c ? 200 : 404, c ? { ok: true, countdown: c, now: Date.now() } : { ok: false, error: 'No countdown with that id.' }); }
      return sendJson(res, 200, { ok: true, list: cdState.list, themes: CD_THEMES, fonts: CD_FONTS, now: Date.now() });
    }
    if (pathname === '/api/countdowns' && method === 'POST') {
      const b = await readBody(req), now = Date.now();
      if (b.add) {
        let id = sprSlug(b.add.name || 'countdown') || 'countdown', n = 2, base = id;
        while (cdFind(id)) id = `${base}-${n++}`;
        const src = b.add.copyFrom ? cdFind(b.add.copyFrom) : null;
        cdState.list.push({ ...(src ? { ...src, status: 'idle', endsAt: 0, leftMs: 0 } : cdDefaults(id)), id, name: cleanString(b.add.name || 'Countdown').slice(0, 40) });
        cdSave(); return sendJson(res, 200, { ok: true, id });
      }
      if (b.remove) { if (cdState.list.length > 1) cdState.list = cdState.list.filter(c => c.id !== String(b.remove)); cdSave(); return sendJson(res, 200, { ok: true }); }
      const c = cdFind(b.id); if (!c) return sendJson(res, 404, { ok: false, error: 'No countdown with that id.' });
      const s = b.set || {};
      for (const k of CD_TEXT) if (typeof s[k] === 'string') c[k] = cleanString(s[k]).slice(0, 120);
      for (const k of ['showLabels', 'showBadge', 'showSub', 'pulseDot', 'floaty', 'flowBorder', 'celebrate']) if (typeof s[k] === 'boolean') c[k] = s[k];
      for (const k of ['accent1', 'accent2', 'textColor', 'plate']) if (/^#[0-9a-f]{6}$/i.test(String(s[k] || ''))) c[k] = s[k];
      const nums = { plateAlpha: [0, 100], scale: [20, 400], x: [0, 100], y: [0, 100], hideAfter: [0, 3600], lastMinutes: [0, 1440] };
      for (const [k, [lo, hi]] of Object.entries(nums)) if (s[k] !== undefined && Number.isFinite(Number(s[k]))) c[k] = Math.max(lo, Math.min(hi, Number(s[k])));
      if (CD_THEMES.includes(s.theme)) c.theme = s.theme;
      if (CD_FONTS.includes(s.font)) c.font = s.font;
      if (['auto', 'always', 'never'].includes(s.showHours)) c.showHours = s.showHours;
      if (['dim', 'zeros', 'hide'].includes(s.idleShow)) c.idleShow = s.idleShow;
      // Timer actions
      const a = b.action;
      if (a === 'start') {   // { ms } from now, or { endsAt } (clock time worked out on the dashboard)
        const end = Number(b.endsAt) > now ? Number(b.endsAt) : now + Math.max(1000, Number(b.ms) || 0);
        c.endsAt = end; c.leftMs = 0; c.status = 'running';
      } else if (a === 'pause' && c.status === 'running') { c.leftMs = Math.max(0, c.endsAt - now); c.status = 'paused'; }
      else if (a === 'resume' && c.status === 'paused') { c.endsAt = now + c.leftMs; c.status = 'running'; }
      else if (a === 'addTime') {   // +/- minutes on a running, paused or finished timer
        const d = Number(b.ms) || 0;
        if (c.status === 'running') c.endsAt = Math.max(now + 1000, c.endsAt + d);
        else if (c.status === 'paused') c.leftMs = Math.max(1000, c.leftMs + d);
        else if (d > 0) { c.endsAt = now + d; c.status = 'running'; }
      } else if (a === 'finish') { c.status = 'done'; c.doneAt = now; c.endsAt = now; }
      else if (a === 'reset') { c.status = 'idle'; c.endsAt = 0; c.leftMs = 0; }
      cdSave(); return sendJson(res, 200, { ok: true, countdown: c, now });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown countdowns route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Countdowns request failed.' });
  }
}

// ---------------------------------------------------------------------------
// TEAM HUNT (Baby, 2026-10-19). ICB version of her Meld "cloth-team-contest" widget, bigger:
//   - As many teams as she wants. Chat joins with "!team a" (or the team's own key/name).
//   - Several things to hunt at once, each with its own command + points: "!cloth" = 10 pts,
//     "!plushie" = 8 pts... "!cloth 2" = found 2. Finds are saved per item, so changing an
//     item's points later re-scores everyone.
//   - Contest timer (start/pause/reset from the dashboard), winner banner when it ends.
//   - Overlay /hunt.html, dashboard /hunt-control.html, data/hunt.json.
// ---------------------------------------------------------------------------
const HUNT_FILE = path.join(DATA_DIR, 'hunt.json');
const HUNT_COLORS = ['#06b6d4', '#d946ef', '#f59e0b', '#22c55e', '#f43f5e', '#8b5cf6', '#14b8a6', '#eab308', '#3b82f6', '#ec4899', '#84cc16', '#f97316'];
function huntDefaults() {
  return { title: 'Team Hunt', subtitle: 'Find them in Palia - type the command when you get one!', visible: true, joinOpen: true, scoring: true, lockTeams: true,
    ignore: 'Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Sery_Bot, MixItUpBot',
    teams: [{ key: 'a', name: 'Team A', color: HUNT_COLORS[0] }, { key: 'b', name: 'Team B', color: HUNT_COLORS[1] }],
    items: [{ command: 'cloth', aliases: 'cloths', label: 'Tattered Cloth', pts: 10, icon: '🧵', image: '' }, { command: 'plushie', aliases: 'plush, plushies', label: 'Plushie', pts: 8, icon: '🧸', image: '' }],
    players: {}, log: [], seq: 1,
    timer: { minutes: 60, status: 'idle', endsAt: 0, leftMs: 0 }, stopAtEnd: true,
    look: { theme: 'spooky', scale: 100, x: 50, y: 50, width: 46, showPlayers: 8, showLegend: true, showTicker: true, showTimer: true, showBar: true },
    epoch: 1 };
}
const huntKey = v => cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
function huntCleanTeam(t, i) {
  return { key: huntKey(t.key) || 'abcdefghijklmnopqrstuvwxyz'[i % 26], name: cleanString(t.name).slice(0, 30) || `Team ${String(t.key || i + 1).toUpperCase()}`,
    color: /^#[0-9a-f]{6}$/i.test(String(t.color || '')) ? t.color : HUNT_COLORS[i % HUNT_COLORS.length] };
}
function huntCleanItem(o) {
  const image = o.image ? path.basename(String(o.image)) : '';
  return { command: huntKey(o.command) || 'point', aliases: String(o.aliases || '').split(/[\s,]+/).map(huntKey).filter(Boolean).slice(0, 8).join(', '),
    label: cleanString(o.label).slice(0, 40), pts: Math.max(-1000, Math.min(100000, Math.round(Number(o.pts)) || 0)), icon: cleanString(o.icon).slice(0, 8),
    image: image && DECOR_IMAGE_EXT.test(image) ? image : '' };
}
function huntLoad() {
  const raw = readJson(HUNT_FILE, null) || {}, d = huntDefaults();
  const h = { ...d, ...raw, timer: { ...d.timer, ...(raw.timer || {}) }, look: { ...d.look, ...(raw.look || {}) } };
  h.teams = (Array.isArray(h.teams) && h.teams.length ? h.teams : d.teams).slice(0, 26).map(huntCleanTeam);
  h.items = (Array.isArray(h.items) ? h.items : d.items).slice(0, 20).map(huntCleanItem);
  h.players = h.players && typeof h.players === 'object' ? h.players : {};
  for (const p of Object.values(h.players)) if (!p.finds || typeof p.finds !== 'object') p.finds = {};
  h.log = Array.isArray(h.log) ? h.log.slice(-200) : [];
  return h;
}
let hunt = huntLoad();
function huntSave() { writeJson(HUNT_FILE, hunt); broadcast('hunt', { ok: true }); }
function huntPts(p) { let s = 0; for (const it of hunt.items) s += (Number(p.finds[it.command]) || 0) * it.pts; return s; }
function huntTimerLeft(now) { const t = hunt.timer; return t.status === 'running' ? Math.max(0, t.endsAt - now) : t.status === 'paused' ? t.leftMs : t.status === 'idle' ? t.minutes * 60000 : 0; }
function huntTick() {
  const t = hunt.timer;
  if (t.status === 'running' && t.endsAt <= Date.now()) { t.status = 'ended'; if (hunt.stopAtEnd) hunt.scoring = false; huntLog({ kind: 'end' }); huntSave(); }
}
setInterval(huntTick, 1000);
function huntBoard() {
  const board = hunt.teams.map(t => ({ key: t.key, name: t.name, color: t.color, total: 0, players: [] }));
  const by = new Map(board.map(b => [b.key, b]));
  for (const p of Object.values(hunt.players)) {
    const b = by.get(p.team); if (!b) continue;
    const pts = huntPts(p); b.players.push({ name: p.name, points: pts, joined: p.joined || 0 }); b.total += pts;
  }
  for (const b of board) b.players.sort((x, y) => (y.points - x.points) || (x.joined - y.joined));
  const max = board.reduce((a, b) => Math.max(a, b.total), 0);
  for (const b of board) b.leading = max > 0 && b.total === max;
  return board;
}
function huntPublic() {
  const now = Date.now();
  return { ok: true, title: hunt.title, subtitle: hunt.subtitle, visible: hunt.visible, joinOpen: hunt.joinOpen, scoring: hunt.scoring, look: hunt.look, epoch: hunt.epoch,
    items: hunt.items.map(it => ({ ...it, imageUrl: it.image ? `/assets/resources/${encodeURIComponent(it.image)}` : null })),
    teams: hunt.teams, board: huntBoard(), timer: { status: hunt.timer.status, minutes: hunt.timer.minutes, endsAt: hunt.timer.endsAt, left: huntTimerLeft(now) },
    recent: hunt.log.slice(-10), last: hunt.seq - 1, now };
}
function huntLog(e) { e.id = hunt.seq++; e.at = Date.now(); hunt.log.push(e); if (hunt.log.length > 200) hunt.log = hunt.log.slice(-200); }
const huntTeamName = k => { const t = hunt.teams.find(x => x.key === k); return t ? t.name : `Team ${String(k).toUpperCase()}`; };
function huntFindTeam(word) {
  const w = huntKey(word); if (!w) return null;
  return hunt.teams.find(t => t.key === w) || hunt.teams.find(t => huntKey(t.name) === w) || hunt.teams.find(t => huntKey(t.name.replace(/^team\s*/i, '')) === w) || null;
}
function huntAdd(key, cmd, n, how) {
  const p = hunt.players[key]; if (!p) return '';
  const it = hunt.items.find(x => x.command === cmd); if (!it) return '';
  const before = Number(p.finds[cmd]) || 0, after = Math.max(0, before + n), applied = after - before;
  if (!applied) return `${p.name} has none to take away`;
  p.finds[cmd] = after;
  huntLog({ kind: 'find', name: p.name, key, team: p.team, item: cmd, label: it.label, icon: it.icon, n: applied, pts: applied * it.pts, total: huntPts(p), how });
  huntSave(); return `${p.name} ${applied > 0 ? '+' : ''}${applied} ${it.label || cmd} (${applied * it.pts > 0 ? '+' : ''}${applied * it.pts} pts)`;
}
function huntChat(name, parts) {
  name = cleanString(name).replace(/^@/, '').slice(0, 40);
  if (!name) return '';
  if (String(hunt.ignore || '').split(/[\s,]+/).map(s => s.toLowerCase().replace(/^@/, '')).filter(Boolean).includes(name.toLowerCase())) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim();
  if (text[0] !== '!') return '';
  const key = name.toLowerCase();
  let m = /^!(?:team|join)\s+(.+)$/i.exec(text);
  if (m) {
    const t = huntFindTeam(m[1].split(/\s+/)[0]) || huntFindTeam(m[1]);
    if (!t) return `${name}: there is no team "${m[1]}"`;
    const ex = hunt.players[key];
    if (ex && ex.team === t.key) return `${name} is already on ${t.name}`;
    if (ex && ex.team && hunt.lockTeams) return `${name} is already on ${huntTeamName(ex.team)} (locked)`;
    if (!hunt.joinOpen) return `${name}: joining is closed`;
    hunt.players[key] = { name, team: t.key, finds: (ex && ex.finds) || {}, joined: (ex && ex.joined) || Date.now() };
    huntLog({ kind: 'join', name, team: t.key }); huntSave();
    return `${name} joined ${t.name}`;
  }
  m = /^!([a-z0-9_]+)(?:\s+([+-]?)\s*(\d{1,3}))?(?:\s|$)/i.exec(text);
  if (!m) return '';
  const c = m[1].toLowerCase();
  const it = hunt.items.find(x => x.command === c || (x.aliases && x.aliases.split(/,\s*/).includes(c)));
  if (!it) return '';
  if (!hunt.scoring) return `${name}: the hunt isn't scoring right now`;
  const p = hunt.players[key];
  if (!p || !hunt.teams.some(t => t.key === p.team)) { huntLog({ kind: 'noteam', name, item: it.command }); huntSave(); return `${name} isn't on a team yet`; }
  let n = m[3] ? Math.min(50, Number(m[3])) : 1; if (m[2] === '-') n = -n;
  return n ? huntAdd(key, it.command, n, 'chat') : '';
}
async function handleHuntApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/hunt' && method === 'GET') { huntTick(); return sendJson(res, 200, huntPublic()); }
    if (pathname === '/api/hunt/admin' && method === 'GET') {
      const art = (() => { try { return fs.readdirSync(RESOURCE_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b)); } catch (_e) { return []; } })();
      const players = Object.entries(hunt.players).map(([key, p]) => ({ key, name: p.name, team: p.team, finds: p.finds, points: huntPts(p) })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      return sendJson(res, 200, { ...huntPublic(), settings: { ignore: hunt.ignore, lockTeams: hunt.lockTeams, stopAtEnd: hunt.stopAtEnd }, players, log: hunt.log.slice(-60).reverse(), art });
    }
    if (pathname === '/api/hunt' && method === 'POST') {
      const b = await readBody(req), now = Date.now(); let out = 'ok';
      const s = b.set || {};
      for (const k of ['title', 'subtitle', 'ignore']) if (typeof s[k] === 'string') hunt[k] = cleanString(s[k]).slice(0, k === 'ignore' ? 600 : 120);
      for (const k of ['visible', 'joinOpen', 'scoring', 'lockTeams', 'stopAtEnd']) if (typeof s[k] === 'boolean') hunt[k] = s[k];
      if (s.look && typeof s.look === 'object') {
        const L = hunt.look, l = s.look;
        for (const k of ['showLegend', 'showTicker', 'showTimer', 'showBar']) if (typeof l[k] === 'boolean') L[k] = l[k];
        const nums = { scale: [20, 400], x: [0, 100], y: [0, 100], width: [20, 100], showPlayers: [0, 30] };
        for (const [k, [lo, hi]] of Object.entries(nums)) if (l[k] !== undefined && Number.isFinite(Number(l[k]))) L[k] = Math.max(lo, Math.min(hi, Number(l[k])));
        if (['spooky', 'pink', 'palia', 'clean'].includes(l.theme)) L.theme = l.theme;
      }
      if (Array.isArray(b.teams) && b.teams.length) {
        const list = b.teams.slice(0, 26).map(huntCleanTeam), seen = {};
        for (const t of list) { let k = t.key, n = 2; while (seen[k]) k = t.key + n++; t.key = k; seen[k] = 1; }
        hunt.teams = list;
      }
      if (Array.isArray(b.items)) { const seen = {}; hunt.items = b.items.slice(0, 20).map(huntCleanItem).filter(it => !seen[it.command] && (seen[it.command] = 1)); }
      // timer
      const T = hunt.timer;
      if (b.timer) {
        const a = b.timer.action;
        if (b.timer.minutes !== undefined) T.minutes = Math.max(1, Math.min(1440, Number(b.timer.minutes) || 60));
        if (a === 'start') { T.endsAt = now + T.minutes * 60000; T.status = 'running'; hunt.scoring = true; huntLog({ kind: 'start' }); }
        else if (a === 'pause' && T.status === 'running') { T.leftMs = Math.max(0, T.endsAt - now); T.status = 'paused'; }
        else if (a === 'resume' && T.status === 'paused') { T.endsAt = now + T.leftMs; T.status = 'running'; }
        else if (a === 'add') { const d = (Number(b.timer.ms) || 0); if (T.status === 'running') T.endsAt = Math.max(now + 1000, T.endsAt + d); else if (T.status === 'paused') T.leftMs = Math.max(1000, T.leftMs + d); }
        else if (a === 'end') { T.status = 'ended'; T.endsAt = now; if (hunt.stopAtEnd) hunt.scoring = false; huntLog({ kind: 'end' }); }
        else if (a === 'reset') { T.status = 'idle'; T.endsAt = 0; T.leftMs = 0; }
      }
      // players
      if (b.player && b.player.key) {
        const p = hunt.players[String(b.player.key)];
        if (p) {
          if (b.player.remove) delete hunt.players[String(b.player.key)];
          if (b.player.team && hunt.teams.some(t => t.key === b.player.team)) { p.team = b.player.team; huntLog({ kind: 'move', name: p.name, team: p.team }); }
          if (b.player.item) out = huntAdd(String(b.player.key), String(b.player.item), Math.round(Number(b.player.n)) || 0, 'dashboard');
        }
      }
      if (b.add && b.add.name) {
        const nm = cleanString(b.add.name).replace(/^@/, '').slice(0, 40), t = huntFindTeam(b.add.team) || hunt.teams[0];
        if (nm && t) { const k = nm.toLowerCase(); hunt.players[k] = { name: nm, team: t.key, finds: (hunt.players[k] && hunt.players[k].finds) || {}, joined: Date.now() }; huntLog({ kind: 'join', name: nm, team: t.key, how: 'dashboard' }); }
      }
      if (b.undo) {
        const e = hunt.log.find(x => x.id === Number(b.undo) && x.kind === 'find' && !x.undone);
        if (e && hunt.players[e.key]) { const p = hunt.players[e.key]; p.finds[e.item] = Math.max(0, (Number(p.finds[e.item]) || 0) - e.n); e.undone = true; }
      }
      if (b.reset === 'points') { for (const p of Object.values(hunt.players)) p.finds = {}; hunt.log = []; hunt.epoch++; }
      if (b.reset === 'all') { hunt.players = {}; hunt.log = []; hunt.epoch++; T.status = 'idle'; T.endsAt = 0; T.leftMs = 0; }
      if (b.test) out = huntChat(cleanString(b.test.name) || 'TestViewer', [{ t: 'text', v: String(b.test.text || '') }]) || 'ignored (not a hunt command)';
      huntSave(); return sendJson(res, 200, { ok: true, result: out });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown hunt route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Hunt request failed.' });
  }
}

// ---------------------------------------------------------------------------
// PALIA CLOCK (Baby, 2026-10-19). In-game Palia clock + alarms for stream, like
// https://ghervis.github.io/palia-time-notifier/ . Palia time comes straight from the real clock:
// one Palia day = one real hour, one Palia hour = 2.5 real minutes, and it is 6:00 AM in Palia at
// :15 past every real hour (UTC). Same formula as that site (STEADY_DAILY_MINUTE 15, start hour 6).
//   - Overlay /palia-clock.html, dashboard /palia-clock-control.html, data/paliaclock.json.
//   - Alarms fire every Palia day (= every real hour) unless "once"; the overlay shows the banner.
// ---------------------------------------------------------------------------
const PC_FILE = path.join(DATA_DIR, 'paliaclock.json');
function paliaHours(ms) {   // 0..24 decimal Palia hour for a real time
  const d = new Date(ms); const m = d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  return (((6 + (m - 15) / 2.5) % 24) + 24) % 24;
}
function pcDefaults() {
  return { visible: true, title: 'Palia Time', bannerSec: 8, sound: true, volume: 60,
    alarms: [
      { id: 'a1', time: '06:00', label: 'A new day in Palia!', icon: '🌅', on: true, once: false },
      { id: 'a2', time: '18:00', label: 'Evening in Palia', icon: '🌇', on: false, once: false },
      { id: 'a3', time: '00:00', label: 'Midnight', icon: '🌙', on: false, once: false },
    ],
    look: { theme: 'night', scale: 100, x: 88, y: 8, show24h: false, showReal: true, showNext: true, showDayBar: true }, seq: 1 };
}
function pcLoad() { const raw = readJson(PC_FILE, null) || {}, d = pcDefaults(); return { ...d, ...raw, look: { ...d.look, ...(raw.look || {}) }, alarms: Array.isArray(raw.alarms) ? raw.alarms : d.alarms }; }
let pc = pcLoad(), pcEvents = [];
function pcSave() { writeJson(PC_FILE, pc); broadcast('paliaclock', { ok: true }); }
function pcCleanAlarm(a, i) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(a.time || '')); const h = m ? Math.min(23, Number(m[1])) : 6, mi = m ? Math.min(59, Number(m[2])) : 0;
  return { id: cleanString(a.id).slice(0, 20) || `a${Date.now().toString(36)}${i}`, time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    label: cleanString(a.label).slice(0, 80), icon: cleanString(a.icon).slice(0, 8), on: a.on !== false, once: !!a.once, until: Number(a.until) || 0 };
}
setInterval(() => {   // one-time alarms go away once they have rung
  const now = Date.now(), before = pc.alarms.length;
  pc.alarms = pc.alarms.filter(a => !(a.once && a.until && a.until + 15000 < now));
  if (pc.alarms.length !== before) pcSave();
}, 5000);
function pcUntil(time, from) {   // real ms epoch of the next time the Palia clock shows HH:MM
  const [h, m] = time.split(':').map(Number), now = paliaHours(from);
  let dh = ((h + m / 60) - now + 24) % 24; if (dh < 1 / 240) dh += 24;
  return from + dh * 2.5 * 60000;
}
async function handlePaliaClockApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/paliaclock' && method === 'GET') {
      const since = Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0;
      return sendJson(res, 200, { ok: true, ...pc, events: pcEvents.filter(e => e.id > since), last: pc.seq - 1, now: Date.now() });
    }
    if (pathname === '/api/paliaclock' && method === 'POST') {
      const b = await readBody(req), s = b.set || {};
      if (typeof s.title === 'string') pc.title = cleanString(s.title).slice(0, 40);
      for (const k of ['visible', 'sound']) if (typeof s[k] === 'boolean') pc[k] = s[k];
      if (s.bannerSec !== undefined) pc.bannerSec = Math.max(2, Math.min(60, Number(s.bannerSec) || 8));
      if (s.volume !== undefined) pc.volume = Math.max(0, Math.min(100, Number(s.volume) || 0));
      if (s.look) {
        const L = pc.look, l = s.look;
        for (const k of ['show24h', 'showReal', 'showNext', 'showDayBar']) if (typeof l[k] === 'boolean') L[k] = l[k];
        for (const [k, lo, hi] of [['scale', 20, 400], ['x', 0, 100], ['y', 0, 100]]) if (l[k] !== undefined && Number.isFinite(Number(l[k]))) L[k] = Math.max(lo, Math.min(hi, Number(l[k])));
        if (['night', 'palia', 'pink', 'glass'].includes(l.theme)) L.theme = l.theme;
      }
      if (Array.isArray(b.alarms)) pc.alarms = b.alarms.slice(0, 40).map(pcCleanAlarm);
      if (b.addAlarm) { const a = pcCleanAlarm({ ...b.addAlarm, id: '' }, pc.alarms.length); if (a.once) a.until = pcUntil(a.time, Date.now()); pc.alarms.push(a); }
      if (b.inHours) {   // quick timer: N Palia hours from now
        const n = Math.max(0.25, Math.min(24, Number(b.inHours.hours) || 1)), at = Date.now() + n * 2.5 * 60000, ph = paliaHours(at);
        const t = `${String(Math.floor(ph)).padStart(2, '0')}:${String(Math.floor((ph % 1) * 60)).padStart(2, '0')}`;
        pc.alarms.push(pcCleanAlarm({ time: t, label: cleanString(b.inHours.label) || `${n} Palia hour${n === 1 ? '' : 's'} are up!`, icon: '⏰', once: true, until: at, id: '' }, pc.alarms.length));
      }
      if (b.removeAlarm) pc.alarms = pc.alarms.filter(a => a.id !== String(b.removeAlarm));
      if (b.test) { pcEvents.push({ id: pc.seq++, kind: 'ring', label: cleanString(b.test.label) || 'Test alarm!', icon: cleanString(b.test.icon) || '🔔', time: '' }); if (pcEvents.length > 30) pcEvents = pcEvents.slice(-30); }
      pcSave(); return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown palia clock route.' });
  } catch (error) { return sendJson(res, 400, { ok: false, error: error.message || 'Palia clock request failed.' }); }
}

// ---------------------------------------------------------------------------
// CHAT AVATARS (Baby, 2026-10-18). ICB version of her Meld element "ghost-stream-avatars":
// every chatter becomes a little sprite that wanders along the bottom of the stream with their
// name; their chat pops up in a speech bubble; subs / follows / raids get a cheer + bounce.
//   - Overlay /chat-avatars.html (Meld layer, full screen).  Dashboard /chat-avatars-control.html
//   - Pictures: assets/avatars/*.png (her 27 Fortnite sprites to start; she can add/turn off).
//   - Chatters always get the same avatar (hash), unless she assigns one or they type
//     "!avatar <name>" (e.g. "!avatar sonic") when that's allowed.
//   - Chat arrives through /api/activity/raw (text + emotes) and /api/giveaway/event (sub/follow/raid).
//   - Saved in data/avatars.json. Overlay polls GET /api/avatars?since=<id>.
// ---------------------------------------------------------------------------
const AV_FILE = path.join(DATA_DIR, 'avatars.json');
const AV_DIR = path.join(APP_DIR, 'assets', 'avatars');
try { fs.mkdirSync(AV_DIR, { recursive: true }); } catch (_error) {}
function avDefaults() {
  return { visible: true, maxAvatars: 25, size: 100, speed: 100, bubbles: 'all', bubbleSec: 7, showNames: true, textSize: 100, bottom: 2,
    leftEdge: 5, rightEdge: 95, idleMin: 0, ignore: 'Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Sery_Bot, MixItUpBot',
    sayCmds: 'say, avatar, ghost', pickCmd: true, colors: '#38bdf8, #c084fc, #34d399, #fbbf24, #f43f5e, #22d3ee', onlyCmdShow: false,
    subOn: true, subMsg: 'Subscribed! 🎉', followOn: true, followMsg: 'Followed! ⭐', raidOn: true, raidMsg: 'Raided with {n}! 🚀', bitsOn: true, bitsMsg: 'Cheered {n} bits! 💎',
    bounceAllOnSub: true, disabled: [], assign: {}, epoch: 1 };
}
function avLoad() { const raw = readJson(AV_FILE, null) || {}; const d = { ...avDefaults(), ...raw }; d.assign = d.assign && typeof d.assign === 'object' ? d.assign : {}; d.disabled = Array.isArray(d.disabled) ? d.disabled : []; return d; }
let av = avLoad();
let avEvents = [], avSeq = 1;
const avSeen = new Map();   // lower name -> { name, at, avatar }
function avFiles() { try { return fs.readdirSync(AV_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort(); } catch (_e) { return []; } }
const avIdOf = f => f.replace(/\.[a-z0-9]+$/i, '');
const avNice = id => id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
function avPool() { return avFiles().filter(f => !av.disabled.includes(avIdOf(f))); }
function avUrl(f) { let v = 0; try { v = Math.round(fs.statSync(path.join(AV_DIR, f)).mtimeMs); } catch (_e) {} return `/assets/avatars/${encodeURIComponent(f)}?v=${v}`; }
function avFor(name) {
  const key = String(name).toLowerCase(), files = avFiles(), pool = avPool();
  const a = av.assign[key]; if (a) { const f = files.find(x => avIdOf(x) === a); if (f) return f; }
  const list = pool.length ? pool : files; if (!list.length) return null;
  let h = 0; for (let i = 0; i < key.length; i++) { h = (h << 5) - h + key.charCodeAt(i); h |= 0; }
  return list[Math.abs(h) % list.length];
}
const avIgnored = name => String(av.ignore || '').split(/[\s,]+/).map(s => s.toLowerCase().replace(/^@/, '')).filter(Boolean).includes(String(name).toLowerCase());
function avPush(kind, name, extra) {
  const f = name ? avFor(name) : null;
  const ev = { id: avSeq++, kind, name: name || '', avatar: f ? avUrl(f) : null, at: Date.now(), ...(extra || {}) };
  avEvents.push(ev); if (avEvents.length > 300) avEvents = avEvents.slice(-300);
  if (name) avSeen.set(name.toLowerCase(), { name, at: Date.now(), avatar: f ? avIdOf(f) : null });
  if (avSeen.size > 400) avSeen.delete(avSeen.keys().next().value);
  return ev;
}
// Chat text -> parts the overlay can draw: [{t:'text', v}, {t:'emote', url}]
function avChat(sender, parts) {
  const name = cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!name || avIgnored(name)) return '';
  const text = partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim();
  // "!avatar sonic" picks your own avatar (when allowed); "!avatar" alone just waves.
  const pm = /^!avatar\s+(.+)$/i.exec(text);
  if (pm && av.pickCmd) {
    const want = pm[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const f = avPool().find(x => avIdOf(x) === want) || avPool().find(x => avIdOf(x).startsWith(want));
    if (f) { av.assign[name.toLowerCase()] = avIdOf(f); writeJson(AV_FILE, av); avPush('pick', name, { text: `I'm ${avNice(avIdOf(f))} now!` }); return 'picked'; }
  }
  const cmds = String(av.sayCmds || '').split(/[\s,]+/).map(s => s.toLowerCase().replace(/^!/, '')).filter(Boolean);
  const cm = /^!([a-z0-9_]+)\s*(.*)$/i.exec(text);
  const isSay = cm && cmds.includes(cm[1].toLowerCase());
  let show = (parts || []).map(p => p.t === 'emote' ? { t: 'emote', url: p.url } : { t: 'text', v: partyDecode(p.v) });
  if (isSay) { const rest = cm[2]; show = rest ? [{ t: 'text', v: rest }] : []; }
  else if (/^!/.test(text)) show = [];            // other commands: just appear, no bubble
  if (av.onlyCmdShow && !isSay && !avSeen.has(name.toLowerCase())) return '';
  const bubble = av.bubbles === 'all' ? show : av.bubbles === 'commands' ? (isSay ? show : []) : [];
  avPush('chat', name, { parts: bubble.slice(0, 40) });
  return 'ok';
}
function avEvent(type, username, body) {
  const name = cleanString(username).replace(/^@/, '').slice(0, 40);
  if (!name || avIgnored(name)) return;
  const n = type === 'raid' ? Math.max(0, Math.trunc(Number(body.viewers)) || 0) : type === 'bits' ? Math.max(0, Math.trunc(Number(body.amount)) || 0) : 0;
  const msg = (t) => String(t || '').replace(/\{n\}/g, n);
  if ((type === 'sub' || type === 'gifts') && av.subOn) avPush('cheer', name, { text: type === 'gifts' ? `Gifted ${body.count || ''} subs! 🎁` : msg(av.subMsg), all: !!av.bounceAllOnSub });
  else if (type === 'follow' && av.followOn) avPush('cheer', name, { text: msg(av.followMsg) });
  else if (type === 'raid' && av.raidOn) avPush('cheer', name, { text: msg(av.raidMsg), all: true });
  else if (type === 'bits' && av.bitsOn) avPush('cheer', name, { text: msg(av.bitsMsg) });
}
function avPublic() {
  const pick = ['visible', 'maxAvatars', 'size', 'speed', 'bubbles', 'bubbleSec', 'showNames', 'textSize', 'bottom', 'leftEdge', 'rightEdge', 'idleMin'];
  const o = { ok: true, epoch: av.epoch, colors: String(av.colors || '').split(/[\s,]+/).filter(c => /^#[0-9a-f]{6}$/i.test(c)) };
  for (const k of pick) o[k] = av[k];
  return o;
}
async function handleAvatarsApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/avatars' && method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, since = Number(q.get('since')) || 0;
      // First load (?first=1) gets only the newest id, so old chat doesn't replay.
      return sendJson(res, 200, { ...avPublic(), last: avSeq - 1, events: q.get('first') ? [] : avEvents.filter(e => e.id > since), now: Date.now() });
    }
    if (pathname === '/api/avatars/admin' && method === 'GET') {
      const files = avFiles();
      return sendJson(res, 200, { ...avPublic(), settings: av, avatars: files.map(f => ({ id: avIdOf(f), name: avNice(avIdOf(f)), url: avUrl(f), on: !av.disabled.includes(avIdOf(f)) })),
        chatters: Array.from(avSeen.values()).sort((a, b) => b.at - a.at).slice(0, 60).map(c => ({ ...c, avatar: (avFor(c.name) && avIdOf(avFor(c.name))) || null, assigned: av.assign[c.name.toLowerCase()] || null })),
        assigned: Object.entries(av.assign).map(([k, v]) => ({ name: k, avatar: v })) });
    }
    if (pathname === '/api/avatars' && method === 'POST') {
      const b = await readBody(req);
      for (const k of ['visible', 'showNames', 'pickCmd', 'onlyCmdShow', 'subOn', 'followOn', 'raidOn', 'bitsOn', 'bounceAllOnSub']) if (typeof b[k] === 'boolean') av[k] = b[k];
      const nums = { maxAvatars: [1, 60], size: [30, 300], speed: [0, 400], bubbleSec: [2, 30], textSize: [50, 250], bottom: [0, 40], leftEdge: [0, 90], rightEdge: [10, 100], idleMin: [0, 240] };
      for (const [k, [lo, hi]] of Object.entries(nums)) if (b[k] !== undefined && Number.isFinite(Number(b[k]))) av[k] = Math.max(lo, Math.min(hi, Number(b[k])));
      if (['all', 'commands', 'off'].includes(b.bubbles)) av.bubbles = b.bubbles;
      for (const k of ['ignore', 'sayCmds', 'colors', 'subMsg', 'followMsg', 'raidMsg', 'bitsMsg']) if (typeof b[k] === 'string') av[k] = cleanString(b[k]).slice(0, 600);
      if (b.toggleAvatar) { const id = String(b.toggleAvatar); av.disabled = av.disabled.includes(id) ? av.disabled.filter(x => x !== id) : av.disabled.concat([id]); }
      if (b.assign && b.assign.name) { const k = cleanString(b.assign.name).toLowerCase().replace(/^@/, ''); if (b.assign.avatar) av.assign[k] = String(b.assign.avatar); else delete av.assign[k]; }
      if (b.clear) { av.epoch++; avEvents = []; }
      if (b.wave) avPush('wave', '', {});
      if (b.test) avChat(cleanString(b.test.name) || 'TestViewer', [{ t: 'text', v: cleanString(b.test.text) || 'Hi! 👋' }]);
      if (b.testEvent) avEvent(String(b.testEvent), cleanString(b.name) || 'TestViewer', { viewers: 25, amount: 100, count: 5 });
      writeJson(AV_FILE, av); return sendJson(res, 200, { ok: true });
    }
    // Upload / remove an avatar picture
    if (pathname === '/api/avatars/image' && method === 'POST') {
      const b = await readBody(req);
      if (b.remove) { const f = avFiles().find(x => avIdOf(x) === String(b.remove)); if (f) { try { fs.unlinkSync(path.join(AV_DIR, f)); } catch (_e) {} } return sendJson(res, 200, { ok: true }); }
      const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
      if (!m) return sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
      const buf = Buffer.from(m[2], 'base64'); if (buf.length > 9 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
      let id = cleanString(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'avatar', n = 2, base = id;
      while (avFiles().some(x => avIdOf(x) === id)) id = `${base}-${n++}`;
      fs.writeFileSync(path.join(AV_DIR, `${id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`), buf);
      return sendJson(res, 200, { ok: true, id });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown avatars route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Chat avatars request failed.' });
  }
}

async function handleTeamsApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/teams' && method === 'GET') return sendJson(res, 200, teamsPublic());
    if (pathname === '/api/teams/admin' && method === 'GET') {
      const art = (() => { try { return fs.readdirSync(RESOURCE_ART_DIR).filter(f => DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b)); } catch (_e) { return []; } })();
      const players = Object.entries(teams.players).map(([key, p]) => ({ key, name: p.name, team: p.team, points: Number(p.points[teams.item.command]) || 0 })).sort((a, b) => a.name.localeCompare(b.name));
      return sendJson(res, 200, { ...teamsPublic(), teams: teams.teams, presets: teams.presets, players, log: teams.log.slice(-60).reverse(), art });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
    if (pathname === '/api/teams/settings' && method === 'POST') {
      if (typeof body.title === 'string') teams.title = cleanString(body.title).slice(0, 120);
      if (body.teamCount !== undefined) teams.teamCount = Math.max(2, Math.min(8, Math.round(Number(body.teamCount)) || 2));
      for (const k of ['joinOpen', 'counting', 'showBanner', 'visible']) if (typeof body[k] === 'boolean') teams[k] = body[k];
      if (body.showPlayers !== undefined) teams.showPlayers = Math.max(0, Math.min(30, Math.round(Number(body.showPlayers)) || 0));
      if (Array.isArray(body.teams)) {
        for (const r of body.teams) {
          const t = r && teams.teams.find(x => x.letter === r.letter); if (!t) continue;
          if (typeof r.name === 'string') t.name = cleanString(r.name).slice(0, 40) || `Team ${t.letter.toUpperCase()}`;
          if (/^#[0-9a-f]{6}$/i.test(String(r.color || ''))) t.color = r.color;
        }
      }
      if (body.item) teams.item = teamsCleanItem(body.item);
      if (Array.isArray(body.presets)) teams.presets = body.presets.slice(0, 30).map(teamsCleanItem);
      teamsSave(); return sendJson(res, 200, { ok: true });
    }
    // Baby's fixes: { key, amount } adds/removes points for the current item.
    if (pathname === '/api/teams/points' && method === 'POST') {
      const key = cleanString(body.key).toLowerCase();
      if (!teams.players[key]) return sendJson(res, 404, { ok: false, error: 'Player not found.' });
      const amount = Math.round(Number(body.amount) || 0);
      if (body.set !== undefined) { const cur = Number(teams.players[key].points[teams.item.command]) || 0; return sendJson(res, 200, { ok: true, result: teamsAdd(key, Math.max(0, Math.round(Number(body.set) || 0)) - cur, 'dashboard') }); }
      return sendJson(res, 200, { ok: true, result: teamsAdd(key, amount, 'dashboard') });
    }
    // Add someone by hand / move them: { name, team }  (team '' = remove).
    if (pathname === '/api/teams/player' && method === 'POST') {
      const name = cleanString(body.name).replace(/^@/, '').slice(0, 40);
      if (!name) return sendJson(res, 400, { ok: false, error: 'Name needed.' });
      const key = name.toLowerCase();
      const team = String(body.team || '').toLowerCase();
      if (!team) { if (teams.players[key]) { teamsLog({ kind: 'removed', name: teams.players[key].name }); delete teams.players[key]; } teamsSave(); return sendJson(res, 200, { ok: true }); }
      if (TEAM_LETTERS.indexOf(team) < 0 || team.length !== 1) return sendJson(res, 400, { ok: false, error: 'Unknown team.' });
      const p = teams.players[key];
      if (p) { p.team = team; teamsLog({ kind: 'moved', name: p.name, team }); }
      else { teams.players[key] = { name, team, points: {}, joined: Date.now() }; teamsLog({ kind: 'join', name, team, how: 'dashboard' }); }
      teamsSave(); return sendJson(res, 200, { ok: true });
    }
    // Undo one scoring line from the log: { id }
    if (pathname === '/api/teams/undo' && method === 'POST') {
      const e = teams.log.find(x => x.id === Number(body.id) && x.kind === 'points' && !x.undone);
      if (!e) return sendJson(res, 404, { ok: false, error: 'Nothing to undo there.' });
      const p = teams.players[e.key];
      if (p) p.points[e.item] = Math.max(0, (Number(p.points[e.item]) || 0) - e.amount);
      e.undone = true; teamsSave(); return sendJson(res, 200, { ok: true });
    }
    // Reset points: { scope: 'item' (current item only) | 'all' }. Teams stay.
    if (pathname === '/api/teams/reset' && method === 'POST') {
      for (const p of Object.values(teams.players)) { if (body.scope === 'all') p.points = {}; else delete p.points[teams.item.command]; }
      teamsLog({ kind: 'reset', item: body.scope === 'all' ? 'everything' : teams.item.command });
      teamsSave(); return sendJson(res, 200, { ok: true });
    }
    // Clear teams: everyone off their team (and their points), new contest.
    if (pathname === '/api/teams/clear' && method === 'POST') {
      teams.players = {}; teams.log = []; teamsLog({ kind: 'cleared' });
      teamsSave(); return sendJson(res, 200, { ok: true });
    }
    // Test from the dashboard: { name, text }
    if (pathname === '/api/teams/test' && method === 'POST') {
      const result = teamsChat(cleanString(body.name) || 'TestViewer', [{ t: 'text', v: cleanString(body.text) }]);
      return sendJson(res, 200, { ok: true, result: result || 'ignored (not a contest command)' });
    }
    return sendJson(res, 404, { ok: false, error: 'Unknown teams route.' });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || 'Teams request failed.' });
  }
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
      if (body.anims && typeof body.anims === 'object') s.anims = walkerCleanAnims(body.anims, s.anims);
      if (WALKERS_ENTRANCES[body.entrance]) s.entrance = body.entrance;
      if (WALKERS_EXITS[body.exitStyle]) s.exitStyle = body.exitStyle;
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
      else if (typeof body.art === 'string') {
        const ref = walkerCleanArtRef(body.art);
        if (ref && ref.startsWith('personal:')) {
          if (!p.personal || p.personal !== ref.slice(9)) return sendJson(res, 400, { ok: false, error: 'Upload their own picture first.' });
          p.art = ref;
        } else if (ref && ref.startsWith('subs:')) {
          if (!walkerSubArt().includes(ref.slice(5))) return sendJson(res, 400, { ok: false, error: 'No such subscriber picture.' });
          if (!walkerIsSub(name)) return sendJson(res, 400, { ok: false, error: `${name} isn't a subscriber, so they can't have a subscriber-only picture.` });
          p.art = ref;
        } else if (ref && walkerArt().includes(ref)) p.art = ref;
      }
      saveWalkers();
      return sendJson(res, 200, walkerAdminState());
    }

    // Test button: a pretend chatter says something (shows even if not ticked).
    // { id }: every unicorn on screen does that animation right now (preview).
    if (pathname === '/api/walkers/try' && method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id || '');
      if (!WALKERS_ANIMS.some(a => a.id === id) && !WALKERS_ENTRANCES[id.replace(/^enter:/, '')] && !WALKERS_EXITS[id.replace(/^exit:/, '')]) return sendJson(res, 400, { ok: false, error: 'Unknown animation.' });
      walkerTry = { id, at: Date.now() };
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/walkers/test' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanString(body.name) || `TestUnicorn${1 + Math.floor(Math.random() * 9)}`;
      const text = cleanString(body.text).slice(0, 300) || 'Hi everyone! 🦄';
      walkerChat(name, [{ t: 'text', v: text }], true);
      return sendJson(res, 200, { ok: true, name });
    }

    // One person's own picture: { name, dataUrl } - saved just for them and picked for them.
    if (pathname === '/api/walkers/person-art' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanString(body.name).replace(/^@/, '').slice(0, 40);
      if (!name) return sendJson(res, 400, { ok: false, error: 'Missing name.' });
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = tradeupSlug(name);
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(WALKERS_PERSONAL_DIR, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(WALKERS_PERSONAL_DIR, filename), buffer);
      const key = name.toLowerCase();
      const p = walkers.people[key] || (walkers.people[key] = { name, allowed: null, art: null, lastSeen: null });
      // Their old personal picture is kept in the folder, just no longer used.
      p.personal = filename;
      p.art = `personal:${filename}`;
      saveWalkers();
      return sendJson(res, 200, walkerAdminState());
    }

    // Add a picture: { dataUrl, name, pool: 'all' | 'subs' }
    if (pathname === '/api/walkers/art' && method === 'POST') {
      const body = await readBody(req);
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = tradeupSlug(String(body.name || 'unicorn').replace(/\.[a-z0-9]+$/i, ''));
      const dir = body.pool === 'subs' ? WALKERS_SUB_ART_DIR : WALKERS_ART_DIR;
      fs.mkdirSync(dir, { recursive: true });
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      return sendJson(res, 200, walkerAdminState());
    }

    // Move a picture between everyone's pool and subscriber-only: { file, to: 'subs' | 'all' }
    if (pathname === '/api/walkers/art/move' && method === 'POST') {
      const body = await readBody(req);
      const file = path.basename(String(body.file || ''));
      const toSubs = body.to === 'subs';
      const fromDir = toSubs ? WALKERS_ART_DIR : WALKERS_SUB_ART_DIR, toDir = toSubs ? WALKERS_SUB_ART_DIR : WALKERS_ART_DIR;
      if (!DECOR_IMAGE_EXT.test(file) || !fs.existsSync(path.join(fromDir, file))) return sendJson(res, 404, { ok: false, error: 'No such picture.' });
      let target = file, n = 2;
      const stem = file.replace(/\.[^.]+$/, ''), ext = path.extname(file);
      while (fs.existsSync(path.join(toDir, target))) target = `${stem}-${n++}${ext}`;
      fs.mkdirSync(toDir, { recursive: true });
      fs.renameSync(path.join(fromDir, file), path.join(toDir, target));
      // Keep anyone who had this picture picked on it (non-subs lose a sub-only pick and go back to random).
      for (const p of Object.values(walkers.people)) {
        if (toSubs && p.art === file) p.art = walkerIsSub(p.name) ? `subs:${target}` : null;
        if (!toSubs && p.art === `subs:${file}`) p.art = target;
      }
      saveWalkers();
      return sendJson(res, 200, walkerAdminState());
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
