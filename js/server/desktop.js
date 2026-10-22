'use strict';

const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');
const mDomainValidation = require('./domain/validation');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');

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
const DESK_FILE = path.join(mConfig.DATA_DIR, 'desktop-widgets.json');
/** Restore desktop state from disk and supply defaults for missing fields. */
function deskLoad() {
  const raw = mStorage.readJson(DESK_FILE, null) || {};
  return { move: false, hideAll: false, seq: 1, widgets: [], ...raw, widgets: Array.isArray(raw.widgets) ? raw.widgets : [] };
}
let desk = deskLoad();
let deskApp = { seen: 0, displays: [], version: '', cams: [] };   // cams: camera names the webcam widget can see
const deskNum = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
/** Normalize incoming desktop values to the supported fields and limits. */
function deskCleanUrl(u) {
  u = mDomainValidation.cleanString(u).slice(0, 600);
  if (/^\/[^\s]*$/.test(u)) u = 'http://127.0.0.1:8790' + u;          // "/party.html" -> full ICB link
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : '';
}
/** Apply validated geometry, appearance, and URL settings to one desktop widget. */
function deskApply(w, b) {
  if (typeof b.name === 'string' && mDomainValidation.cleanString(b.name)) w.name = mDomainValidation.cleanString(b.name).slice(0, 40);
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
/** Build the desktop response consumed by dashboards and overlays. */
function deskPublic() {
  return { ok: true, move: desk.move, hideAll: desk.hideAll, widgets: desk.widgets,
    app: { online: Date.now() - deskApp.seen < 6000, seen: deskApp.seen, displays: deskApp.displays, version: deskApp.version, cams: deskApp.cams, camStatus: deskApp.camStatus || '', camAt: deskApp.camAt || 0 }, now: Date.now() };
}
/** Persist operator changes to the desktop state file. */
function deskSave() { mStorage.writeJson(DESK_FILE, desk); mEvents.broadcast('desktop', deskPublic()); }
/** Validate and dispatch desktop API requests, returning client errors for invalid input. */
async function handleDeskApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/desktop' && method === 'GET') {
      if (/[?&]app=1/.test(req.url)) deskApp.seen = Date.now();
      return mHttpResponse.sendJson(res, 200, deskPublic());
    }
    if (pathname === '/api/desktop' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      if (typeof b.move === 'boolean') desk.move = b.move;
      if (b.toggleMove) desk.move = !desk.move;
      if (typeof b.hideAll === 'boolean') desk.hideAll = b.hideAll;
      if (b.add) {
        const url = deskCleanUrl(b.add.url);
        if (!url) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'That link does not look right - it should start with http:// or /' });
        const d = (deskApp.displays.find(x => x.primary) || deskApp.displays[0] || { x: 0, y: 0, w: 1920, h: 1080 });
        const w = { id: `w${desk.seq++}`, name: 'Widget', url, x: d.x + 100 + desk.widgets.length * 30, y: d.y + 100 + desk.widgets.length * 30, w: 600, h: 400, opacity: 100, zoom: 100, on: true, locked: false };
        deskApply(w, { ...b.add, url: undefined });
        desk.widgets.push(w);
      }
      if (b.update && b.update.id) { const w = desk.widgets.find(x => x.id === String(b.update.id)); if (w) deskApply(w, b.update); }
      if (b.remove) desk.widgets = desk.widgets.filter(x => x.id !== String(b.remove));
      if (b.order && Array.isArray(b.order)) { const m = new Map(desk.widgets.map(w => [w.id, w])); desk.widgets = b.order.map(id => m.get(id)).filter(Boolean).concat(desk.widgets.filter(w => !b.order.includes(w.id))); }
      deskSave(); return mHttpResponse.sendJson(res, 200, deskPublic());
    }
    // From the desktop app: its screens (heartbeat) and where she dragged a widget to.
    if (pathname === '/api/desktop/app' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      deskApp.seen = Date.now();
      if (typeof b.version === 'string') deskApp.version = mDomainValidation.cleanString(b.version).slice(0, 20);
      if (Array.isArray(b.displays)) deskApp.displays = b.displays.slice(0, 8).map((d, i) => ({ id: String(d.id || i), x: deskNum(d.x, -20000, 20000, 0), y: deskNum(d.y, -20000, 20000, 0),
        w: deskNum(d.w, 100, 20000, 1920), h: deskNum(d.h, 100, 20000, 1080), primary: !!d.primary, scale: Number(d.scale) || 1 }));
      if (b.bounds && b.bounds.id) {
        const w = desk.widgets.find(x => x.id === String(b.bounds.id));
        if (w) { deskApply(w, { x: b.bounds.x, y: b.bounds.y, w: b.bounds.w, h: b.bounds.h }); mStorage.writeJson(DESK_FILE, desk); }
      }
      if (b.toggleMove) { desk.move = !desk.move; mStorage.writeJson(DESK_FILE, desk); }
      return mHttpResponse.sendJson(res, 200, deskPublic());
    }
    // From webcam.html: the camera names it found (so the dashboard can offer a list).
    if (pathname === '/api/desktop/cams' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      if (Array.isArray(b.cams)) deskApp.cams = b.cams.slice(0, 12).map(c => mDomainValidation.cleanString(c).slice(0, 80)).filter(Boolean);
      if (typeof b.status === 'string') { deskApp.camStatus = mDomainValidation.cleanString(b.status).slice(0, 300); deskApp.camAt = Date.now(); }
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown desktop route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Desktop widgets request failed.' });
  }
}

Object.assign(exports, { handleDeskApi });
