'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mTradeup = require('./tradeup');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpStatic = require('./http/static');
const mHttpBody = require('./http/body');

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
const DECOR_FILE = path.join(mConfig.DATA_DIR, 'decor.json');
const DECOR_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor');
const DECOR_OVERLAY_PAGE = path.join(mConfig.APP_DIR, 'html', 'decor-overlay.html');

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

/** Create independent initial decor settings for first-run or missing saved fields. */
function decorDefaults() {
  return { rev: 1, effects: [decorNewEffect('leaves', 'Falling leaves')], presets: [] };
}

/** Create an independent decor record with its initial settings. */
function decorNewEffect(id, name, type) {
  // extra = pictures borrowed from the picture library (other folders), as "folder/file".
  const e = { id, name, type: DECOR_TYPES.includes(type) ? type : 'fall', enabled: false, off: [], extra: [] };
  for (const [k, lim] of Object.entries(DECOR_LIMITS)) e[k] = lim[2];
  return e;
}

/** Normalize incoming decor values to the supported fields and limits. */
function decorClamp(key, value, fallback) {
  const lim = DECOR_LIMITS[key];
  const n = Number(value);
  if (!lim || !Number.isFinite(n)) return fallback;
  return Math.min(lim[1], Math.max(lim[0], n));
}

/** Normalize incoming decor values to the supported fields and limits. */
function decorCleanEffect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = mTradeup.tradeupSlug(raw.id || raw.name || '');
  if (!id || id === 'item' || DECOR_RESERVED_IDS.includes(id)) return null;
  const e = decorNewEffect(id, mDomainValidation.cleanString(raw.name) || id);
  e.type = DECOR_TYPES.includes(raw.type) ? raw.type : 'fall';
  e.enabled = raw.enabled === true;
  e.off = Array.isArray(raw.off) ? raw.off.map(f => path.basename(String(f))).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).slice(0, 500) : [];
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
    const folder = mTradeup.tradeupSlug(parts[0]), file = path.basename(parts[1]);
    if (!folder || folder !== parts[0] || folder === 'item' || file !== parts[1] || !mDomainValidation.DECOR_IMAGE_EXT.test(file)) continue;
    const key = `${folder}/${file}`;
    if (!out.includes(key)) out.push(key);
  }
  return out.slice(0, 300);
}

// Every picture in every folder under assets/decor (the "picture library").
function decorLibrary() {
  let folders = [];
  try { folders = fs.readdirSync(DECOR_ART_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_') && mTradeup.tradeupSlug(d.name) === d.name).map(d => d.name).sort(); } catch (_error) { folders = []; }
  const out = [];
  for (const folder of folders) for (const file of decorFiles(folder)) out.push({ key: `${folder}/${file}`, folder, file, url: `/decor-art/${folder}/${encodeURIComponent(file)}` });
  return out;
}

/** Restore decor state from disk and supply defaults for missing fields. */
function loadDecor() {
  const raw = mStorage.readJson(DECOR_FILE, null);
  if (!raw || !Array.isArray(raw.effects)) return decorDefaults();
  const effects = raw.effects.map(decorCleanEffect).filter(Boolean);
  const presets = Array.isArray(raw.presets) ? raw.presets.filter(p => p && p.id && p.name && p.effects) : [];
  return { rev: Number(raw.rev) || 1, effects: effects.length ? effects : decorDefaults().effects, presets };
}

let decor = loadDecor();
for (const e of decor.effects) { try { fs.mkdirSync(path.join(DECOR_ART_DIR, e.id), { recursive: true }); } catch (_error) {} }

/** Locate supported local decor artwork while tolerating missing files. */
function decorFiles(id) {
  try {
    return fs.readdirSync(path.join(DECOR_ART_DIR, id)).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b));
  } catch (_error) {
    return [];
  }
}

/** Build the decor response consumed by dashboards and overlays. */
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

/** Persist operator changes to the decor state file. */
function saveDecor() {
  decor.rev += 1;
  mStorage.writeJson(DECOR_FILE, { rev: decor.rev, effects: decor.effects, presets: decor.presets });
  mEvents.broadcast('decor', decorPublicState());
}

/** Find the requested decor record without changing its saved state. */
function decorFind(id) {
  return decor.effects.find(e => e.id === id) || null;
}

