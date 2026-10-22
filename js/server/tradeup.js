'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mConfig = require('./config');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpStatic = require('./http/static');
const mHttpBody = require('./http/body');
const mDomainValidation = require('./domain/validation');

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
const TRADEUP_CONFIG_FILE = path.join(mConfig.APP_DIR, 'config', 'tradeup-game.json');
const TRADEUP_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'tradeup');
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

/** Restore tradeup state from disk and supply defaults for missing fields. */
function loadTradeupConfig() {
  const raw = mStorage.readJson(TRADEUP_CONFIG_FILE, DEFAULT_TRADEUP_CONFIG);
  const cfg = mStorage.mergeDefaults(DEFAULT_TRADEUP_CONFIG, raw);
  if (!Array.isArray(cfg.items)) cfg.items = [];
  // Tolerate the old three-pool config shape (items each carried a `pools`
  // array, and there were top-level `pools`/`whammy` fields) - now that
  // there is only one pool, every item in the catalog is simply eligible,
  // so any leftover `pools` field on an item is ignored rather than needing
  // a migration step.
  return cfg;
}

/** Persist operator changes to the tradeup state file. */
function saveTradeupConfig(cfg) {
  mStorage.writeJson(TRADEUP_CONFIG_FILE, cfg);
}

/** Apply Fisher-Yates so every remaining board item can occupy each position. */
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

/** Retain a bounded recent action log for the trade-up dashboard. */
function tradeupPushLog(message) {
  tradeup.log.unshift({ at: new Date().toISOString(), message });
  tradeup.log = tradeup.log.slice(0, 30);
}

/** Publish the current board after a game action. */
function tradeupBroadcast() {
  mEvents.broadcast('tradeup', tradeupPublicState());
}

/** Build the tradeup response consumed by dashboards and overlays. */
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

/** Restore the board configuration and prepare the initial randomized board. */
function tradeupInit() {
  tradeup.board = tradeupDealBoard();
  tradeup.revealed = null;
  tradeupPushLog('Board dealt.');
}

/** Redeal available images and reset the current reveal. */
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

/** Select the next reveal from the configured game board. */
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

/** Clear the visible selection while preserving the configured image pool. */
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

/** Convert an uploaded display name into a safe local image stem. */
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

/** Resolve local tradeup artwork to the URL used by its display. */
function serveTradeupArt(res, pathname) {
  let name;
  try {
    name = path.basename(decodeURIComponent(pathname.slice('/tradeup-art/'.length)));
  } catch (_error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Invalid art name.' });
  }
  const file = path.join(TRADEUP_ART_DIR, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
  res.writeHead(200, { 'Content-Type': mHttpStatic.MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}

/** Validate and dispatch tradeup API requests, returning client errors for invalid input. */
async function handleTradeupApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/tradeup/state' && method === 'GET') {
      return mHttpResponse.sendJson(res, 200, tradeupPublicState());
    }

    if (pathname === '/api/tradeup/config' && method === 'GET') {
      return mHttpResponse.sendJson(res, 200, { ok: true, config: loadTradeupConfig() });
    }

    if (pathname === '/api/tradeup/items' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const name = mDomainValidation.cleanString(body.name);
      if (!name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'name is required.' });
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
      return mHttpResponse.sendJson(res, 200, { ok: true, item, config: cfg });
    }

    const deleteMatch = pathname.match(/^\/api\/tradeup\/items\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const cfg = loadTradeupConfig();
      const before = cfg.items.length;
      cfg.items = cfg.items.filter(item => item.id !== deleteMatch[1]);
      if (cfg.items.length === before) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Item not found.' });
      saveTradeupConfig(cfg);
      return mHttpResponse.sendJson(res, 200, { ok: true, config: cfg });
    }

    // Add or replace an existing item's image (or edit its name/points)
    // without deleting and re-adding it — lets Baby swap in rendered art for
    // a plushie already in the pool one at a time as she finishes each one.
    const updateMatch = pathname.match(/^\/api\/tradeup\/items\/([^/]+)$/);
    if (updateMatch && (method === 'PUT' || method === 'PATCH')) {
      const cfg = loadTradeupConfig();
      const item = cfg.items.find(it => it.id === updateMatch[1]);
      if (!item) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Item not found.' });
      const body = await mHttpBody.readBody(req);
      if (body.name !== undefined) {
        const name = mDomainValidation.cleanString(body.name);
        if (!name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'name cannot be empty.' });
        item.name = name;
      }
      if (body.type !== undefined) item.type = body.type === 'points' ? 'points' : 'plushie';
      if (body.points !== undefined) {
        const points = Math.trunc(Number(body.points));
        item.points = Number.isFinite(points) && points > 0 ? points : 0;
      }
      if (body.imageDataUrl) item.image = tradeupSaveImage(body.imageDataUrl, item.name);
      saveTradeupConfig(cfg);
      return mHttpResponse.sendJson(res, 200, { ok: true, item, config: cfg });
    }

    if (pathname === '/api/tradeup/shuffle' && method === 'POST') {
      tradeupShuffle();
    } else if (pathname === '/api/tradeup/spin' && method === 'POST') {
      tradeupSpin();
    } else if (pathname === '/api/tradeup/clear' && method === 'POST') {
      tradeupClearReveal();
    } else {
      return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
    }

    tradeupBroadcast();
    return mHttpResponse.sendJson(res, 200, tradeupPublicState());
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Request failed.' });
  }
}

tradeupInit();

Object.assign(exports, { tradeupSlug, tradeupPublicState, serveTradeupArt, handleTradeupApi });
