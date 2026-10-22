'use strict';

const path = require('node:path');
const { URL } = require('node:url');
const mConfig = require('./config');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mSprites = require('./sprites');
const mDomainValidation = require('./domain/validation');

// ---------------------------------------------------------------------------
// COUNTDOWNS (Baby, 2026-10-19). Replaces her Meld/Spark "timer-7pm-cst" element with an ICB one she
// controls from the dashboard: themes, size, position, text, the message when it's over.
//   - Overlay /countdown.html?id=<id> (one Meld layer per countdown), dashboard /countdown-control.html.
//   - data/countdowns.json { list: [ { id, name, ...look/text settings, status, endsAt, leftMs } ] }
//   - status: idle | running | paused | done. endsAt = ms epoch while running; leftMs while paused.
// ---------------------------------------------------------------------------
const CD_FILE = path.join(mConfig.DATA_DIR, 'countdowns.json');
/** Create independent initial countdowns settings for first-run or missing saved fields. */
function cdDefaults(id, name) {
  return { id, name: name || 'Countdown', heading: 'STREAM STARTS IN', subheading: 'GRAB A SNACK 🌸', endText: '✨ WE\'RE LIVE! ✨', endSub: '',
    icon: '✨', theme: 'flowtree', font: 'Outfit', accent1: '#38bdf8', accent2: '#c084fc', textColor: '#ffffff', plate: '#1c1130', plateAlpha: 92,
    scale: 100, x: 50, y: 50, showHours: 'auto', showLabels: true, showBadge: true, showSub: true, pulseDot: true, floaty: true, flowBorder: true,
    labelH: 'HOURS', labelM: 'MINUTES', labelS: 'SECONDS', celebrate: true, hideAfter: 0, idleShow: 'dim',
    lastMinutes: 10, lastTime: '19:00', lastTz: 'America/Chicago', status: 'idle', endsAt: 0, leftMs: 0, doneAt: 0 };
}
/** Restore countdowns state from disk and supply defaults for missing fields. */
function cdLoad() {
  const raw = mStorage.readJson(CD_FILE, null);
  const list = raw && Array.isArray(raw.list) && raw.list.length ? raw.list : [cdDefaults('main', 'Main countdown')];
  return { list: list.map(c => ({ ...cdDefaults(c.id, c.name), ...c })) };
}
let cdState = cdLoad();
/** Persist operator changes to the countdowns state file. */
function cdSave() { mStorage.writeJson(CD_FILE, cdState); mEvents.broadcast('countdowns', { ok: true }); }
const cdFind = id => cdState.list.find(c => c.id === String(id || 'main')) || null;
/** Mark elapsed running countdowns done so dashboards and overlays agree. */
function cdTick() {   // a running countdown that reaches zero becomes "done" (so the dashboard shows it too)
  let changed = false; const now = Date.now();
  for (const c of cdState.list) if (c.status === 'running' && c.endsAt && c.endsAt <= now) { c.status = 'done'; c.doneAt = c.endsAt; changed = true; }
  if (changed) cdSave();
}

const CD_TEXT = ['name', 'heading', 'subheading', 'endText', 'endSub', 'icon', 'labelH', 'labelM', 'labelS', 'lastTime', 'lastTz'];
const CD_THEMES = ['flowtree', 'spooky', 'pink', 'gold', 'fortnite', 'glass', 'custom'];
const CD_FONTS = ['Outfit', 'Comfortaa', 'Fredoka', 'Chewy', 'Creepster', 'Bungee', 'Quicksand', 'Orbitron'];
/** Validate and dispatch countdowns API requests, returning client errors for invalid input. */
async function handleCountdownsApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/countdowns' && method === 'GET') {
      cdTick();
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      if (id) { const c = cdFind(id); return mHttpResponse.sendJson(res, c ? 200 : 404, c ? { ok: true, countdown: c, now: Date.now() } : { ok: false, error: 'No countdown with that id.' }); }
      return mHttpResponse.sendJson(res, 200, { ok: true, list: cdState.list, themes: CD_THEMES, fonts: CD_FONTS, now: Date.now() });
    }
    if (pathname === '/api/countdowns' && method === 'POST') {
      const b = await mHttpBody.readBody(req), now = Date.now();
      if (b.add) {
        let id = mSprites.sprSlug(b.add.name || 'countdown') || 'countdown', n = 2, base = id;
        while (cdFind(id)) id = `${base}-${n++}`;
        const src = b.add.copyFrom ? cdFind(b.add.copyFrom) : null;
        cdState.list.push({ ...(src ? { ...src, status: 'idle', endsAt: 0, leftMs: 0 } : cdDefaults(id)), id, name: mDomainValidation.cleanString(b.add.name || 'Countdown').slice(0, 40) });
        cdSave(); return mHttpResponse.sendJson(res, 200, { ok: true, id });
      }
      if (b.remove) { if (cdState.list.length > 1) cdState.list = cdState.list.filter(c => c.id !== String(b.remove)); cdSave(); return mHttpResponse.sendJson(res, 200, { ok: true }); }
      const c = cdFind(b.id); if (!c) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No countdown with that id.' });
      const s = b.set || {};
      for (const k of CD_TEXT) if (typeof s[k] === 'string') c[k] = mDomainValidation.cleanString(s[k]).slice(0, 120);
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
      cdSave(); return mHttpResponse.sendJson(res, 200, { ok: true, countdown: c, now });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown countdowns route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Countdowns request failed.' });
  }
}

Object.assign(exports, { handleCountdownsApi });

exports.cdTick = cdTick;
