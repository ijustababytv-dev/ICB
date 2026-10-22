'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');
const mDomainValidation = require('./domain/validation');
const mGiveawayState = require('./giveaway/state');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mTradeup = require('./tradeup');

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
const WALKERS_FILE = path.join(mConfig.DATA_DIR, 'walkers.json');
const WALKERS_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor', 'unicorn');
// Subscriber-only pictures (Baby, 2026-10-01): never in the random pool;
// only subscribers can have them. Person art "subs:<file>" points here.
const WALKERS_SUB_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor', 'unicorn-subs');
try { fs.mkdirSync(WALKERS_SUB_ART_DIR, { recursive: true }); } catch (_error) {}
// Personal pictures (Baby, 2026-10-03): one person's own picture of their
// choice, uploaded from their row on the dashboard. Never used for anyone
// else, never random. Person art "personal:<file>"; person.personal remembers it.
const WALKERS_PERSONAL_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor', 'unicorn-personal');
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
/** Normalize incoming walkers values to the supported fields and limits. */
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

/** Restore walkers state from disk and supply defaults for missing fields. */
function loadWalkers() {
  const raw = mStorage.readJson(WALKERS_FILE, {}) || {};
  const s = { ...WALKERS_DEFAULT_SETTINGS, ...(raw.settings || {}) };
  s.enabled = s.enabled !== false;
  s.artFacesLeft = s.artFacesLeft === true;
  const look = walkerCleanLook({ ...WALKERS_DEFAULT_SETTINGS }, s);
  for (const k of ['namePosition', 'nameFont', 'nameColor', 'nameOutlineColor', 'nameBgColor', 'nameBold', 'nameBackground', 'showChat', 'subsAuto', 'whoGets']) s[k] = look[k];
  for (const [k, [lo, hi]] of Object.entries(WALKERS_LIMITS)) {
    const n = Number(s[k]);
    s[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : WALKERS_DEFAULT_SETTINGS[k];
  }
  s.reminders = (Array.isArray(s.reminders) ? s.reminders : []).map(r => mDomainValidation.cleanString(r).slice(0, 140)).filter(Boolean).slice(0, 30);
  s.anims = walkerCleanAnims(s.anims, null);
  if (!WALKERS_ENTRANCES[s.entrance]) s.entrance = 'drop';
  if (!WALKERS_EXITS[s.exitStyle]) s.exitStyle = 'walk';
  const people = {};
  for (const [key, p] of Object.entries(raw.people || {})) {
    if (!p || !p.name) continue;
    people[key.toLowerCase()] = {
      name: mDomainValidation.cleanString(p.name).slice(0, 40),
      allowed: p.allowed === true ? true : (p.allowed === false ? false : null), // null = automatic (subs)
      art: walkerCleanArtRef(p.art),
      lastSeen: p.lastSeen || null,
      personal: p.personal && mDomainValidation.DECOR_IMAGE_EXT.test(path.basename(String(p.personal))) ? path.basename(String(p.personal)) : null,
    };
  }
  return { settings: s, people };
}

let walkers = loadWalkers();
let walkerEvents = [];   // recent chat for the overlay: { seq, name, parts, at }
let walkerSeq = 0;
try { fs.mkdirSync(WALKERS_ART_DIR, { recursive: true }); } catch (_error) {}

/** Persist operator changes to the walkers state file. */
function saveWalkers() { mStorage.writeJson(WALKERS_FILE, { settings: walkers.settings, people: walkers.people }); }

/** Resolve local walkers artwork to the URL used by its display. */
function walkerArt() {
  try { return fs.readdirSync(WALKERS_ART_DIR).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b)); }
  catch (_error) { return []; }
}
/** Resolve local walkers artwork to the URL used by its display. */
function walkerSubArt() {
  try { return fs.readdirSync(WALKERS_SUB_ART_DIR).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b)); }
  catch (_error) { return []; }
}
// A person's picked picture: "file.png" (everyone's pool) or "subs:file.png" (subscriber-only).
function walkerCleanArtRef(ref) {
  if (!ref) return null;
  const str = String(ref);
  if (str.startsWith('subs:')) { const f = path.basename(str.slice(5)); return mDomainValidation.DECOR_IMAGE_EXT.test(f) ? `subs:${f}` : null; }
  if (str.startsWith('personal:')) { const f = path.basename(str.slice(9)); return mDomainValidation.DECOR_IMAGE_EXT.test(f) ? `personal:${f}` : null; }
  const f = path.basename(str);
  return mDomainValidation.DECOR_IMAGE_EXT.test(f) ? f : null;
}
/** Resolve local walkers artwork to the URL used by its display. */
function walkerArtUrl(ref) {
  if (ref.startsWith('personal:')) return `/decor-art/unicorn-personal/${encodeURIComponent(ref.slice(9))}`;
  return ref.startsWith('subs:') ? `/decor-art/unicorn-subs/${encodeURIComponent(ref.slice(5))}` : `/decor-art/unicorn/${encodeURIComponent(ref)}`;
}
/** Derive a stable numeric seed so a viewer keeps a consistent default avatar. */
function walkerHash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

