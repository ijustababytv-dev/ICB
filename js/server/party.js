'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mTradeup = require('./tradeup');

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
const PARTY_FILE = path.join(mConfig.DATA_DIR, 'parties.json');
/** Normalize a role command into the supported lowercase chat-command alphabet. */
function partyCmd(v) { return mDomainValidation.cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24); }
const PARTY_RESERVED = new Set(['leave', 'team', 'vote', 'unvote', 'here', 'checkin', 'signin', 'party', 'show', 'hide']);
const PARTY_CHECKIN_CMDS = new Set(['here', 'checkin', 'signin']);
/** Create an independent party record with its initial settings. */
function partyNewEvent(seq) {
  return { id: `e${seq}`, title: 'Overprep Party', when: '', subtitle: '', open: true,
    roles: [
      { id: 'r1', command: 'tomato', label: 'Tomato', emoji: '🍅', spots: 2, group: 'Overprep', bring: '' },
      { id: 'r2', command: 'rice', label: 'Rice', emoji: '🍚', spots: 2, group: 'Overprep', bring: '' },
    ], signups: [], rseq: 3 };
}
/** Normalize incoming party values to the supported fields and limits. */
function partyCleanRole(r, ev) {
  const id = r && /^r\d{1,5}$/.test(String(r.id || '')) ? String(r.id) : `r${ev.rseq++}`;
  return { id, command: partyCmd(r && r.command), label: mDomainValidation.cleanString(r && r.label).slice(0, 40), emoji: mDomainValidation.cleanString(r && r.emoji).slice(0, 8),
    spots: Math.max(1, Math.min(50, Math.round(Number(r && r.spots)) || 1)),
    // 2026-10-07: any kind of role, grouped into sections on the board (Overprep, Cooking,
    // Helpers...), plus what that role must bring - shown on stream under the role.
    group: mDomainValidation.cleanString(r && r.group).slice(0, 30),
    bring: mDomainValidation.cleanString(r && r.bring).slice(0, 200) };
}
/** Restore party state from disk and supply defaults for missing fields. */
function partyLoad() {
  const raw = mStorage.readJson(PARTY_FILE, null);
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
const PARTY_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'party');
try { fs.mkdirSync(PARTY_ART_DIR, { recursive: true }); } catch (_error) {}
const partyArtUrl = f => (f ? `/assets/party/${encodeURIComponent(f)}` : null);
/** Locate supported local party artwork while tolerating missing files. */
function partyArtFile(v) { const f = v ? path.basename(String(v)) : null; return f && mDomainValidation.DECOR_IMAGE_EXT.test(f) && fs.existsSync(path.join(PARTY_ART_DIR, f)) ? f : null; }
let parties = partyLoad();
// One-time import (2026-10-07): if data/party-seed.json exists, its events are ADDED (existing events
// and sign-ups are never touched) and put on the boards it names, then the file is renamed so it
// never imports twice. Lets Claude set up Baby's weekly parties while ICB is running.
(function partyImportSeed() {
  const file = path.join(mConfig.DATA_DIR, 'party-seed.json');
  if (!fs.existsSync(file)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const se of (Array.isArray(seed.events) ? seed.events : []).slice(0, 20)) {
      const ev = partyNewEvent(parties.seq++);
      ev.title = mDomainValidation.cleanString(se.title).slice(0, 80) || ev.title;
      ev.when = mDomainValidation.cleanString(se.when).slice(0, 80);
      ev.subtitle = mDomainValidation.cleanString(se.subtitle).slice(0, 140);
      ev.open = se.open !== false;
      ev.roles = (Array.isArray(se.roles) ? se.roles : []).slice(0, 20).map(r => partyCleanRole({ ...r, id: undefined }, ev)).filter(r => r.command && !PARTY_RESERVED.has(r.command));
      for (const r of ev.roles) if (!r.label) r.label = r.command;
      parties.events.push(ev);
      const n = Math.round(Number(se.board));
      if (n >= 1 && n <= PARTY_SLOTS && !(se.boardIfEmpty && parties.slots[n - 1])) { parties.slots = parties.slots.map(x => (x === ev.id ? null : x)); parties.slots[n - 1] = ev.id; }
    }
    mStorage.writeJson(PARTY_FILE, parties);
    fs.renameSync(file, path.join(mConfig.DATA_DIR, `party-seed.imported-${Date.now()}.json`));
    console.log('[party] imported party-seed.json');
  } catch (error) { console.log('[party] party-seed.json not imported:', error.message); }
})();
// Board 1's event (kept for older callers) and every live board.
function partyLive() { return parties.events.find(e => e.id === parties.slots[0]) || parties.events.find(e => e.id === parties.liveId) || parties.events[0]; }
/** Resolve the configured live board slots while ignoring missing saved events. */
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
/** Temporarily spotlight the requested party slot for an overlay viewer. */
function partySpotRequest(n, by) {
  if (!(n >= 1 && n <= PARTY_SLOTS) || !parties.slots[n - 1]) return false;
  partySpot = { slot: n, until: Date.now() + (parties.spotHoldSec || 60) * 1000, by: by || '' };
  return true;
}
/** Return the spotlight slot only while its requested display window remains active. */
function partySpotSlot() {
  const live = partyLiveBoards().map(b => b.slot);
  if (!live.length) return null;
  if (partySpot.slot && Date.now() < partySpot.until && live.includes(partySpot.slot)) return partySpot.slot;
  const step = Math.max(5, parties.spotRotateSec || 20) * 1000;
  return live[Math.floor(Date.now() / step) % live.length];
}
/** Describe the current spotlight for dashboards and overlays. */
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
/** Extend the requested party display window without changing guest assignments. */
function partyReveal(n, sec) {
  const until = Date.now() + (sec || parties.showSec || 30) * 1000;
  if (n === 'all') partyShowUntil.all = until; else if (n >= 1 && n <= PARTY_SLOTS) partyShowUntil[n] = until;
  mEvents.broadcast('party', partyPublic());
}
/** Apply on-demand visibility and temporary reveal windows to a board slot. */
function partyShown(n) {
  if (!parties.visible || partyChatHidden) return false;
  if (!parties.onDemand) return true;
  const now = Date.now();
  if (n === 'spot') return now < (partyShowUntil.all || 0) || !!(partySpot.slot && now < partySpot.until);
  return now < (partyShowUntil.all || 0) || now < (partyShowUntil[n] || 0);
}
/** Find the visible slot assigned to a saved event. */
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
/** Build the party response consumed by dashboards and overlays. */
function partyPublic(slot) {
  const n = Math.max(1, Math.min(PARTY_SLOTS, Number(slot) || 1));
  const id = parties.slots[n - 1], ev = id && parties.events.find(e => e.id === id);
  return { ok: true, visible: partyShown(n), visibleSetting: parties.visible, chatHidden: partyChatHidden, onDemand: !!parties.onDemand, showTwitch: parties.showTwitch, board: n, empty: !ev, event: ev ? partyView(ev) : null, now: Date.now() };
}
/** Persist operator changes to the party state file. */
function partySave() { mStorage.writeJson(PARTY_FILE, parties); mEvents.broadcast('party', partyPublic()); }
// Meld sends chat text HTML-encoded (an apostrophe arrives as &#39;) - turn it back into plain text.
function partyDecode(t) {
  return String(t || '').replace(/&#(\d{1,6});/g, (_m, n) => String.fromCodePoint(Math.min(0x10FFFF, Number(n))))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n) => String.fromCodePoint(Math.min(0x10FFFF, parseInt(n, 16))))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/** Interpret supported party chat commands while preserving unrelated messages. */
function partyChat(name, parts) {
  // NOTE: no isBlocked() here on purpose - the giveaway block list includes Baby herself
  // (IJustABabyTv), and she signs up for roles at her own parties (2026-10-07).
  name = mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
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
  let palia = mDomainValidation.cleanString(m[2]).replace(/[<>]/g, '').replace(/^\[|\]$/g, '').trim().slice(0, 32);
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
/** Validate and dispatch party API requests, returning client errors for invalid input. */
async function handlePartyApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/party' && method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const bq = String(q.get('board') || q.get('slot') || '');
      if (bq === 'spot' || bq === 'spotlight') {
        const sl = partySpotSlot();
        return mHttpResponse.sendJson(res, 200, { ...(sl ? partyPublic(sl) : { ok: true, showTwitch: parties.showTwitch, empty: true, event: null, now: Date.now() }), visible: partyShown('spot'), spot: partySpotInfo() });
      }
      let slot = Number(bq) || 1;
      if (q.get('event')) { const sl = partySlotOf(String(q.get('event'))); if (sl) slot = sl; }
      return mHttpResponse.sendJson(res, 200, partyPublic(slot));
    }
    if (pathname === '/api/party/admin' && method === 'GET') {
      const art = (() => { try { return fs.readdirSync(PARTY_ART_DIR).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).sort((x, y) => x.localeCompare(y)); } catch (_e) { return []; } })();
      return mHttpResponse.sendJson(res, 200, { ...partyPublic(), visible: parties.visible, showSec: parties.showSec || 30, showOnSignup: parties.showOnSignup !== false, art, liveId: parties.slots[0] || null, slots: parties.slots, spot: partySpotInfo(),
        events: parties.events.map(e => ({ id: e.id, title: e.title, when: e.when, count: e.signups.length, slot: partySlotOf(e.id) })),
        full: parties.events.map(e => ({ ...partyView(e), signups: e.signups.slice().sort((a, b) => a.at - b.at) })) });
    }
    const b = ['POST', 'PUT', 'PATCH'].includes(method) ? await mHttpBody.readBody(req) : {};
    const findEv = id => parties.events.find(e => e.id === String(id || '')) || null;
    if (pathname === '/api/party/settings' && method === 'POST') {
      if (typeof b.visible === 'boolean') parties.visible = b.visible;
      if (typeof b.showTwitch === 'boolean') parties.showTwitch = b.showTwitch;
      if (b.liveId && findEv(b.liveId)) { parties.liveId = String(b.liveId); parties.slots[0] = String(b.liveId); }
      // Put an event on a board: { board: 1-7, eventId | null }. An event sits on one board at a time.
      if (b.board !== undefined) {
        const n = Math.round(Number(b.board));
        if (!(n >= 1 && n <= PARTY_SLOTS)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Board must be 1-7.' });
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
      partySave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Create a new event: { copyFrom? } copies title/roles (not sign-ups).
    if (pathname === '/api/party/event/new' && method === 'POST') {
      const ev = partyNewEvent(parties.seq++);
      const src = findEv(b.copyFrom);
      if (src) { ev.title = src.title; ev.subtitle = src.subtitle; ev.roles = JSON.parse(JSON.stringify(src.roles)); ev.rseq = src.rseq;
        for (const k of ['bgImage', 'titleImage', 'bgFit', 'panel', 'roleCards', 'border']) if (src[k] !== undefined) ev[k] = src[k]; }
      parties.events.push(ev);
      if (b.makeLive) { const free = parties.slots.indexOf(null); if (free >= 0) parties.slots[free] = ev.id; }
      partySave(); return mHttpResponse.sendJson(res, 200, { ok: true, id: ev.id });
    }
    if (pathname === '/api/party/event' && method === 'POST') {
      const ev = findEv(b.id); if (!ev) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Event not found.' });
      if (b.delete) {
        if (parties.events.length <= 1) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Keep at least one event.' });
        parties.events = parties.events.filter(e => e !== ev);
        parties.slots = parties.slots.map(x => (x === ev.id ? null : x));
        if (parties.liveId === ev.id) parties.liveId = parties.slots.find(Boolean) || parties.events[0].id;
        partySave(); return mHttpResponse.sendJson(res, 200, { ok: true });
      }
      if (typeof b.title === 'string') ev.title = mDomainValidation.cleanString(b.title).slice(0, 80);
      if (typeof b.when === 'string') ev.when = mDomainValidation.cleanString(b.when).slice(0, 80);
      if (typeof b.subtitle === 'string') ev.subtitle = mDomainValidation.cleanString(b.subtitle).slice(0, 140);
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
        if (dup) return mHttpResponse.sendJson(res, 400, { ok: false, error: `Two roles use !${dup.command}.` });
        for (const r of roles) if (!r.label) r.label = r.command;
        ev.roles = roles;
        const ids = new Set(roles.map(r => r.id));
        ev.signups = ev.signups.filter(s => ids.has(s.role));
      }
      if (b.clearSignups) ev.signups = [];
      partySave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Her edits to one person: { id (event), key, role?, palia?, remove? } or add { id, twitch, palia, role }.
    if (pathname === '/api/party/signup' && method === 'POST') {
      const ev = findEv(b.id); if (!ev) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Event not found.' });
      const key = mDomainValidation.cleanString(b.key || b.twitch).replace(/^@/, '').toLowerCase().slice(0, 40);
      if (!key) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Name needed.' });
      let s = ev.signups.find(x => x.key === key);
      if (b.remove) { ev.signups = ev.signups.filter(x => x.key !== key); partySave(); return mHttpResponse.sendJson(res, 200, { ok: true }); }
      const role = b.role ? ev.roles.find(r => r.id === b.role) : null;
      if (!s) {
        if (!role) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Pick a role.' });
        const twitch = mDomainValidation.cleanString(b.twitch).replace(/^@/, '').slice(0, 40);
        s = { key, twitch, palia: mDomainValidation.cleanString(b.palia).slice(0, 32) || twitch, role: role.id, at: Date.now() };
        ev.signups.push(s);
      } else {
        if (role && role.id !== s.role) { s.role = role.id; s.at = Date.now(); }
        if (typeof b.palia === 'string' && mDomainValidation.cleanString(b.palia)) s.palia = mDomainValidation.cleanString(b.palia).slice(0, 32);
        if (b.top) s.at = Math.min(...ev.signups.map(x => x.at)) - 1; // move to the front of the role (off the waitlist)
        if (typeof b.checkedIn === 'boolean') s.checkedIn = b.checkedIn ? Date.now() : null;
      }
      partySave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Fold / unfold role panels on stream (2026-10-07): { id: eventId, roleId, collapsed? } toggles one;
    // { id, all: true|false } folds or opens every role. Clicking a role header on the Meld board calls this too.
    if (pathname === '/api/party/collapse' && method === 'POST') {
      const ev = findEv(b.id); if (!ev) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Event not found.' });
      ev.collapsed = ev.collapsed && typeof ev.collapsed === 'object' ? ev.collapsed : {};
      if (typeof b.all === 'boolean') { ev.collapsed = {}; if (b.all) for (const r of ev.roles) ev.collapsed[r.id] = true; }
      else {
        const r = ev.roles.find(x => x.id === String(b.roleId || '')); if (!r) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Role not found.' });
        const want = typeof b.collapsed === 'boolean' ? b.collapsed : !ev.collapsed[r.id];
        if (want) ev.collapsed[r.id] = true; else delete ev.collapsed[r.id];
      }
      partySave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Upload a picture for party boards: { dataUrl, name } -> assets/party/<name>.png
    if (pathname === '/api/party/image' && method === 'POST') {
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(b.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 9 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture is too large (max 8MB) - the dashboard shrinks big pictures automatically.' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = mTradeup.tradeupSlug(String(b.name || 'party-art').replace(/\.[a-z0-9]+$/i, '')) || 'party-art';
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(PARTY_ART_DIR, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(PARTY_ART_DIR, filename), buffer);
      return mHttpResponse.sendJson(res, 200, { ok: true, file: filename });
    }
    if (pathname === '/api/party/test' && method === 'POST') {
      const r = partyChat(mDomainValidation.cleanString(b.name) || 'TestViewer', [{ t: 'text', v: mDomainValidation.cleanString(b.text) }]);
      return mHttpResponse.sendJson(res, 200, { ok: true, result: r || 'ignored (not a sign-up command on any live board)' });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown party route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Party request failed.' });
  }
}

Object.assign(exports, { partyLiveBoards, partyDecode, partyReveal, partyPublic, partyShowUntil, partyChat, handlePartyApi });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
  partyChatHidden: { enumerable: true, get: () => partyChatHidden, set: value => { partyChatHidden = value; } },
  parties: { enumerable: true, get: () => parties, set: value => { parties = value; } },
  partySpot: { enumerable: true, get: () => partySpot, set: value => { partySpot = value; } },
});