/** Resolve local decor artwork to the URL used by its display. */
function serveDecorArt(res, pathname) {
  let parts;
  try { parts = decodeURIComponent(pathname.slice('/decor-art/'.length)).split('/'); } catch (_error) { return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Invalid art path.' }); }
  if (parts.length !== 2) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
  const id = mTradeup.tradeupSlug(parts[0]), name = path.basename(parts[1]);
  if (!mDomainValidation.DECOR_IMAGE_EXT.test(name)) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
  const file = path.join(DECOR_ART_DIR, id, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
  res.writeHead(200, { 'Content-Type': mHttpStatic.MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}

/** Serve the local decor asset requested by its public URL. */
function serveDecorOverlay(res) {
  if (!fs.existsSync(DECOR_OVERLAY_PAGE)) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'decor-overlay.html is missing.' });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
  return res.end(fs.readFileSync(DECOR_OVERLAY_PAGE));
}

/** Validate and dispatch decor API requests, returning client errors for invalid input. */
async function handleDecorApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/decor/state' && method === 'GET') return mHttpResponse.sendJson(res, 200, decorPublicState());

    // New effect: { name } -> gets its own art folder and Meld URL.
    if (pathname === '/api/decor/effects' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const name = mDomainValidation.cleanString(body.name).slice(0, 40);
      if (!name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Give the effect a name.' });
      let id = mTradeup.tradeupSlug(name), n = 2;
      if (id === 'item') id = 'effect';
      const base = id;
      while (decorFind(id) || DECOR_RESERVED_IDS.includes(id)) id = `${base}-${n++}`;
      const e = decorNewEffect(id, name, body.type);
      decor.effects.push(e);
      fs.mkdirSync(path.join(DECOR_ART_DIR, id), { recursive: true });
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true, effect: e });
    }

    if (pathname === '/api/decor/all-off' && method === 'POST') {
      for (const e of decor.effects) e.enabled = false;
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }

    // "Switch to this one": turn this effect on and every other effect off.
    let m = /^\/api\/decor\/effects\/([a-z0-9-]+)\/solo$/.exec(pathname);
    if (m && method === 'POST') {
      const e = decorFind(m[1]);
      if (!e) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such effect.' });
      for (const other of decor.effects) other.enabled = other.id === e.id;
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }

    m = /^\/api\/decor\/effects\/([a-z0-9-]+)$/.exec(pathname);
    if (m && (method === 'PATCH' || method === 'POST')) {
      const e = decorFind(m[1]);
      if (!e) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const body = await mHttpBody.readBody(req);
      if (typeof body.name === 'string' && mDomainValidation.cleanString(body.name)) e.name = mDomainValidation.cleanString(body.name).slice(0, 40);
      if (typeof body.enabled === 'boolean') e.enabled = body.enabled;
      if (DECOR_TYPES.includes(body.type)) e.type = body.type;
      for (const k of Object.keys(DECOR_LIMITS)) if (body[k] !== undefined) e[k] = decorClamp(k, body[k], e[k]);
      if (Array.isArray(body.off)) e.off = body.off.map(f => path.basename(String(f))).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).slice(0, 500);
      if (Array.isArray(body.extra)) e.extra = decorCleanExtra(body.extra);
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true, effect: e });
    }
    if (m && method === 'DELETE') {
      const i = decor.effects.findIndex(e => e.id === m[1]);
      if (i < 0) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such effect.' });
      decor.effects.splice(i, 1); // its art folder is left alone on disk
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }

    // Upload into the picture library (assets/decor/misc): { dataUrl, name }
    if (pathname === '/api/decor/library' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = mTradeup.tradeupSlug(String(body.name || 'art').replace(/\.[a-z0-9]+$/i, ''));
      const dir = path.join(DECOR_ART_DIR, 'misc');
      fs.mkdirSync(dir, { recursive: true });
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true, key: `misc/${filename}` });
    }

    // Upload art: { dataUrl, name }
    m = /^\/api\/decor\/effects\/([a-z0-9-]+)\/images$/.exec(pathname);
    if (m && method === 'POST') {
      const e = decorFind(m[1]);
      if (!e) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const body = await mHttpBody.readBody(req);
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = mTradeup.tradeupSlug(String(body.name || 'art').replace(/\.[a-z0-9]+$/i, ''));
      const dir = path.join(DECOR_ART_DIR, e.id);
      fs.mkdirSync(dir, { recursive: true });
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true, file: filename });
    }

    // Remove art: moved into _removed/, never deleted.
    m = /^\/api\/decor\/effects\/([a-z0-9-]+)\/images\/(.+)$/.exec(pathname);
    if (m && method === 'DELETE') {
      const e = decorFind(m[1]);
      if (!e) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such effect.' });
      const name = path.basename(decodeURIComponent(m[2]));
      const from = path.join(DECOR_ART_DIR, e.id, name);
      if (!mDomainValidation.DECOR_IMAGE_EXT.test(name) || !fs.existsSync(from)) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such image.' });
      const bin = path.join(DECOR_ART_DIR, e.id, '_removed');
      fs.mkdirSync(bin, { recursive: true });
      fs.renameSync(from, path.join(bin, `${Date.now()}-${name}`));
      e.off = e.off.filter(f => f !== name);
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }

    // Presets: save the current settings of every effect under a name.
    if (pathname === '/api/decor/presets' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const name = mDomainValidation.cleanString(body.name).slice(0, 40);
      if (!name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Give the preset a name.' });
      const snapshot = {};
      for (const e of decor.effects) snapshot[e.id] = { ...e };
      const existing = decor.presets.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) { existing.effects = snapshot; existing.savedAt = new Date().toISOString(); }
      else decor.presets.push({ id: `p${Date.now()}`, name, effects: snapshot, savedAt: new Date().toISOString() });
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    m = /^\/api\/decor\/presets\/([a-z0-9]+)\/apply$/.exec(pathname);
    if (m && method === 'POST') {
      const p = decor.presets.find(x => x.id === m[1]);
      if (!p) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such preset.' });
      for (const e of decor.effects) {
        const saved = p.effects[e.id];
        if (!saved) { e.enabled = false; continue; } // effect made after the preset: off
        const clean = decorCleanEffect({ ...saved, id: e.id, name: e.name });
        Object.assign(e, clean, { name: e.name });
      }
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    m = /^\/api\/decor\/presets\/([a-z0-9]+)$/.exec(pathname);
    if (m && method === 'DELETE') {
      decor.presets = decor.presets.filter(x => x.id !== m[1]);
      saveDecor();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }

    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown decor route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Decor request failed.' });
  }
}


Object.assign(exports, { decorPublicState, serveDecorArt, serveDecorOverlay, handleDecorApi });
