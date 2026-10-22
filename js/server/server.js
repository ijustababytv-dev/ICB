'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const mConfig = require('./config');
const mHealth = require('./health');
const mEvents = require('./events');
const mState = require('./state');
const mTradeup = require('./tradeup');
const mGiveawayState = require('./giveaway/state');
const mDecor = require('./decor');
const mHub = require('./hub');
const mHttpApi = require('./http/api');
const mResources = require('./resources');
const mOverlayDiagnostics = require('./overlay-diagnostics');
const mViewsWeekly = require('./views/weekly');
const mViewsTicker = require('./views/ticker');
const mViewsResource = require('./views/resource');
const mHttpResponse = require('./http/response');
const mHttpStatic = require('./http/static');
const mReader = require('./reader');
const mWeekly = require('./weekly');
const backups = require('./giveaway/backups');
const signupCommands = require('./signups/commands');

backups.connectGiveaway(() => mGiveawayState.giveaway);
signupCommands.connectSignups(require('./signups/poke'), require('./signups/burger'), require('./signups/flow'));
backups.runScheduledBackup();
const giveawayBackupTimer = setInterval(backups.runScheduledBackup, backups.BACKUP_EVERY_MS);
giveawayBackupTimer.unref();

const stopBackgroundJobs = require('./background').startBackgroundJobs();
require('./sprites').sprImportCheck();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${mConfig.HOST}:${mConfig.PORT}`}`);
  // 2026-09-30: every request from Meld's built-in browser, newest first, so
  // Connection check can show exactly which Meld layers are reaching ICB.
  if (/Meld\//.test(String(req.headers['user-agent'] || ''))) {
    mHealth.meldRequestLog.unshift({ at: new Date().toISOString(), method: req.method, path: url.pathname.slice(0, 80), referer: String(req.headers.referer || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 80) || null, origin: String(req.headers.origin || '').slice(0, 60) || null });
    while (mHealth.meldRequestLog.length > 60) mHealth.meldRequestLog.pop();
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const role = url.searchParams.get('role');
    res.icbRole = ['control', 'overlay'].includes(role) ? role : 'other';
    res.icbPage = mHealth.healthNotePage(req);
    mEvents.clients.add(res);
    mEvents.sendSse(res, 'snapshot', mState.publicState());
    mEvents.sendSse(res, 'tradeup', mTradeup.tradeupPublicState());
    mEvents.sendSse(res, 'giveaway', mGiveawayState.publicGiveaway());
    mEvents.sendSse(res, 'decor', mDecor.decorPublicState());
    mEvents.sendSse(res, 'hub', mHub.hubPublic());
    req.on('close', () => mEvents.clients.delete(res));
    return;
  }
  try {
    if (url.pathname.startsWith('/api/')) { if (url.pathname !== '/api/connection-check' && url.pathname !== '/api/health') mHealth.healthNotePage(req); return await mHttpApi.handleApi(req, res, url); }
    if (url.pathname.startsWith('/resource-art/')) return mResources.serveResourceArt(res, url.pathname);
    if (url.pathname.startsWith('/tradeup-art/')) return mTradeup.serveTradeupArt(res, url.pathname);
    if (url.pathname.startsWith('/decor-art/')) return mDecor.serveDecorArt(res, url.pathname);
    if (/^\/decor\/[a-z0-9-]+\.html$/.test(url.pathname)) return mDecor.serveDecorOverlay(res);
    if (url.pathname === '/weekly.html' || url.pathname === '/weekly-wide.html') {
      // Two addresses rather than a query string. Query strings are barred from
      // Meld URLs (see the handbook) - the one overlay that ever used them never
      // rendered, and although that was never proved to be the cause, a stream
      // is the wrong place to test the theory. A wide layout therefore gets its
      // own plain path.
      if (url.pathname === '/weekly-wide.html') {
        if (!url.searchParams.get('cols')) url.searchParams.set('cols', '2');
        if (!url.searchParams.get('w')) url.searchParams.set('w', '900');
      }
      mOverlayDiagnostics.noteOverlayRequest('page:weekly', req, url);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache', Expires: '0',
      });
      return res.end(mViewsWeekly.renderWeeklyPage(url.searchParams));
    }
    if (url.pathname === '/ticker.html') {
      mOverlayDiagnostics.noteOverlayRequest('page:ticker', req, url);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache', Expires: '0',
      });
      return res.end(mViewsTicker.renderTickerPage(url.searchParams));
    }
    {
      // Each resource card gets its own plain URL - /gold-ore.html - so a Meld
      // layer never needs a query string. Query strings are the one thing the
      // overlay that never worked had in common.
      const cardMatch = url.pathname.match(/^\/([a-z0-9-]+)\.html$/i);
      const card = cardMatch ? mResources.findResourceCard(cardMatch[1].toLowerCase()) : null;
      if (card) {
        mOverlayDiagnostics.noteOverlayRequest(`page:${card.id}`, req, url);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        });
        return res.end(mViewsResource.renderResourceCardPage(card, url.searchParams));
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return mHttpResponse.sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return mHttpStatic.serveStatic(res, url.pathname);
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Request failed.' });
  }
});

server.listen(mConfig.PORT, mConfig.HOST, () => {
  console.log(`ICB Clean ${mConfig.VERSION} listening at http://${mConfig.HOST}:${mConfig.PORT}`);
  mReader.scanLog();
});

// The week must roll over even on a quiet night with no log activity, and a
// server that was off across the boundary catches up on its next tick.
mWeekly.rolloverWeeklyIfDue();
const weeklyTimer = setInterval(() => { try { mWeekly.rolloverWeeklyIfDue(); } catch (_error) {} }, 60000);
weeklyTimer.unref();

const readerTimer = setInterval(mReader.scanLog, 1000);
readerTimer.unref();
const heartbeat = setInterval(() => {
  for (const client of mEvents.clients) {
    try { client.write(`: heartbeat ${Date.now()}\n\n`); } catch (_error) { mEvents.clients.delete(client); }
  }
}, 15000);
heartbeat.unref();

/** Stop timers and connected streams before closing the sole HTTP listener. */
function shutdown() {
  stopBackgroundJobs();
  clearInterval(giveawayBackupTimer);
  clearInterval(weeklyTimer);
  clearInterval(readerTimer);
  clearInterval(heartbeat);
  for (const client of mEvents.clients) client.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
