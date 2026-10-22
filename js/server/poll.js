'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');
const mDomainValidation = require('./domain/validation');
const mEvents = require('./events');
const mGiveawayState = require('./giveaway/state');
const mWalkers = require('./walkers');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mTradeup = require('./tradeup');

// ---------------------------------------------------------------------------
// BADGE VOTE (Baby, 2026-10-03) - post badge pictures, chat votes with
// "!vote 2" (several numbers allowed: "!vote 1 3"), "!unvote 2" takes one back.
// Each person can vote for several badges, once each. Subscribers' votes count
// double. Results can be shown or hidden on stream from the dashboard.
//   - Overlay:   /poll.html      - Dashboard: /poll-control.html
//   - Art:       assets/poll/    - Saved in data/poll.json
// ---------------------------------------------------------------------------
const POLL_FILE = path.join(mConfig.DATA_DIR, 'poll.json');
const POLL_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'poll');
try { fs.mkdirSync(POLL_ART_DIR, { recursive: true }); } catch (_error) {}
/** Create independent initial poll settings for first-run or missing saved fields. */
function pollDefaults() {
  return { title: 'Vote for the badges you want to earn!', options: [], open: false, showResults: false, endsAt: null,
    subWeight: 2, revealed: false, votes: {}, seq: 1 };
}
/** Restore poll state from disk and supply defaults for missing fields. */
function pollLoad() {
  const raw = mStorage.readJson(POLL_FILE, null) || {};
  const p = { ...pollDefaults(), ...raw };
  p.options = (Array.isArray(p.options) ? p.options : []).filter(o => o && o.id).map(o => ({ id: String(o.id).slice(0, 20), label: mDomainValidation.cleanString(o.label).slice(0, 60), image: o.image ? path.basename(String(o.image)) : null }));
  p.votes = p.votes && typeof p.votes === 'object' ? p.votes : {};
  p.subWeight = [1, 2, 3].includes(Number(p.subWeight)) ? Number(p.subWeight) : 2;
  return p;
}
let poll = pollLoad();
/** Persist operator changes to the poll state file. */
function pollSave() { mStorage.writeJson(POLL_FILE, poll); mEvents.broadcast('poll', pollPublic()); }
/** Accept votes only while the poll is open and its optional deadline has not passed. */
function pollIsOpen() { return poll.open && (!poll.endsAt || Date.now() < poll.endsAt); }
/** Aggregate current votes into per-option totals for the results display. */
function pollResults() {
  const rows = poll.options.map((o, i) => ({ id: o.id, number: i + 1, label: o.label, image: o.image ? `/assets/poll/${encodeURIComponent(o.image)}` : null, points: 0, voters: 0, subVoters: 0 }));
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const v of Object.values(poll.votes)) {
    for (const id of v.picks || []) {
      const r = byId.get(id); if (!r) continue;
      r.voters += 1; if (v.sub) r.subVoters += 1;
      r.points += v.sub ? poll.subWeight : 1;
    }
  }
  const total = rows.reduce((a, r) => a + r.points, 0);
  const max = rows.reduce((a, r) => Math.max(a, r.points), 0);
  for (const r of rows) { r.percent = total ? Math.round(r.points / total * 100) : 0; r.leading = max > 0 && r.points === max; }
  return { rows, total, people: Object.keys(poll.votes).length };
}
/** Build the poll response consumed by dashboards and overlays. */
function pollPublic() {
  const res = pollResults();
  return { ok: true, title: poll.title, open: pollIsOpen(), openFlag: poll.open, endsAt: poll.endsAt, now: Date.now(), showResults: poll.showResults, revealed: poll.revealed,
    subWeight: poll.subWeight, ...res };
}
/** Apply vote/unvote commands once per eligible chatter while the poll accepts votes. */
function pollChat(name, parts) {
  if (!pollIsOpen()) return false;
  name = mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
  if (!name || mGiveawayState.isBlocked(name)) return false;
  const text = (parts || []).filter(x => x.t === 'text').map(x => x.v).join(' ').trim();
  const m = /^!(un)?vote\b(.*)$/i.exec(text);
  if (!m) return false;
  const nums = (m[2].match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= poll.options.length).slice(0, 20);
  if (!nums.length) return false;
  const key = name.toLowerCase();
  const v = poll.votes[key] || (poll.votes[key] = { name, picks: [], sub: false, at: 0 });
  v.name = name; v.sub = mWalkers.walkerIsSub(name); v.at = Date.now();
  for (const n of nums) {
    const id = poll.options[n - 1].id;
    if (m[1]) v.picks = v.picks.filter(x => x !== id);
    else if (!v.picks.includes(id)) v.picks.push(id);
  }
  if (!v.picks.length) delete poll.votes[key];
  pollSave();
  return true;
}
/** Validate and dispatch poll API requests, returning client errors for invalid input. */
async function handlePollApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/poll' && method === 'GET') return mHttpResponse.sendJson(res, 200, pollPublic());
    if (pathname === '/api/poll/admin' && method === 'GET') {
      const voters = Object.values(poll.votes).map(v => ({ name: v.name, sub: v.sub, picks: v.picks.map(id => poll.options.findIndex(o => o.id === id) + 1).filter(n => n > 0) })).sort((a, b) => a.name.localeCompare(b.name));
      const art = (() => { try { return fs.readdirSync(POLL_ART_DIR).filter(f => mDomainValidation.DECOR_IMAGE_EXT.test(f)).sort(); } catch (_e) { return []; } })();
      return mHttpResponse.sendJson(res, 200, { ...pollPublic(), options: poll.options, voters, art });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await mHttpBody.readBody(req) : {};
    if (pathname === '/api/poll/settings' && method !== 'GET') {
      if (typeof body.title === 'string') poll.title = mDomainValidation.cleanString(body.title).slice(0, 120);
      if (typeof body.showResults === 'boolean') poll.showResults = body.showResults;
      if ([1, 2, 3].includes(Number(body.subWeight))) poll.subWeight = Number(body.subWeight);
      pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Badges: { options: [{id?, label, image}] } replaces the list (order = vote numbers).
    if (pathname === '/api/poll/options' && method !== 'GET') {
      if (!Array.isArray(body.options)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'options must be a list.' });
      const next = [];
      for (const o of body.options.slice(0, 30)) {
        if (!o) continue;
        const image = o.image ? path.basename(String(o.image)) : null;
        const id = (o.id && /^[a-z0-9]{1,20}$/i.test(String(o.id))) ? String(o.id) : `b${poll.seq++}`;
        next.push({ id, label: mDomainValidation.cleanString(o.label).slice(0, 60), image: image && fs.existsSync(path.join(POLL_ART_DIR, image)) ? image : null });
      }
      poll.options = next;
      const ids = new Set(next.map(o => o.id));
      for (const [k, v] of Object.entries(poll.votes)) { v.picks = (v.picks || []).filter(id => ids.has(id)); if (!v.picks.length) delete poll.votes[k]; }
      pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Upload a badge picture: { dataUrl, name } -> adds a new badge with it.
    if (pathname === '/api/poll/image' && method === 'POST') {
      const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ''));
      if (!match) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image must be a PNG, JPG, WEBP, or GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Image is too large (max 8MB).' });
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base = mTradeup.tradeupSlug(String(body.name || 'badge').replace(/\.[a-z0-9]+$/i, ''));
      let filename = `${base}.${ext}`, n = 2;
      while (fs.existsSync(path.join(POLL_ART_DIR, filename))) filename = `${base}-${n++}.${ext}`;
      fs.writeFileSync(path.join(POLL_ART_DIR, filename), buffer);
      if (body.addBadge !== false && poll.options.length < 30) {
        const label = mDomainValidation.cleanString(body.label || String(body.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')).slice(0, 60);
        poll.options.push({ id: `b${poll.seq++}`, label, image: filename });
      }
      pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true, file: filename });
    }
    // Open voting: { minutes } (0 or missing = no timer). Close: stops counting.
    if (pathname === '/api/poll/open' && method === 'POST') {
      if (!poll.options.length) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Add at least one badge first.' });
      const minutes = Number(body.minutes);
      poll.open = true; poll.revealed = false;
      poll.endsAt = Number.isFinite(minutes) && minutes > 0 ? Date.now() + Math.min(240, minutes) * 60000 : null;
      pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/poll/close' && method === 'POST') { poll.open = false; poll.endsAt = null; pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true }); }
    if (pathname === '/api/poll/reveal' && method === 'POST') { poll.revealed = body.revealed !== false; if (poll.revealed) { poll.open = false; poll.endsAt = null; poll.showResults = true; } pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true }); }
    if (pathname === '/api/poll/reset' && method === 'POST') { poll.votes = {}; poll.revealed = false; pollSave(); return mHttpResponse.sendJson(res, 200, { ok: true }); }
    // Test vote from the dashboard: { name, text }
    if (pathname === '/api/poll/test' && method === 'POST') {
      const ok = pollChat(mDomainValidation.cleanString(body.name) || 'TestViewer', [{ t: 'text', v: mDomainValidation.cleanString(body.text) || '!vote 1' }]);
      return mHttpResponse.sendJson(res, 200, { ok: true, counted: ok });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown poll route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Poll request failed.' });
  }
}
// The timer runs out even if nobody votes: tell the overlay/dashboard once.
/** Close timed polls once their deadline is reached. */
function expirePoll() { if (poll.open && poll.endsAt && Date.now() >= poll.endsAt) { poll.open = false; poll.endsAt = null; pollSave(); } }

Object.assign(exports, { pollChat, handlePollApi });

exports.expirePoll = expirePoll;
