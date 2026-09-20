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
  layout: { panelOrder: [] },
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
    const incomingOrder = Array.isArray(body.panelOrder) ? body.panelOrder : null;
    if (!incomingOrder) return sendJson(res, 400, { ok: false, error: 'panelOrder must be an array of panel keys.' });
    const panelOrder = incomingOrder
      .filter(key => typeof key === 'string' && key)
      .map(key => key.slice(0, 60))
      .slice(0, 50);
    settings = mergeDefaults(settings, { layout: { panelOrder } });
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

  return sendJson(res, 404, { ok: false, error: 'Not found.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
  const requested = pathname === '/' ? '/control.html' : pathname;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const role = url.searchParams.get('role');
    res.icbRole = ['control', 'overlay'].includes(role) ? role : 'other';
    clients.add(res);
    sendSse(res, 'snapshot', publicState());
    sendSse(res, 'tradeup', tradeupPublicState());
    req.on('close', () => clients.delete(res));
    return;
  }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/resource-art/')) return serveResourceArt(res, url.pathname);
    if (url.pathname.startsWith('/tradeup-art/')) return serveTradeupArt(res, url.pathname);
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
