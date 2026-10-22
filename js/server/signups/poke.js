'use strict';

const path = require('node:path');
const mConfig = require('../config');
const mDomainValidation = require('../domain/validation');
const mDomainTimezone = require('../domain/timezone');
const mStorage = require('../storage');
const mEvents = require('../events');
const mParty = require('../party');
const mSignupsCommands = require('./commands');
const mTeams = require('../teams');
const mHttpResponse = require('../http/response');
const mHttpBody = require('../http/body');
const mNews = require('../news');

// ---------------------------------------------------------------------------
// STREAM EVENT SIGN-UP (was "Sashimi Sign-Up"; Baby 2026-10-09 -> 2026-10-12 "like Sesh, but for stream").
// Each saved event has: name, description, a start time (date + time in her zone) shown converted
// into the world time zones she ticks, a live countdown, and OPTIONAL roles - each role has its
// own chat command (e.g. "!fish Moon Pie"), an optional number of spots and a waitlist past that.
//   - No roles on an event: chat signs up with "!" + Palia name (e.g. "!Moon Pie"), like before.
//   - With roles: "!<role command> PaliaName" (or just "!<role command>" = remembered / Twitch name).
//     Switching role = typing another role's command. One sign-up per Twitch account per event.
//   - "!leave" takes their own name off (even when sign-ups are closed).
//   - Each event has a GAME (Palia, Aniimo...). ICB remembers every viewer's in-game name per game
//     (sashi.names[gameKey][twitch]) the first time they sign up, so next time "!<role command>"
//     or "!signup" alone is enough.
// She sets up roles herself on the dashboard (never pre-fill or guess roles for her).
//   - Overlay:   /sashimi-signin.html      - Dashboard: /sashimi-signin-control.html  (names kept so Meld links still work)
//   - Saved in data/sashimi-signin.json (several saved events, one live)
// No isBlocked() on purpose: Baby can sign herself up too.
// ---------------------------------------------------------------------------
const SASHI_FILE = path.join(mConfig.DATA_DIR, 'sashimi-signin.json');
const SASHI_BUILTIN_IGNORE = ['here', 'checkin', 'signin', 'leave', 'party', 'show', 'team', 'vote', 'unvote', 'lurk', 'unlurk', 'discord', 'socials',
  'so', 'shoutout', 'hug', 'commands', 'uptime', 'followage', 'raid', 'giveaway', 'enter', 'join', 'help', 'points', 'unicorns', 'jar', 'sashimi', 'sr', 'song', 'time', 'signup', 'need', 'dex', 'event', 'hide', 'burger', 'burgers', 'beanburger', 'flow', 'flowtree', 'flowtrees'];
const SASHI_RESERVED = new Set(['leave', 'here', 'checkin', 'signin', 'party', 'show', 'team', 'vote', 'unvote', 'signup', 'need', 'dex', 'event', 'hide', 'burger', 'burgers', 'beanburger', 'flow', 'flowtree', 'flowtrees']);
const sashiGameKey = g => (mDomainValidation.cleanString(g).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'palia').slice(0, 30);
// World clocks she can tick on the dashboard (shared by all events).
const SASHI_ZONE_PRESETS = [
  { label: 'Hawaii', tz: 'Pacific/Honolulu' }, { label: 'Alaska', tz: 'America/Anchorage' }, { label: 'Pacific', tz: 'America/Los_Angeles' },
  { label: 'Arizona', tz: 'America/Phoenix' }, { label: 'Mountain', tz: 'America/Denver' }, { label: 'Central', tz: 'America/Chicago' },
  { label: 'Eastern', tz: 'America/New_York' }, { label: 'Brazil', tz: 'America/Sao_Paulo' }, { label: 'UK', tz: 'Europe/London' },
  { label: 'Central Europe', tz: 'Europe/Berlin' }, { label: 'Eastern Europe', tz: 'Europe/Athens' }, { label: 'India', tz: 'Asia/Kolkata' },
  { label: 'Philippines', tz: 'Asia/Manila' }, { label: 'Japan', tz: 'Asia/Tokyo' }, { label: 'Sydney', tz: 'Australia/Sydney' }, { label: 'New Zealand', tz: 'Pacific/Auckland' }];
