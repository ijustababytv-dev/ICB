'use strict';

const path = require('node:path');
const mConfig = require('../config');
const mSignupsPoke = require('./poke');
const mDomainTimezone = require('../domain/timezone');
const mDomainValidation = require('../domain/validation');
const mStorage = require('../storage');
const mEvents = require('../events');
const mParty = require('../party');
const mSignupsCommands = require('./commands');
const mTeams = require('../teams');
const mHttpResponse = require('../http/response');
const mHttpBody = require('../http/body');
const mNews = require('../news');

// ---------------------------------------------------------------------------
// BEAN BURGER SIGN-UP (Baby, 2026-10-20): its own copy of the Poke Bowl Sign-up (STREAM EVENT SIGN-UP above),
// so changing this one never touches the others. Same features; generated from that section.
//   - Overlay: /beanburger-signup.html   - Dashboard: /beanburger-signup-control.html   - data/beanburger-signup.json
//   - Pops up (hidden-until-asked) with !burger / !burgers / !beanburger only. Remembered in-game names are
//     shared with the Poke Bowl Sign-up (sashi.names), so viewers only type their name once.
// ---------------------------------------------------------------------------
const BBSU_FILE = path.join(mConfig.DATA_DIR, 'beanburger-signup.json');
/** Create independent initial Bean Burger signup settings for first-run or missing saved fields. */
function bbsuDefaults() {
  return { visible: true, open: true, live: 'e1', seq: 2, font: mSignupsPoke.sashi.font || 26, cols: mSignupsPoke.sashi.cols || 2, title: '🍔 Bean Burger Sign-Up', max: 0, ignore: '',
    accent: mSignupsPoke.sashi.accent || '#ff8fd8', panelColor: mSignupsPoke.sashi.panelColor || '#1c0e28', panelOpacity: mSignupsPoke.sashi.panelOpacity === undefined ? 85 : mSignupsPoke.sashi.panelOpacity, showZones: true, showCountdown: true, rseq: 1,
    onDemand: !!mSignupsPoke.sashi.onDemand, showSec: mSignupsPoke.sashi.showSec || 30, showOnSignup: mSignupsPoke.sashi.showOnSignup !== false,
    zones: mSignupsPoke.sashi.zones.map(z => ({ ...z })),
    events: [{ id: 'e1', name: 'Bean Burgers', guests: [] }] };
}
/** Normalize saved guests and role definitions before a signup event is used. */
function bbsuFixEvent(ev) {
  ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
  ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
  ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
  ev.date = typeof ev.date === 'string' ? ev.date : ''; ev.time = typeof ev.time === 'string' ? ev.time : '';
  ev.tz = mDomainTimezone.etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
  ev.game = mDomainValidation.cleanString(ev.game).slice(0, 30) || 'Palia';
  for (const g of ev.guests) if (typeof g.role !== 'string' || !ev.roles.some(r => r.id === g.role)) g.role = '';
  return ev;
}
/** Restore Bean Burger signup state from disk and supply defaults for missing fields. */
function bbsuLoad() {
  const raw = mStorage.readJson(BBSU_FILE, null) || {}; const s = { ...bbsuDefaults(), ...raw };
  if (!Array.isArray(s.events) || !s.events.length) s.events = bbsuDefaults().events;
  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = bbsuDefaults().zones;
  s.zones = s.zones.filter(z => z && mDomainTimezone.etValidTz(z.tz));
  delete s.names;
  s.events.forEach(bbsuFixEvent);
  return s;
}
let bbsu = bbsuLoad();
const bbsuEv = id => bbsu.events.find(e => e.id === (id || bbsu.live)) || null;
const bbsuRenumber = ev => { ev.guests.forEach((g, i) => { g.n = i + 1; }); };
const bbsuEpoch = ev => (ev && ev.date && ev.time ? mDomainTimezone.etToEpoch(ev.date, ev.time, ev.tz) : null);
// "Hidden until chat asks" (2026-10-15): with bbsu.onDemand on, the overlay stays invisible until chat types
// "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
let bbsuShowUntil = 0;
let bbsuChatHidden = false;   // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
/** Extend the signup display window without changing its guest list. */
function bbsuReveal(sec) { bbsuShowUntil = Date.now() + (sec || bbsu.showSec || 30) * 1000; mEvents.broadcast('beanburger-signup', bbsuPublic()); }
/** Build the Bean Burger signup response consumed by dashboards and overlays. */
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
/** Persist operator changes to the Bean Burger signup state file. */
function bbsuSave() { mStorage.writeJson(BBSU_FILE, bbsu); mEvents.broadcast('beanburger-signup', bbsuPublic()); }
const bbsuPop = () => { if (bbsu.onDemand && bbsu.showOnSignup !== false) bbsuShowUntil = Math.max(bbsuShowUntil, Date.now() + (bbsu.showSec || 30) * 1000); };
const bbsuCleanName = x => mDomainValidation.cleanString(x).replace(/^\s*\d+[.)\-:]\s+/, '').replace(/[<>]/g, '').trim().slice(0, 40);
const bbsuCleanCmd = v => mDomainValidation.cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
/** Add unique guest names, preserve the list limit, and renumber the resulting lineup. */
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
  const set = new Set(mSignupsPoke.SASHI_BUILTIN_IGNORE);
  for (const w of String(bbsu.ignore || '').split(/[\s,]+/)) { const c = w.toLowerCase().replace(/^!+/, ''); if (c) set.add(c); }
  try { for (const b of mParty.partyLiveBoards()) for (const r of b.ev.roles) if (r.command) { set.add(r.command); for (let i = 1; i <= 7; i++) set.add(r.command + i); } } catch (_e) {}
  for (const c of mSignupsCommands.signupRoleCmds()) set.add(c);
  try { [mTeams.teams.item.command].concat(mTeams.teams.item.aliases ? mTeams.teams.item.aliases.split(/,\s*/) : []).forEach(c => { if (c) set.add(String(c).toLowerCase()); }); } catch (_e) {}
  return set;
}
// Party-board role commands that are live right now (to warn her about clashes).
function bbsuPartyCmds() { const set = new Set(); try { for (const b of mParty.partyLiveBoards()) for (const r of b.ev.roles) if (r.command) set.add(r.command); } catch (_e) {} return set; }
/** Resolve remembered viewer names for this event game without mixing different games. */
function bbsuNames(ev) { const k = mSignupsPoke.sashiGameKey(ev.game); return mSignupsPoke.sashi.names[k] || (mSignupsPoke.sashi.names[k] = {}); }
// Remember their in-game name for this event's game (also for names she fixes on the dashboard).
function bbsuRemember(ev, twitch, name) { if (twitch && name && bbsuNames(ev)[String(twitch).toLowerCase()] !== name) { bbsuNames(ev)[String(twitch).toLowerCase()] = name; mStorage.writeJson(mSignupsPoke.SASHI_FILE, mSignupsPoke.sashi); } }
// A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
function bbsuChatName(v) {
  const name = String(v || '').replace(/^\[|\]$/g, '').replace(/[<>]/g, '').trim();
  if (name.length < 2 || name.length > 32 || !/[a-z]/i.test(name) || name.split(' ').length > 3 || /@|https?:|www\./i.test(name)) return '';
  return name;
}
/** Interpret supported Bean Burger signup chat commands while preserving unrelated messages. */
function bbsuChat(sender, parts) {
  const twitch = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!twitch) return '';
  const text = mParty.partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
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
/** Validate and dispatch Bean Burger signup API requests, returning client errors for invalid input. */
async function handleBbsuApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/beanburger-signup' && method === 'GET') return mHttpResponse.sendJson(res, 200, bbsuPublic());
    if (pathname === '/api/beanburger-signup/admin' && method === 'GET') {
      const ev = bbsuEv(), pc = new Set([...bbsuPartyCmds(), ...mSignupsCommands.signupRoleCmds('bbsu')]);
      return mHttpResponse.sendJson(res, 200, { ...bbsuPublic(), visible: bbsu.visible, live: bbsu.live, ignore: bbsu.ignore, builtinIgnore: mSignupsPoke.SASHI_BUILTIN_IGNORE, allZones: bbsu.zones,
        clashes: ev ? ev.roles.filter(r => pc.has(r.cmd)).map(r => r.cmd) : [],
        remembered: ev ? Object.entries(mSignupsPoke.sashi.names[mSignupsPoke.sashiGameKey(ev.game)] || {}).map(([twitch, name]) => ({ twitch, name })) : [],
        games: Array.from(new Set(bbsu.events.map(e => e.game).concat(['Palia', 'Aniimo']))),
        events: bbsu.events.map(e => ({ id: e.id, name: e.name, count: e.guests.length })) });
    }
    if (pathname === '/api/beanburger-signup' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      for (const k of ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup']) if (typeof b[k] === 'boolean') bbsu[k] = b[k];
      if (b.showSec !== undefined) bbsu.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { bbsuChatHidden = false; bbsuShowUntil = Date.now() + (bbsu.showSec || 30) * 1000; }
      if (b.hideNow) { bbsuShowUntil = 0; bbsuChatHidden = true; }
      if (typeof b.title === 'string') bbsu.title = mDomainValidation.cleanString(b.title).slice(0, 60);
      if (typeof b.ignore === 'string') bbsu.ignore = mDomainValidation.cleanString(b.ignore).slice(0, 500);
      if (b.font !== undefined) bbsu.font = Math.max(12, Math.min(70, Math.round(Number(b.font)) || 26));
      if (b.cols !== undefined) bbsu.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
      if (b.max !== undefined) bbsu.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
      if (b.panelOpacity !== undefined) bbsu.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && mNews.newsHex(b[k])) bbsu[k] = b[k];
      // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
      if (Array.isArray(b.zones)) {
        bbsu.zones = b.zones.slice(0, 24).filter(z => z && mDomainTimezone.etValidTz(z.tz)).map(z => ({ tz: String(z.tz), label: mDomainValidation.cleanString(z.label).slice(0, 24) || String(z.tz).split('/').pop().replace(/_/g, ' '), on: !!z.on }));
      }
      if (b.newEvent) { const id = `e${bbsu.seq++}`; bbsu.events.push(bbsuFixEvent({ id, name: mDomainValidation.cleanString(b.newEvent).slice(0, 60) || 'Event', guests: [] })); bbsu.live = id; }
      if (b.copyEvent) { // duplicate an event's details + roles (empty list) - handy for weekly repeats
        const src = bbsuEv(String(b.copyEvent));
        if (src) { const id = `e${bbsu.seq++}`; bbsu.events.push(bbsuFixEvent({ id, name: (src.name + ' (copy)').slice(0, 60), desc: src.desc, date: src.date, time: src.time, tz: src.tz, roles: JSON.parse(JSON.stringify(src.roles)), guests: [] })); bbsu.live = id; }
      }
      if (b.live && bbsuEv(String(b.live))) bbsu.live = String(b.live);
      const ev = bbsuEv(b.event ? String(b.event) : null);
      if (ev) {
        if (typeof b.name === 'string' && mDomainValidation.cleanString(b.name)) ev.name = mDomainValidation.cleanString(b.name).slice(0, 60);
        if (typeof b.game === 'string' && mDomainValidation.cleanString(b.game)) ev.game = mDomainValidation.cleanString(b.game).slice(0, 30);
        if (typeof b.desc === 'string') ev.desc = String(b.desc).replace(/[<>]/g, '').slice(0, 400);
        if (typeof b.date === 'string') ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
        if (typeof b.time === 'string') ev.time = /^\d{1,2}:\d{2}$/.test(b.time) ? b.time : '';
        if (typeof b.tz === 'string' && mDomainTimezone.etValidTz(b.tz)) ev.tz = b.tz;
        // Roles (her own): full list [{id?, label, cmd, spots, color}] replaces the event's roles.
        if (Array.isArray(b.roles)) {
          const used = new Set(), out = [];
          for (const r of b.roles.slice(0, 12)) {
            const cmd = bbsuCleanCmd(r && r.cmd), label = mDomainValidation.cleanString(r && r.label).slice(0, 40);
            if (!cmd || !label || used.has(cmd) || mSignupsPoke.SASHI_RESERVED.has(cmd)) continue;
            used.add(cmd);
            const old = r.id && ev.roles.find(x => x.id === String(r.id));
            out.push({ id: old ? old.id : `r${bbsu.rseq++}`, label, cmd, spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)), color: mNews.newsHex(r.color) || '' });
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
      if (b.forget && b.forget.game && b.forget.twitch) { const m = mSignupsPoke.sashi.names[mSignupsPoke.sashiGameKey(b.forget.game)]; if (m) { delete m[String(b.forget.twitch).toLowerCase()]; mStorage.writeJson(mSignupsPoke.SASHI_FILE, mSignupsPoke.sashi); } }
      if (b.deleteEvent && bbsu.events.length > 1) {
        bbsu.events = bbsu.events.filter(e => e.id !== String(b.deleteEvent));
        if (!bbsuEv()) bbsu.live = bbsu.events[0].id;
      }
      bbsuSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/beanburger-signup/test' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      return mHttpResponse.sendJson(res, 200, { ok: true, reply: bbsuChat(mDomainValidation.cleanString(b.name) || 'TestViewer', [{ t: 'text', v: mDomainValidation.cleanString(b.text) }]) || 'ignored' });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown beanburger-signup route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Event sign-up request failed.' });
  }
}

Object.assign(exports, { bbsuPublic, bbsuEv, bbsuChat, handleBbsuApi });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
  bbsuChatHidden: { enumerable: true, get: () => bbsuChatHidden, set: value => { bbsuChatHidden = value; } },
  bbsu: { enumerable: true, get: () => bbsu, set: value => { bbsu = value; } },
  bbsuShowUntil: { enumerable: true, get: () => bbsuShowUntil, set: value => { bbsuShowUntil = value; } },
});
