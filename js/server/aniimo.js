'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mParty = require('./party');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mNews = require('./news');

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
const DEX_FILE = path.join(mConfig.DATA_DIR, 'aniimo-dex.json');
const DEX_SEED = path.join(mConfig.APP_DIR, 'config', 'aniimo-roster.json');
const DEX_ELEMENTS = ['Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Rock', 'Wind', 'Dark', 'Holy'];
/** Create independent initial aniimo settings for first-run or missing saved fields. */
function dexDefaults() {
  return { visible: true, title: '✨ Aniimo Dex', chat: true, popupSec: 8, lookupSec: 14, showElements: true, accent: '#7dd3fc', panelColor: '#101522', panelOpacity: 88,
    roster: [], checked: {}, recent: [], seq: 1 };
}
const dexCleanVariant = v => mDomainValidation.cleanString(v).replace(/Prismana Form Form/g, 'Prismana Form').replace(/[<>|]/g, '').slice(0, 50);
/** Normalize incoming aniimo values to the supported fields and limits. */
function dexCleanAniimo(a, id) {
  const variants = [];
  for (const v of (Array.isArray(a.variants) ? a.variants : String(a.variants || '').split(/\r?\n|,/))) { const c = dexCleanVariant(v); if (c && !variants.includes(c)) variants.push(c); }
  return { id: id || String(a.id || a.number || '').replace(/[^0-9a-z_-]/gi, '').slice(0, 20), number: mDomainValidation.cleanString(a.number).slice(0, 10), name: mDomainValidation.cleanString(a.name).replace(/[<>]/g, '').slice(0, 40),
    element: mDomainValidation.cleanString(a.element).slice(0, 40), variants: variants.slice(0, 40), image: a.image && mDomainValidation.DECOR_IMAGE_EXT.test(String(a.image)) ? path.basename(String(a.image)) : '',
    // Photos of individual forms she caught / hatched (2026-10-14): { "Highland Form": "001__highlandform.webp" }
    formImages: a.formImages && typeof a.formImages === 'object' ? Object.fromEntries(Object.entries(a.formImages).filter(([v, f]) => variants.includes(dexCleanVariant(v)) && mDomainValidation.DECOR_IMAGE_EXT.test(String(f))).map(([v, f]) => [dexCleanVariant(v), path.basename(String(f))])) : {} };
}
/** Restore aniimo state from disk and supply defaults for missing fields. */
function dexLoad() {
  const raw = mStorage.readJson(DEX_FILE, null);
  const d = { ...dexDefaults(), ...(raw || {}) };
  if (!raw || !Array.isArray(raw.roster) || !raw.roster.length) {
    const seed = mStorage.readJson(DEX_SEED, null);
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
const DEX_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'aniimo');
try { fs.mkdirSync(DEX_ART_DIR, { recursive: true }); } catch (_error) {}
let dexArtList = null, dexArtAt = 0;
/** Locate supported local aniimo artwork while tolerating missing files. */
function dexArtFiles() {
  if (!dexArtList || Date.now() - dexArtAt > 5000) {
    dexArtAt = Date.now(); dexArtList = new Map();
    try { for (const f of fs.readdirSync(DEX_ART_DIR)) if (mDomainValidation.DECOR_IMAGE_EXT.test(f)) dexArtList.set(f.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]/g, ''), f); } catch (_e) {}
  }
  return dexArtList;
}
const dexSlug = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Resolve local aniimo artwork to the URL used by its display. */
function dexArtUrl(f) { let v = 0; try { v = Math.round(fs.statSync(path.join(DEX_ART_DIR, f)).mtimeMs); } catch (_e) { return null; } return `/assets/aniimo/${encodeURIComponent(f)}?v=${v}`; }
/** Resolve local aniimo artwork to the URL used by its display. */
function dexFormImg(a, v) { return a && a.formImages && a.formImages[v] ? dexArtUrl(a.formImages[v]) : null; }
/** Resolve local aniimo artwork to the URL used by its display. */
function dexFormImgs(a) { const o = {}; if (a && a.formImages) for (const v of Object.keys(a.formImages)) { const u = dexFormImg(a, v); if (u) o[v] = u; } return o; }
/** Resolve local aniimo artwork to the URL used by its display. */
function dexImg(a) {
  if (!a) return null;
  const files = dexArtFiles();
  const url = f => { let v = 0; try { v = Math.round(fs.statSync(path.join(DEX_ART_DIR, f)).mtimeMs); } catch (_e) { return null; } return `/assets/aniimo/${encodeURIComponent(f)}?v=${v}`; };
  if (a.image) { const u = url(a.image); if (u) return u; }
  const tries = [a.number, String(a.number).replace(/^0+/, ''), a.name, String(a.name).split('/')[0], a.id].map(dexSlug).filter(Boolean);
  for (const t of tries) { const f = files.get(t); if (f) return url(f); }
  return null;
}
/** Derive collection completion from checked variants and the current roster. */
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
/** Build the aniimo response consumed by dashboards and overlays. */
function dexPublic() {
  const now = Date.now();
  return { ok: true, visible: dex.visible, title: dex.title, chat: dex.chat, showElements: dex.showElements, accent: dex.accent, panelColor: dex.panelColor, panelOpacity: dex.panelOpacity,
    stats: dexStats(), recent: dex.recent.slice(0, 8).map(r => { const a = dexFind(r.id); return { ...r, img: dexFormImg(a, r.variant) || dexImg(a) }; }), popup: dexPopup && dexPopup.until > now ? dexPopup : null, lookup: dexLookup && dexLookup.until > now ? dexLookup : null, now };
}
/** Persist operator changes to the aniimo state file. */
function dexSave() { mStorage.writeJson(DEX_FILE, dex); mEvents.broadcast('aniimo', dexPublic()); }
/** Update one valid Aniimo variant without disturbing other collection entries. */
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
/** Interpret supported aniimo chat commands while preserving unrelated messages. */
function dexChat(sender, parts) {
  if (!dex.chat) return '';
  const name = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40); if (!name) return '';
  const text = mParty.partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
  const m = /^!(need|dex)\b ?(.*)$/i.exec(text); if (!m) return '';
  const now = Date.now(), key = name.toLowerCase();
  if (now - (dexChatSeen.get(key) || 0) < 20000 || now - dexChatLast < 4000) return '';   // 20 s per person, 4 s overall
  dexChatSeen.set(key, now); dexChatLast = now;
  const sec = dex.lookupSec * 1000;
  if (m[1].toLowerCase() === 'dex' || !m[2]) { dexLookup = { kind: 'dex', by: name, until: now + sec, at: now }; mEvents.broadcast('aniimo', dexPublic()); return 'dex'; }
  const a = dexSearch(m[2]);
  if (!a) { dexLookup = { kind: 'notfound', by: name, q: m[2].slice(0, 30), until: now + 6000, at: now }; mEvents.broadcast('aniimo', dexPublic()); return 'not found'; }
  const have = a.variants.filter(v => dex.checked[dexKey(a.id, v)]), need = a.variants.filter(v => !dex.checked[dexKey(a.id, v)]);
  dexLookup = { kind: 'need', by: name, id: a.id, name: a.name, number: a.number, element: a.element, img: dexImg(a), formImgs: dexFormImgs(a), have, need, until: now + sec, at: now };
  mEvents.broadcast('aniimo', dexPublic()); return `${a.name}: needs ${need.length}`;
}
/** Validate and dispatch aniimo API requests, returning client errors for invalid input. */
async function handleDexApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/aniimo' && method === 'GET') return mHttpResponse.sendJson(res, 200, dexPublic());
    if (pathname === '/api/aniimo/admin' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ...dexPublic(), roster: dex.roster.map(a => ({ ...a, img: dexImg(a), formImgs: dexFormImgs(a) })), checked: dex.checked, popupSec: dex.popupSec, lookupSec: dex.lookupSec, elements: DEX_ELEMENTS });
    if (pathname === '/api/aniimo' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      for (const k of ['visible', 'chat', 'showElements']) if (typeof b[k] === 'boolean') dex[k] = b[k];
      if (typeof b.title === 'string') dex.title = mDomainValidation.cleanString(b.title).slice(0, 60);
      if (b.popupSec !== undefined) dex.popupSec = Math.max(2, Math.min(60, Math.round(Number(b.popupSec)) || 8));
      if (b.lookupSec !== undefined) dex.lookupSec = Math.max(4, Math.min(60, Math.round(Number(b.lookupSec)) || 14));
      if (b.panelOpacity !== undefined) dex.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && mNews.newsHex(b[k])) dex[k] = b[k];
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
        if (!a.name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'An Aniimo needs a name.' });
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
        dexSave(); return mHttpResponse.sendJson(res, 200, { ok: true, imported: n });
      }
      if (b.resetChecks === 'yes') { dex.checked = {}; dex.recent = []; }
      dexSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/aniimo/export' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="aniimo-dex-backup.json"' });
      return res.end(JSON.stringify({ app: 'ICB Aniimo Dex', exportedAt: new Date().toISOString(), roster: dex.roster, checked: dex.checked }, null, 2));
    }
    // Picture for one Aniimo: { id, dataUrl } saves it (assets/aniimo/<number>.<ext>); { id, remove: true } clears it.
    if (pathname === '/api/aniimo/image' && method === 'POST') {
      const b = await mHttpBody.readBody(req); const a = dexFind(b.id);
      if (!a) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No Aniimo with that id.' });
      // A photo for ONE form: { id, variant, dataUrl } / { id, variant, remove: true }. Optional tick: true also ticks it.
      if (b.variant) {
        const v = dexCleanVariant(b.variant);
        if (!a.variants.includes(v)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'That Aniimo has no such form.' });
        a.formImages = a.formImages || {};
        if (a.formImages[v]) { try { fs.unlinkSync(path.join(DEX_ART_DIR, a.formImages[v])); } catch (_e) {} }
        if (b.remove) { delete a.formImages[v]; dexSave(); return mHttpResponse.sendJson(res, 200, { ok: true }); }
        const fm = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
        if (!fm) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
        const fb = Buffer.from(fm[2], 'base64');
        if (fb.length > 9 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
        const fname = `${(dexSlug(a.number) || dexSlug(a.name) || a.id).slice(0, 30)}__${dexSlug(v).slice(0, 40) || 'form'}.${fm[1] === 'jpeg' ? 'jpg' : fm[1]}`;
        fs.writeFileSync(path.join(DEX_ART_DIR, fname), fb);
        a.formImages[v] = fname;
        if (b.tick) dexSet(a.id, v, true);
        dexSave(); return mHttpResponse.sendJson(res, 200, { ok: true, img: dexFormImg(a, v) });
      }
      if (b.remove) {
        const cur = dexImg(a);   // her uploaded picture, or a file she dropped in that was matched by name/number
        if (cur) { try { fs.unlinkSync(path.join(DEX_ART_DIR, decodeURIComponent(cur.split('/').pop().split('?')[0]))); } catch (_e) {} }
        a.image = ''; dexArtList = null; dexSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
      }
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 9 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = (dexSlug(a.number) || dexSlug(a.name) || a.id).slice(0, 30);
      if (a.image) { try { fs.unlinkSync(path.join(DEX_ART_DIR, a.image)); } catch (_e) {} }
      for (const e of ['png', 'jpg', 'jpeg', 'webp', 'gif']) { try { fs.unlinkSync(path.join(DEX_ART_DIR, `${base}.${e}`)); } catch (_e) {} }
      a.image = `${base}.${ext}`;
      fs.writeFileSync(path.join(DEX_ART_DIR, a.image), buffer);
      dexArtList = null; dexSave(); return mHttpResponse.sendJson(res, 200, { ok: true, img: dexImg(a) });
    }
    if (pathname === '/api/aniimo/test' && method === 'POST') {
      const b = await mHttpBody.readBody(req); dexChatSeen.clear(); dexChatLast = 0;
      return mHttpResponse.sendJson(res, 200, { ok: true, reply: dexChat(mDomainValidation.cleanString(b.name) || 'TestViewer', [{ t: 'text', v: mDomainValidation.cleanString(b.text) }]) || 'ignored' });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown aniimo route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Aniimo Dex request failed.' });
  }
}

Object.assign(exports, { dexChat, handleDexApi });