const SASHI_ZONE_DEFAULT_ON = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];
/** Create independent initial Poke Bowl signup settings for first-run or missing saved fields. */
function sashiDefaults() {
  return { visible: true, open: true, live: 'e1', seq: 2, font: 26, cols: 2, title: '🍣 Sashimi Sign-Up', max: 0, ignore: '',
    accent: '#ff8fd8', panelColor: '#1c0e28', panelOpacity: 85, showZones: true, showCountdown: true, names: {}, rseq: 1,
    zones: SASHI_ZONE_PRESETS.map(z => ({ ...z, on: SASHI_ZONE_DEFAULT_ON.includes(z.tz) })),
    events: [{ id: 'e1', name: 'Friday Sashimi', guests: [] }] };
}
/** Normalize saved guests and role definitions before a signup event is used. */
function sashiFixEvent(ev) {
  ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
  ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
  ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
  ev.date = typeof ev.date === 'string' ? ev.date : ''; ev.time = typeof ev.time === 'string' ? ev.time : '';
  ev.tz = mDomainTimezone.etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
  ev.game = mDomainValidation.cleanString(ev.game).slice(0, 30) || 'Palia';
  for (const g of ev.guests) if (typeof g.role !== 'string' || !ev.roles.some(r => r.id === g.role)) g.role = '';
  return ev;
}
/** Restore Poke Bowl signup state from disk and supply defaults for missing fields. */
function sashiLoad() {
  const raw = mStorage.readJson(SASHI_FILE, null) || {}; const s = { ...sashiDefaults(), ...raw };
  if (!Array.isArray(s.events) || !s.events.length) s.events = sashiDefaults().events;
  if (s.title === '🍣 Sashimi Sign-In') s.title = '🍣 Sashimi Sign-Up';
  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = sashiDefaults().zones;
  s.zones = s.zones.filter(z => z && mDomainTimezone.etValidTz(z.tz));
  s.names = s.names && typeof s.names === 'object' ? s.names : {};
  // 2026-10-12: names are kept per game. Older saves had one flat {twitch: name} list - that was Palia.
  if (Object.keys(s.names).some(k => typeof s.names[k] === 'string')) {
    const flat = s.names; s.names = { palia: {} };
    for (const k of Object.keys(flat)) if (typeof flat[k] === 'string') s.names.palia[k] = flat[k]; else s.names[k] = flat[k];
  }
  s.events.forEach(sashiFixEvent);
  return s;
}
let sashi = sashiLoad();
const sashiEv = id => sashi.events.find(e => e.id === (id || sashi.live)) || null;
const sashiRenumber = ev => { ev.guests.forEach((g, i) => { g.n = i + 1; }); };
const sashiEpoch = ev => (ev && ev.date && ev.time ? mDomainTimezone.etToEpoch(ev.date, ev.time, ev.tz) : null);
// "Hidden until chat asks" (2026-10-15): with sashi.onDemand on, the overlay stays invisible until chat types
// "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
let sashiShowUntil = 0;
let sashiChatHidden = false;   // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
/** Extend the signup display window without changing its guest list. */
function sashiReveal(sec) { sashiShowUntil = Date.now() + (sec || sashi.showSec || 30) * 1000; mEvents.broadcast('sashimi', sashiPublic()); }
/** Build the Poke Bowl signup response consumed by dashboards and overlays. */
function sashiPublic() {
  const ev = sashiEv();
  return { ok: true, visible: sashi.visible && !sashiChatHidden && (!sashi.onDemand || Date.now() < sashiShowUntil), visibleSetting: sashi.visible, chatHidden: sashiChatHidden, onDemand: !!sashi.onDemand,
    showSec: sashi.showSec || 30, showOnSignup: sashi.showOnSignup !== false, shownLeft: sashi.onDemand ? Math.max(0, Math.ceil((sashiShowUntil - Date.now()) / 1000)) : 0, open: sashi.open, title: sashi.title, font: sashi.font, cols: sashi.cols, max: sashi.max,
    accent: sashi.accent, panelColor: sashi.panelColor, panelOpacity: sashi.panelOpacity, showZones: sashi.showZones, showCountdown: sashi.showCountdown,
    zones: sashi.zones.filter(z => z.on).map(z => ({ label: z.label, tz: z.tz })),
    event: ev ? { id: ev.id, name: ev.name, game: ev.game, desc: ev.desc, date: ev.date, time: ev.time, tz: ev.tz, start: sashiEpoch(ev),
      roles: ev.roles.map(r => ({ id: r.id, label: r.label, cmd: r.cmd, spots: r.spots || 0, color: r.color || '' })),
      guests: ev.guests.map(g => ({ n: g.n, name: g.name, twitch: g.twitch || '', at: g.at || 0, role: g.role || '' })) } : null,
    total: ev ? ev.guests.length : 0, now: Date.now() };
}
/** Persist operator changes to the Poke Bowl signup state file. */
function sashiSave() { mStorage.writeJson(SASHI_FILE, sashi); mEvents.broadcast('sashimi', sashiPublic()); }
const sashiPop = () => { if (sashi.onDemand && sashi.showOnSignup !== false) sashiShowUntil = Math.max(sashiShowUntil, Date.now() + (sashi.showSec || 30) * 1000); };
const sashiCleanName = x => mDomainValidation.cleanString(x).replace(/^\s*\d+[.)\-:]\s+/, '').replace(/[<>]/g, '').trim().slice(0, 40);
const sashiCleanCmd = v => mDomainValidation.cleanString(v).toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
/** Add unique guest names, preserve the list limit, and renumber the resulting lineup. */
function sashiAddNames(ev, names, role) {
  role = ev.roles.some(r => r.id === role) ? role : '';
  for (const raw of names) {
    const name = sashiCleanName(raw);
    if (!name || ev.guests.some(g => g.name.toLowerCase() === name.toLowerCase()) || ev.guests.length >= 200) continue;
    ev.guests.push({ n: 0, name, twitch: '', at: Date.now(), role });
  }
  sashiRenumber(ev);
}
// Every command word some other feature uses right now, so "!tomato" is never mistaken for a Palia name.
function sashiIgnored() {
  const set = new Set(SASHI_BUILTIN_IGNORE);
  for (const w of String(sashi.ignore || '').split(/[\s,]+/)) { const c = w.toLowerCase().replace(/^!+/, ''); if (c) set.add(c); }
  try { for (const b of mParty.partyLiveBoards()) for (const r of b.ev.roles) if (r.command) { set.add(r.command); for (let i = 1; i <= 7; i++) set.add(r.command + i); } } catch (_e) {}
  for (const c of mSignupsCommands.signupRoleCmds()) set.add(c);
  try { [mTeams.teams.item.command].concat(mTeams.teams.item.aliases ? mTeams.teams.item.aliases.split(/,\s*/) : []).forEach(c => { if (c) set.add(String(c).toLowerCase()); }); } catch (_e) {}
  return set;
}
// Party-board role commands that are live right now (to warn her about clashes).
function sashiPartyCmds() { const set = new Set(); try { for (const b of mParty.partyLiveBoards()) for (const r of b.ev.roles) if (r.command) set.add(r.command); } catch (_e) {} return set; }
/** Resolve remembered viewer names for this event game without mixing different games. */
function sashiNames(ev) { const k = sashiGameKey(ev.game); return sashi.names[k] || (sashi.names[k] = {}); }
// Remember their in-game name for this event's game (also for names she fixes on the dashboard).
function sashiRemember(ev, twitch, name) { if (twitch && name) sashiNames(ev)[String(twitch).toLowerCase()] = name; }
// A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
function sashiChatName(v) {
  const name = String(v || '').replace(/^\[|\]$/g, '').replace(/[<>]/g, '').trim();
  if (name.length < 2 || name.length > 32 || !/[a-z]/i.test(name) || name.split(' ').length > 3 || /@|https?:|www\./i.test(name)) return '';
  return name;
}
/** Interpret supported Poke Bowl signup chat commands while preserving unrelated messages. */
function sashiChat(sender, parts) {
  const twitch = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
  if (!twitch) return '';
  const text = mParty.partyDecode((parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ')).trim().replace(/\s+/g, ' ');
  const ev = sashiEv(); if (!ev) return '';
  const key = twitch.toLowerCase();
  // "!show" / "!event" pops the sign-up on screen when it's set to "hidden until chat asks".
  if (/^!(show|event)$/i.test(text)) { if (sashi.onDemand && sashi.visible) { sashiReveal(); return 'Showing the event sign-up'; } return ''; }
  // "!leave" takes their own name off the list (2026-10-11). Works even when sign-ups are closed.
  // (Party Sign-ups also hears !leave - that's fine, each only removes its own entries.)
  if (/^!leave$/i.test(text)) {
    const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
    if (!mine) return '';
    ev.guests = ev.guests.filter(g => g !== mine); sashiRenumber(ev); sashiSave();
    return `${mine.name} left`;
  }
  const mine = ev.guests.find(g => g.twitch && g.twitch.toLowerCase() === key);
  // ----- events WITH roles: "!<role command> [Palia name]" -----
  if (ev.roles.length) {
    const m = /^!([a-z0-9_]+)(?: (.+))?$/i.exec(text);
    if (!m) return '';
    const role = ev.roles.find(r => r.cmd === m[1].toLowerCase());
    if (!role) return '';
    if (!sashi.open) return `${twitch}: sign-ups are closed`;
    let name = m[2] ? sashiChatName(m[2]) : '';
    if (m[2] && !name) return '';
    if (!name) name = (mine && mine.name) || sashiNames(ev)[key] || twitch;
    const taken = ev.guests.find(g => g.name.toLowerCase() === name.toLowerCase() && g !== mine);
    if (taken) return `${name} is already signed up`;
    sashiRemember(ev, twitch, name);
    if (mine) {
      const moved = mine.role !== role.id;
      mine.name = name;
      if (moved) { mine.role = role.id; mine.at = Date.now(); ev.guests = ev.guests.filter(g => g !== mine).concat([mine]); sashiRenumber(ev); }
      sashiPop(); sashiSave(); return moved ? `${name} switched to ${role.label}` : `${name} updated`;
    }
    if (sashi.max && ev.guests.length >= sashi.max) return `Event is full (${sashi.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: role.id });
    sashiPop(); sashiSave();
    const pos = ev.guests.filter(g => g.role === role.id).length;
    return role.spots && pos > role.spots ? `${name} is on the ${role.label} waitlist (#${pos - role.spots})` : `${name} signed up for ${role.label}`;
  }
  // ----- events WITHOUT roles: "!Palia Name" (2026-10-10 / -11 rules) -----
  if (!sashi.open) return '';
  // "!signup" alone = use the name we remember for this game (from their first sign-up).
  if (/^!signup$/i.test(text)) {
    const known = sashiNames(ev)[key];
    if (!known) return `${twitch}: type ! + your ${ev.game} name the first time`;
    if (mine) return '';
    if (ev.guests.some(g => g.name.toLowerCase() === known.toLowerCase())) return `${known} is already signed up`;
    if (sashi.max && ev.guests.length >= sashi.max) return `Event is full (${sashi.max})`;
    ev.guests.push({ n: ev.guests.length + 1, name: known, twitch, at: Date.now(), role: '' });
    sashiPop(); sashiSave(); return `${known} signed up (#${ev.guests.length})`;
  }
  const m = /^!([^\s!][^!]{0,31})$/.exec(text);
  if (!m) return '';
  const name = sashiChatName(m[1]);
  if (!name) return '';
  const low = name.toLowerCase(), first = low.split(' ')[0];
  // The first word decides whether it's another command ("!vote 2", "!tomato Kitsuu", "!hug Bob").
  const ign = sashiIgnored();
  if (ign.has(first) || ign.has(low) || /^(leave|party|show|here)\d*$/.test(first)) return '';
  const taken = ev.guests.find(g => g.name.toLowerCase() === low);
  if (taken) return taken.twitch.toLowerCase() === key ? '' : `${name} is already signed up`;
  sashiRemember(ev, twitch, name);
  if (mine) { mine.name = name; sashiPop(); sashiSave(); return `${twitch} changed their name to ${name} (#${mine.n})`; }
  if (sashi.max && ev.guests.length >= sashi.max) return `Event is full (${sashi.max})`;
  ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: '' });
  sashiPop(); sashiSave(); return `${name} signed up (#${ev.guests.length})`;
}
/** Validate and dispatch Poke Bowl signup API requests, returning client errors for invalid input. */
async function handleSashiApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/sashimi' && method === 'GET') return mHttpResponse.sendJson(res, 200, sashiPublic());
    if (pathname === '/api/sashimi/admin' && method === 'GET') {
      const ev = sashiEv(), pc = new Set([...sashiPartyCmds(), ...mSignupsCommands.signupRoleCmds('sashi')]);
      return mHttpResponse.sendJson(res, 200, { ...sashiPublic(), visible: sashi.visible, live: sashi.live, ignore: sashi.ignore, builtinIgnore: SASHI_BUILTIN_IGNORE, allZones: sashi.zones,
        clashes: ev ? ev.roles.filter(r => pc.has(r.cmd)).map(r => r.cmd) : [],
        remembered: ev ? Object.entries(sashi.names[sashiGameKey(ev.game)] || {}).map(([twitch, name]) => ({ twitch, name })) : [],
        games: Array.from(new Set(sashi.events.map(e => e.game).concat(['Palia', 'Aniimo']))),
        events: sashi.events.map(e => ({ id: e.id, name: e.name, count: e.guests.length })) });
    }
    if (pathname === '/api/sashimi' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      for (const k of ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup']) if (typeof b[k] === 'boolean') sashi[k] = b[k];
      if (b.showSec !== undefined) sashi.showSec = Math.max(5, Math.min(600, Math.round(Number(b.showSec)) || 30));
      if (b.showNow) { sashiChatHidden = false; sashiShowUntil = Date.now() + (sashi.showSec || 30) * 1000; }
      if (b.hideNow) { sashiShowUntil = 0; sashiChatHidden = true; }
      if (typeof b.title === 'string') sashi.title = mDomainValidation.cleanString(b.title).slice(0, 60);
      if (typeof b.ignore === 'string') sashi.ignore = mDomainValidation.cleanString(b.ignore).slice(0, 500);
      if (b.font !== undefined) sashi.font = Math.max(12, Math.min(70, Math.round(Number(b.font)) || 26));
      if (b.cols !== undefined) sashi.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
      if (b.max !== undefined) sashi.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
      if (b.panelOpacity !== undefined) sashi.panelOpacity = Math.max(0, Math.min(100, Math.round(Number(b.panelOpacity)) || 0));
      for (const k of ['accent', 'panelColor']) if (b[k] !== undefined && mNews.newsHex(b[k])) sashi[k] = b[k];
      // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
      if (Array.isArray(b.zones)) {
        sashi.zones = b.zones.slice(0, 24).filter(z => z && mDomainTimezone.etValidTz(z.tz)).map(z => ({ tz: String(z.tz), label: mDomainValidation.cleanString(z.label).slice(0, 24) || String(z.tz).split('/').pop().replace(/_/g, ' '), on: !!z.on }));
      }
      if (b.newEvent) { const id = `e${sashi.seq++}`; sashi.events.push(sashiFixEvent({ id, name: mDomainValidation.cleanString(b.newEvent).slice(0, 60) || 'Event', guests: [] })); sashi.live = id; }
      if (b.copyEvent) { // duplicate an event's details + roles (empty list) - handy for weekly repeats
        const src = sashiEv(String(b.copyEvent));
        if (src) { const id = `e${sashi.seq++}`; sashi.events.push(sashiFixEvent({ id, name: (src.name + ' (copy)').slice(0, 60), desc: src.desc, date: src.date, time: src.time, tz: src.tz, roles: JSON.parse(JSON.stringify(src.roles)), guests: [] })); sashi.live = id; }
      }
      if (b.live && sashiEv(String(b.live))) sashi.live = String(b.live);
      const ev = sashiEv(b.event ? String(b.event) : null);
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
            const cmd = sashiCleanCmd(r && r.cmd), label = mDomainValidation.cleanString(r && r.label).slice(0, 40);
            if (!cmd || !label || used.has(cmd) || SASHI_RESERVED.has(cmd)) continue;
            used.add(cmd);
            const old = r.id && ev.roles.find(x => x.id === String(r.id));
            out.push({ id: old ? old.id : `r${sashi.rseq++}`, label, cmd, spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)), color: mNews.newsHex(r.color) || '' });
          }
          ev.roles = out; sashiFixEvent(ev);
        }
        if (Array.isArray(b.add)) sashiAddNames(ev, b.add, b.addRole);
        if (b.remove !== undefined) { ev.guests = ev.guests.filter(g => g.n !== Number(b.remove)); sashiRenumber(ev); }
        if (b.move && b.move.n) { const i = ev.guests.findIndex(g => g.n === Number(b.move.n)), j = i + (Number(b.move.dir) < 0 ? -1 : 1);
          if (i >= 0 && j >= 0 && j < ev.guests.length) { const t = ev.guests[i]; ev.guests[i] = ev.guests[j]; ev.guests[j] = t; sashiRenumber(ev); } }
        if (b.rename && b.rename.n) { const g = ev.guests.find(x => x.n === Number(b.rename.n)); const nn = sashiCleanName(b.rename.name); if (g && nn) { g.name = nn; sashiRemember(ev, g.twitch, nn); } }
        if (b.setRole && b.setRole.n) { const g = ev.guests.find(x => x.n === Number(b.setRole.n)); if (g) g.role = ev.roles.some(r => r.id === b.setRole.role) ? b.setRole.role : ''; }
        if (b.clear) ev.guests = [];
      }
      if (b.forget && b.forget.game && b.forget.twitch) { const m = sashi.names[sashiGameKey(b.forget.game)]; if (m) delete m[String(b.forget.twitch).toLowerCase()]; }
      if (b.deleteEvent && sashi.events.length > 1) {
        sashi.events = sashi.events.filter(e => e.id !== String(b.deleteEvent));
        if (!sashiEv()) sashi.live = sashi.events[0].id;
      }
      sashiSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/sashimi/test' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      return mHttpResponse.sendJson(res, 200, { ok: true, reply: sashiChat(mDomainValidation.cleanString(b.name) || 'TestViewer', [{ t: 'text', v: mDomainValidation.cleanString(b.text) }]) || 'ignored' });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown sashimi route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Event sign-up request failed.' });
  }
}


Object.assign(exports, { SASHI_BUILTIN_IGNORE, sashiGameKey, SASHI_FILE, SASHI_RESERVED, sashiPublic, sashiEv, sashiChat, handleSashiApi });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
  sashi: { enumerable: true, get: () => sashi, set: value => { sashi = value; } },
  sashiChatHidden: { enumerable: true, get: () => sashiChatHidden, set: value => { sashiChatHidden = value; } },
  sashiShowUntil: { enumerable: true, get: () => sashiShowUntil, set: value => { sashiShowUntil = value; } },
});