/** Check the saved subscriber eligibility used for subscriber-only artwork. */
function walkerIsSub(name) {
  const key = mGiveawayState.findEntrantKey(name);
  const e = key ? mGiveawayState.giveaway.entrants[key] : null;
  return !!(e && e.counts && e.counts.subMonths > 0);
}

/** Honor the walker allow/block settings before placing a viewer on screen. */
function walkerAllowed(name) {
  if (!name || mGiveawayState.isBlocked(name)) return false;
  const p = walkers.people[name.toLowerCase()];
  if (p && p.allowed !== null && p.allowed !== undefined) return p.allowed;
  return walkers.settings.whoGets === 'subs' ? walkerIsSub(name) : true;
}

// Keep only what the bubble needs: text and emote pictures.
function walkerParts(data) {
  const parts = [];
  for (const f of (Array.isArray(data && data.fragments) ? data.fragments : []).slice(0, 40)) {
    if (!f || typeof f !== 'object') continue;
    if (f.type === 'EMOTE' && /^https:\/\/[^\s"']+$/i.test(String(f.imageLink || ''))) parts.push({ t: 'emote', url: f.imageLink, name: mDomainValidation.cleanString(f.emoteName || f.text).slice(0, 40) });
    else if (typeof f.text === 'string' || typeof f.raw === 'string') parts.push({ t: 'text', v: String(f.text != null ? f.text : f.raw).slice(0, 300) });
  }
  if (!parts.length && data && typeof data.raw === 'string') parts.push({ t: 'text', v: data.raw.slice(0, 300) });
  return parts;
}

// Called for every relayed chat message.
function walkerChat(name, parts, force) {
  name = mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
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

/** Expose visible walkers and only the chat events newer than the client cursor. */
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

/** Expose editable walker settings and available artwork for the private dashboard. */
function walkerAdminState() {
  const art = walkerArt();
  const names = new Map();
  for (const p of Object.values(walkers.people)) names.set(p.name.toLowerCase(), p.name);
  for (const e of Object.values(mGiveawayState.giveaway.entrants || {})) if (e && e.username && !names.has(e.username.toLowerCase())) names.set(e.username.toLowerCase(), e.username);
  const people = [...names.entries()].filter(([, n]) => !mGiveawayState.isBlocked(n)).map(([key, name]) => {
    const p = walkers.people[key] || {};
    return { name, isSub: walkerIsSub(name), override: p.allowed === undefined ? null : p.allowed, allowed: walkerAllowed(name), art: p.art || null, personal: p.personal || null, lastSeen: p.lastSeen || null };
  }).sort((a, b) => (b.allowed - a.allowed) || String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || a.name.localeCompare(b.name));
  return { ok: true, settings: walkers.settings, art, subArt: walkerSubArt(), people, fonts: WALKERS_FONTS, anims: WALKERS_ANIMS, entrances: WALKERS_ENTRANCES, exits: WALKERS_EXITS };
}

/** Validate and dispatch walkers API requests, returning client errors for invalid input. */
async function handleWalkersApi(req, res, pathname, method, url) {
  try {
    if (pathname === '/api/walkers/state' && method === 'GET') {
      const since = Number(url.searchParams.get('since')) || 0;
      return mHttpResponse.sendJson(res, 200, walkerOverlayState(since));
    }
    if (pathname === '/api/walkers/admin' && method === 'GET') return mHttpResponse.sendJson(res, 200, walkerAdminState());

    if (pathname === '/api/walkers/settings' && (method === 'PUT' || method === 'POST')) {
      const body = await mHttpBody.readBody(req);
      const s = walkers.settings;
      if (typeof body.enabled === 'boolean') s.enabled = body.enabled;
      if (typeof body.artFacesLeft === 'boolean') s.artFacesLeft = body.artFacesLeft;
      walkerCleanLook(s, body);
      for (const [k, [lo, hi]] of Object.entries(WALKERS_LIMITS)) {
        if (body[k] === undefined) continue;
        const n = Number(body[k]);
        if (Number.isFinite(n)) s[k] = Math.min(hi, Math.max(lo, n));
      }
      if (Array.isArray(body.reminders)) s.reminders = body.reminders.map(r => mDomainValidation.cleanString(r).slice(0, 140)).filter(Boolean).slice(0, 30);
      if (body.anims && typeof body.anims === 'object') s.anims = walkerCleanAnims(body.anims, s.anims);
      if (WALKERS_ENTRANCES[body.entrance]) s.entrance = body.entrance;
      if (WALKERS_EXITS[body.exitStyle]) s.exitStyle = body.exitStyle;
      saveWalkers();
      return mHttpResponse.sendJson(res, 200, walkerAdminState());
    }

    // { name, allowed: true | false | null (automatic), art: filename | null }
    if (pathname === '/api/walkers/person' && (method === 'PUT' || method === 'POST')) {
      const body = await mHttpBody.readBody(req);
      const name = mDomainValidation.cleanString(body.name).replace(/^@/, '').slice(0, 40);
      if (!name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Missing name.' });
      const key = name.toLowerCase();
      const p = walkers.people[key] || (walkers.people[key] = { name, allowed: null, art: null, lastSeen: null });
      if (body.allowed === true || body.allowed === false || body.allowed === null) p.allowed = body.allowed;
      if (body.art === null || body.art === '') p.art = null;
      else if (typeof body.art === 'string') {
        const ref = walkerCleanArtRef(body.art);
        if (ref && ref.startsWith('personal:')) {
          if (!p.personal || p.personal !== ref.slice(9)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Upload their own picture first.' });
          p.art = ref;
        } else if (ref && ref.startsWith('subs:')) {
          if (!walkerSubArt().includes(ref.slice(5))) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'No such subscriber picture.' });
          if (!walkerIsSub(name)) return mHttpResponse.sendJson(res, 400, { ok: false, error: `${name} isn't a subscriber, so they can't have a subscriber-only picture.` });
          p.art = ref;
        } else if (ref && walkerArt().includes(ref)) p.art = ref;
      }
      saveWalkers();
      return mHttpResponse.sendJson(res, 200, walkerAdminState());
    }

    // Test button: a pretend chatter says something (shows even if not ticked).
    // { id }: every unicorn on screen does that animation right now (preview).
    if (pathname === '/api/walkers/try' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const id = String(body.id || '');
      if (!WALKERS_ANIMS.some(a => a.id === id) && !WALKERS_ENTRANCES[id.replace(/^enter:/, '')] && !WALKERS_EXITS[id.replace(/^exit:/, '')]) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Unknown animation.' });
      walkerTry = { id, at: Date.now() };
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/walkers/test' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const name = mDomainValidation.cleanString(body.name) || `TestUnicorn${1 + Math.floor(Math.random() * 9)}`;
      const text = mDomainValidation.cleanString(body.text).slice(0, 300) || 'Hi everyone! 🦄';
      walkerChat(name, [{ t: 'text', v: text }], true);
      return mHttpResponse.sendJson(res, 200, { ok: true, name });
    }

    // One person's own picture: { name, dataUrl } - saved just for them and picked for them.
    if (pathname === '/api/walkers/person-art' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const name = mDomainValidation.cleanString(body.name).replace(/^@/, '').slice(0, 40);
      if (!name) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Missing name.' });
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = mTradeup.tradeupSlug(name);
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(WALKERS_PERSONAL_DIR, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(WALKERS_PERSONAL_DIR, filename), buffer);
      const key = name.toLowerCase();
      const p = walkers.people[key] || (walkers.people[key] = { name, allowed: null, art: null, lastSeen: null });
      // Their old personal picture is kept in the folder, just no longer used.
      p.personal = filename;
      p.art = `personal:${filename}`;
      saveWalkers();
      return mHttpResponse.sendJson(res, 200, walkerAdminState());
    }

    // Add a picture: { dataUrl, name, pool: 'all' | 'subs' }
    if (pathname === '/api/walkers/art' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = mTradeup.tradeupSlug(String(body.name || 'unicorn').replace(/\.[a-z0-9]+$/i, ''));
      const dir = body.pool === 'subs' ? WALKERS_SUB_ART_DIR : WALKERS_ART_DIR;
      fs.mkdirSync(dir, { recursive: true });
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(dir, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      return mHttpResponse.sendJson(res, 200, walkerAdminState());
    }

    // Move a picture between everyone's pool and subscriber-only: { file, to: 'subs' | 'all' }
    if (pathname === '/api/walkers/art/move' && method === 'POST') {
      const body = await mHttpBody.readBody(req);
      const file = path.basename(String(body.file || ''));
      const toSubs = body.to === 'subs';
      const fromDir = toSubs ? WALKERS_ART_DIR : WALKERS_SUB_ART_DIR, toDir = toSubs ? WALKERS_SUB_ART_DIR : WALKERS_ART_DIR;
      if (!mDomainValidation.DECOR_IMAGE_EXT.test(file) || !fs.existsSync(path.join(fromDir, file))) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No such picture.' });
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
      return mHttpResponse.sendJson(res, 200, walkerAdminState());
    }

    // Send every unicorn off screen right now.
    if (pathname === '/api/walkers/clear' && method === 'POST') {
      walkers.clearAt = Date.now();
      return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown walkers route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Walkers request failed.' });
  }
}

Object.assign(exports, { walkerIsSub, walkerChat, walkerParts, handleWalkersApi });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
  walkers: { enumerable: true, get: () => walkers, set: value => { walkers = value; } },
});
