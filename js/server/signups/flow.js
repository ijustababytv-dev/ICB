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
// FLOW TREE SIGN-UP (Baby, 2026-10-20): its own copy of the Poke Bowl Sign-up (STREAM EVENT SIGN-UP above),
// so changing this one never touches the others. Same features; generated from that section.
//   - Overlay: /flowtree-signup.html   - Dashboard: /flowtree-signup-control.html   - data/flowtree-signup.json
//   - Pops up (hidden-until-asked) with !flow / !flowtree / !flowtrees only. Remembered in-game names are
//     shared with the Poke Bowl Sign-up (sashi.names), so viewers only type their name once.
// ---------------------------------------------------------------------------
const FTSU_FILE = path.join(mConfig.DATA_DIR, 'flowtree-signup.json');
/** Create independent initial Flow Tree signup settings for first-run or missing saved fields. */
function ftsuDefaults() {
  return { visible: true, open: true, live: 'e1', seq: 2, font: mSignupsPoke.sashi.font || 26, cols: mSignupsPoke.sashi.cols || 2, title: '🌳 Flow Tree Sign-Up', max: 0, ignore: '',
    accent: mSignupsPoke.sashi.accent || '#ff8fd8', panelColor: mSignupsPoke.sashi.panelColor || '#1c0e28', panelOpacity: mSignupsPoke.sashi.panelOpacity === undefined ? 85 : mSignupsPoke.sashi.panelOpacity, showZones: true, showCountdown: true, rseq: 1,
    onDemand: !!mSignupsPoke.sashi.onDemand, showSec: mSignupsPoke.sashi.showSec || 30, showOnSignup: mSignupsPoke.sashi.showOnSignup !== false,
    zones: mSignupsPoke.sashi.zones.map(z => ({ ...z })),
    events: [{ id: 'e1', name: 'Flow Trees', guests: [] }] };
}
/** Normalize saved guests and role definitions before a signup event is used. */
function ftsuFixEvent(ev) {
  ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
  ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
  ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
  ev.date = typeof ev.date === 'string' ? ev.date : ''; ev.time = typeof ev.time === 'string' ? ev.time : '';
  ev.tz = mDomainTimezone.etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
  ev.game = mDomainValidation.cleanString(ev.game).slice(0, 30) || 'Palia';
  for (const g of ev.guests) if (typeof g.role !== 'string' || !ev.roles.some(r => r.id === g.role)) g.role = '';
  return ev;
}
/** Restore Flow Tree signup state from disk and supply defaults for missing fields. */
function ftsuLoad() {
  const raw = mStorage.readJson(FTSU_FILE, null) || {}; const s = { ...ftsuDefaults(), ...raw };
  if (!Array.isArray(s.events) || !s.events.length) s.events = ftsuDefaults().events;
  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = ftsuDefaults().zones;
  s.zones = s.zones.filter(z => z && mDomainTimezone.etValidTz(z.tz));
  delete s.names;
  s.events.forEach(ftsuFixEvent);
  return s;
}
let ftsu = ftsuLoad();
const ftsuEv = id => ftsu.events.find(e => e.id === (id || ftsu.live)) || null;
const ftsuRenumber = ev => { ev.guests.forEach((g, i) => { g.n = i + 1; }); };
const ftsuEpoch = ev => (ev && ev.date && ev.time ? mDomainTimezone.etToEpoch(ev.date, ev.time, ev.tz) : null);
// "Hidden until chat asks" (2026-10-15): with ftsu.onDemand on, the overlay stays invisible until chat types
// "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
let ftsuShowUntil = 0;
let ftsuChatHidden = false;   // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
/** Extend the signup display window without changing its guest list. */
function ftsuReveal(sec) { ftsuShowUntil = Date.now() + (sec || ftsu.showSec || 30) * 1000; mEvents.broadcast('flowtree-signup', ftsuPublic()); }
/** Build the Flow Tree signup response consumed by dashboards and overlays. */
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
/** Persist operator changes to the Flow Tree signup state file. */
function ftsuSave() { mStorage.writeJson(FTSU_FILE, ftsu); mEvents.broadcast('flowtree-signup', ftsuPublic()); }
const ftsuPop = () => { if (ftsu.onDemand && ftsu.showOnSignup !== false) ftsuShowUntil = Math.max(ftsuShowUntil, Date.now() + (ftsu.showSec || 30) * 1000); };
const ftsuCleanName = x => mDomainValidation.cleanString(x).replace(/^\s*\d+[.)\-:]\s+/, '').replace(/[<>]/g, '').trim().slice(0, 40);
const ftsuCleanCmd = v => mDomainValidation.cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
/** Add unique guest names, preserve the list limit, and renumber the resulting lineup. */
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
  const set = new Set(mSignupsPoke.SASHI_BUILTIN_IGNORE);
  for (const w of String(ftsu.ignore || '').split(/[\s,]+/)) { const c = w.toLowerCase().replace(/^!+/, ''); if (c) set.add(c); }
  try { for (const b of mParty.partyLiveBoards()) for (const r of b.ev.roles) if (r.command) { set.add(r.command); for (let i = 1; i <= 7; i++) set.add(r.command + i); } } catch (_e) {}
  for (const c of mSignupsCommands.signupRoleCmds()) set.add(c);
  try { [mTeams.teams.item.command].concat(mTeams.teams.item.aliases ? mTeams.teams.item.aliases.split(/,\s*/) : []).forEach(c => { if (c) set.add(String(c).toLowerCase()); }); } catch (_e) {}
  return set;
}
// Party-board role commands that are live right now (to warn her about clashes).
function ftsuPartyCmds() { const set = new Set(); try { for (const b of mParty.partyLiveBoards()) for (const r of b.ev.roles) if (r.command) set.add(r.command); } catch (_e) {} return set; }
/** Resolve remembered viewer names for this event game without mixing different games. */
function ftsuNames(ev) { const k = mSignupsPoke.sashiGameKey(ev.game); return mSignupsPoke.sashi.names[k] || (mSignupsPoke.sashi.names[k] = {}); }
// Remember their in-game name for this event's game (also for names she fixes on the dashboard).
function ftsuRemember(ev, twitch, name) { if (twitch && name && ftsuNames(ev)[String(twitch).toLowerCase()] !== name) { ftsuNames(ev)[String(twitch).toLowerCase()] = name; mStorage.writeJson(mSignupsPoke.SASHI_FILE, mSignupsPoke.sashi); } }
// A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
function ftsuChatName(v) {
  const name = String(v || '').replace(/^\[|\]$/g, '').replace(/[<>]/g, '').trim();
  if (name.length < 2 || name.length > 32 || !/[a-z]/i.test(name) || name.split(' ').length > 3 || /@|https?:|www\./i.test(name)) return '';
  return name;
}
/** Interpret supported Flow Tree signup chat commands while preserving unrelated messages. */
function ftsuChat(sender, parts) {
  const twitch = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!twitch) return '';
  const text = mParty.partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
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
/** Validate and dispatch Flow Tree signup API requests, returning client errors for invalid input. */
async function handleFtsuApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/flowtree-signup' && method === 'GET') return mHttpResponse.sendJson(res, 200, ftsuPublic());
    if (pathname === '/api/flowtree-signup/admin' && method === 'GET') {
      const ev = ftsuEv(), pc = new Set([...ftsuPartyCmds(), ...mSignupsCommands.signupRoleCmds('ftsu')]);
      return mHttpResponse.sendJson(res, 200, { ...ftsuPublic(), visible: ftsu.visible, live: ftsu.live, ignore: ftsu.ignore, builtinIgnore: mSignupsPoke.SASHI_BUILTIN_IGNORE, allZones: ftsu.zones,
        clashes: ev ? ev.roles.filter(r => pc.has(r.cmd)).map(r => r.cmd) : [],
        remembered: ev ? Object.entries(mSignupsPoke.sashi.names[mSignupsPoke.sashiGameKey(ev.game)] || {}).map(([twitch, name]) => ({ twitch, name })) : [],
        games: Array.from(new Set(ftsu.events.map(e => e.game).concat(['Palia', 'Aniimo']))),
        events: ftsu.events.map(e => ({ id: e.id, name: e.name, count: e.guests.length })) });
    }
    if (pathname === '/api/flowtree-signup' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      for (const k of ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup']) if (typeof b[k] === 'boolean') ftsu[k] = b[k];
      if (b.showSec !== undefined) ftsu.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { ftsuChatHidden = false; ftsuShowUntil = Date.now() + (ftsu.showSec || 30) * 1000; }
      if (b.hideNow) { ftsuShowUntil = 0; ftsuChatHidden = true; }
      if (typeof b.title === 'string') ftsu.title = mDomainValidation.cleanString(b.title).slice(0, 60);
      if (typeof b.ignore === 'string') ftsu.ignore = mDomainValidation.cleanString(b.ignore).slice(0, 500);
      if (b.font !== undefined) ftsu.font = Math.max(12, Math.min(70, Math.round(Number(b.font)) || 26));
      if (b.cols !== undefined) ftsu.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
      if (b.max !== undefined) ftsu.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
      if (b.panelOpacity !== undefined) ftsu.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && mNews.newsHex(b[k])) ftsu[k] = b[k];
      // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
      if (Array.isArray(b.zones)) {
        ftsu.zones = b.zones.slice(0, 24).filter(z => z && mDomainTimezone.etValidTz(z.tz)).map(z => ({ tz: String(z.tz), label: mDomainValidation.cleanString(z.label).slice(0, 24) || String(z.tz).split('/').pop().replace(/_/g, ' '), on: !!z.on }));
      }
      if (b.newEvent) { const id = `e${ftsu.seq++}`; ftsu.events.push(ftsuFixEvent({ id, name: mDomainValidation.cleanString(b.newEvent).slice(0, 60) || 'Event', guests: [] })); ftsu.live = id; }
      if (b.copyEvent) { // duplicate an event's details + roles (empty list) - handy for weekly repeats
        const src = ftsuEv(String(b.copyEvent));
        if (src) { const id = `e${ftsu.seq++}`; ftsu.events.push(ftsuFixEvent({ id, name: (src.name + ' (copy)').slice(0, 60), desc: src.desc, date: src.date, time: src.time, tz: src.tz, roles: JSON.parse(JSON.stringify(src.roles)), guests: [] })); ftsu.live = id; }
      }
      if (b.live && ftsuEv(String(b.live))) ftsu.live = String(b.live);
      const ev = ftsuEv(b.event ? String(b.event) : null);
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
            const cmd = ftsuCleanCmd(r && r.cmd), label = mDomainValidation.cleanString(r && r.label).slice(0, 40);
            if (!cmd || !label || used.has(cmd) || mSignupsPoke.SASHI_RESERVED.has(cmd)) continue;
            used.add(cmd);
            const old = r.id && ev.roles.find(x => x.id === String(r.id));
            out.push({ id: old ? old.id : `r${ftsu.rseq++}`, label, cmd, spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)), color: mNews.newsHex(r.color) || '' });
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
      if (b.forget && b.forget.game && b.forget.twitch) { const m = mSignupsPoke.sashi.names[mSignupsPoke.sashiGameKey(b.forget.game)]; if (m) { delete m[String(b.forget.twitch).toLowerCase()]; mStorage.writeJson(mSignupsPoke.SASHI_FILE, mSignupsPoke.sashi); } }
      if (b.deleteEvent && ftsu.events.length > 1) {
        ftsu.events = ftsu.events.filter(e => e.id !== String(b.deleteEvent));
        if (!ftsuEv()) ftsu.live = ftsu.events[0].id;
      }
      ftsuSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/flowtree-signup/test' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      return mHttpResponse.sendJson(res, 200, { ok: true, reply: ftsuChat(mDomainValidation.cleanString(b.name) || 'TestViewer', [{ t: 'text', v: mDomainValidation.cleanString(b.text) }]) || 'ignored' });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown flowtree-signup route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Event sign-up request failed.' });
  }
}

// "!show <word>" / "!hide <word>" for every sign-up widget (Baby, 2026-10-20):
//   !show poke / !hide poke    -> Poke Bowl Sign-up      !show cake / !hide cake -> Cake Sign-Ups (all party boards)
//   !show burger / !hide burger -> Bean Burger Sign-Up   !show flow / !hide flow -> Flow Tree Sign-Up
// !hide keeps it off screen until !show (or the dashboard's Show button). !show brings it back; when the widget is
// "hidden until chat asks" it shows for its usual N seconds. The dashboard's "Show on stream" switch still wins.

Object.assign(exports, { ftsuPublic, ftsuEv, ftsuChat, handleFtsuApi });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
  ftsuChatHidden: { enumerable: true, get: () => ftsuChatHidden, set: value => { ftsuChatHidden = value; } },
  ftsu: { enumerable: true, get: () => ftsu, set: value => { ftsu = value; } },
  ftsuShowUntil: { enumerable: true, get: () => ftsuShowUntil, set: value => { ftsuShowUntil = value; } },
});
