'use strict';

const { URL } = require('node:url');
const mEvents = require('./events');
const mGiveawayBackups = require('./giveaway/backups');
const mGiveawayState = require('./giveaway/state');
const mWalkers = require('./walkers');
const mState = require('./state');
const mConfig = require('./config');
const mStorage = require('./storage');
const mHttpResponse = require('./http/response');

// ---------------------------------------------------------------------------
// CONNECTION CHECK (Baby, 2026-09-30) - powers the "Connection check" card on
// ICB Home so she can see at a glance what is and isn't talking to ICB, and
// fix it without help. Everything here is in memory only (resets on restart).
//   - pages: every ICB page that calls /api/* or opens /events, keyed by the
//     page's own address (from the browser's Referer header), with when it
//     was last heard from and how many live /events connections it has.
//     Meld browser layers show up here the same as Chrome tabs do.
//   - relay: the last raw Firehose event / last chat message the Meld
//     listener passed on, and Meld's own per-platform connection states
//     (CONNECTION_STATE events) and live/offline (STREAM_STATUS events).
//   - listenerReload: set by the "Reload the listener" button; handed to the
//     listener in its next heartbeat reply, and the listener reloads itself.
// ---------------------------------------------------------------------------
const health = {
  pages: {},
  lastRawAt: null, lastRawKind: null, rawSinceStart: 0,
  lastChatAt: null, lastChatFrom: null, chatSinceStart: 0,
  meldConnections: {}, meldConnectionsAt: null,
  streamLive: null, streamLiveAt: null,
  listenerReload: false, listenerReloadAskedAt: null,
};

/** Record the page behind a request so connection diagnostics can identify active clients. */
function healthNotePage(req) {
  const ref = req.headers.referer || req.headers.referrer;
  if (!ref) return null;
  let page;
  try {
    const u = new URL(ref);
    if (!/^(127\.0\.0\.1|localhost)$/i.test(u.hostname)) return null;
    page = u.pathname === '/' ? '/hub.html' : u.pathname;
  } catch (_error) { return null; }
  page = page.slice(0, 120);
  const entry = health.pages[page] || (health.pages[page] = { firstSeen: new Date().toISOString(), lastSeen: null, agent: '' });
  entry.lastSeen = new Date().toISOString();
  entry.agent = String(req.headers['user-agent'] || '').slice(0, 200);
  const keys = Object.keys(health.pages);
  if (keys.length > 80) {
    keys.sort((a, b) => (health.pages[a].lastSeen < health.pages[b].lastSeen ? -1 : 1));
    delete health.pages[keys[0]];
  }
  return page;
}

/** Retain recent relay activity and connection observations for diagnostics. */
function healthNoteRaw(kind, data) {
  const now = new Date().toISOString();
  health.lastRawAt = now;
  health.lastRawKind = kind;
  health.rawSinceStart += 1;
  if (!data || typeof data !== 'object') return;
  if (kind === 'chat') {
    health.lastChatAt = now;
    health.lastChatFrom = typeof data.sender === 'string' ? data.sender.slice(0, 60) : null;
    health.chatSinceStart += 1;
  } else if (kind === 'connection' && data.states && typeof data.states === 'object') {
    // Meld sends partial lists (one platform group at a time), so merge.
    for (const [name, state] of Object.entries(data.states)) {
      if (typeof state === 'string') health.meldConnections[String(name).slice(0, 60)] = { state: state.slice(0, 30), at: now };
    }
    health.meldConnectionsAt = now;
  } else if (kind === 'stream_status' && typeof data.is_live === 'boolean') {
    health.streamLive = data.is_live; health.streamLiveAt = now;
  } else if (kind === 'meld.stream_status' && typeof data.is_streaming === 'boolean') {
    health.streamLive = data.is_streaming; health.streamLiveAt = now;
  }
}

const meldRequestLog = [];
/** Combine server, relay, tracker, and giveaway health without changing live progress. */
function healthReport() {
  const openByPage = {};
  for (const client of mEvents.clients) {
    if (client.icbPage) openByPage[client.icbPage] = (openByPage[client.icbPage] || 0) + 1;
  }
  const pages = Object.entries(health.pages).map(([page, e]) => ({ page, lastSeen: e.lastSeen, firstSeen: e.firstSeen, open: openByPage[page] || 0, agent: e.agent }))
    .sort((a, b) => (a.page < b.page ? -1 : 1));
  let latestBackup = null;
  try { latestBackup = (mGiveawayBackups.listGiveawayBackups()[0] || null); } catch (_error) {}
  let people = 0, winners = 0;
  try { people = Object.keys(mGiveawayState.giveaway.entrants || {}).length; winners = (mGiveawayState.giveaway.winners || []).length; } catch (_error) {}
  let walkerInfo = null;
  try { walkerInfo = { enabled: mWalkers.walkers.settings ? mWalkers.walkers.settings.enabled !== false : null, showChat: mWalkers.walkers.settings ? mWalkers.walkers.settings.showChat !== false : null, people: Object.keys(mWalkers.walkers.people || {}).length }; } catch (_error) {}
  return {
    meldRequests: meldRequestLog.slice(0, 40),
    ok: true,
    now: new Date().toISOString(),
    server: { startedAt: new Date(mState.startedAt).toISOString(), uptimeSeconds: Math.floor((Date.now() - mState.startedAt) / 1000), port: mConfig.PORT, folder: mConfig.APP_DIR, node: process.version },
    listener: { ...mGiveawayState.listenerStatus, reloadPending: health.listenerReload, reloadAskedAt: health.listenerReloadAskedAt },
    relay: { lastRawAt: health.lastRawAt, lastRawKind: health.lastRawKind, rawSinceStart: health.rawSinceStart, lastChatAt: health.lastChatAt, lastChatFrom: health.lastChatFrom, chatSinceStart: health.chatSinceStart },
    meld: { connections: health.meldConnections, connectionsAt: health.meldConnectionsAt, live: health.streamLive, liveAt: health.streamLiveAt },
    pages,
    palia: mStorage.clone(mState.live.reader),
    giveaway: { people, winners, latestBackup },
    walkers: walkerInfo,
  };
}

/** Validate and dispatch health API requests, returning client errors for invalid input. */
async function handleHealthApi(req, res, pathname, method) {
  if (pathname === '/api/connection-check' && method === 'GET') return mHttpResponse.sendJson(res, 200, healthReport());
  if (pathname === '/api/connection-check/reload-listener' && method === 'POST') {
    health.listenerReload = true;
    health.listenerReloadAskedAt = new Date().toISOString();
    return mHttpResponse.sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/connection-check/forget-pages' && method === 'POST') {
    health.pages = {};
    return mHttpResponse.sendJson(res, 200, { ok: true });
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}

Object.assign(exports, { meldRequestLog, healthNotePage, healthNoteRaw, health, handleHealthApi });
