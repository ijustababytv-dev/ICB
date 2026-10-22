'use strict';

const mGiveawayBackups = require('../giveaway/backups');
const mGiveawayState = require('../giveaway/state');
const mGiveawayActivity = require('../giveaway/activity');
const mHttpResponse = require('../http/response');
const mHttpBody = require('../http/body');
const mEvents = require('../events');
const mHealth = require('../health');
const mDomainValidation = require('../domain/validation');
const mStorage = require('../storage');
const mGiveawayDefaults = require('../giveaway/defaults');

/** Handle giveaway requests; reject unmatched paths. */
async function handleGiveawayApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  // Empty the on-screen jar now (counts are untouched).
  if (pathname === '/api/giveaway/jar/empty' && method === 'POST') {
    mGiveawayBackups.backupGiveaway('before', 'empty-jar');
    mGiveawayState.snapshotJar();
    mGiveawayActivity.logActivity({ type: 'jar_emptied' });
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, jar: mGiveawayState.jarView() });
  }
  // Heartbeat from giveaway-listener.html every few seconds.
  if (pathname === '/api/giveaway/listener' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const wasConnected = mGiveawayState.listenerStatus.firehose === 'connected';
    mGiveawayState.listenerStatus.lastSeen = new Date().toISOString();
    mGiveawayState.listenerStatus.firehose = ['connected', 'connecting', 'no-sdk'].includes(body.firehose) ? body.firehose : 'unknown';
    if (wasConnected !== (mGiveawayState.listenerStatus.firehose === 'connected')) mEvents.broadcast('giveaway', mGiveawayState.publicGiveaway());
    if (typeof body.page === 'string') mGiveawayState.listenerStatus.page = body.page.slice(0, 200);
    const reload = mHealth.health.listenerReload;
    mHealth.health.listenerReload = false;
    return mHttpResponse.sendJson(res, 200, { ok: true, reload });
  }

  // Block list: never in the giveaway. Removes anyone already entered.
  if (pathname === '/api/giveaway/blocked' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    if (!Array.isArray(body.names)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'names must be a list.' });
    const seen = new Set();
    mGiveawayState.giveaway.blocked = body.names.map(n => mDomainValidation.cleanString(n).replace(/^@/, '')).filter(n => {
      if (!n || seen.has(n.toLowerCase())) return false;
      seen.add(n.toLowerCase()); return true;
    }).slice(0, 200);
    const removed = mGiveawayState.purgeBlocked();
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, blocked: mGiveawayState.giveaway.blocked, removed });
  }

  // Free-text info per viewer ("subbed since March", "tier 3", ...).
  if (pathname === '/api/giveaway/note' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const username = mDomainValidation.cleanString(body.username).replace(/^@/, '');
    if (!username) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'username is required.' });
    const entrant = mGiveawayState.ensureEntrant(username);
    entrant.note = mDomainValidation.cleanString(body.note).slice(0, 200);
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, entrant });
  }

  // How many fluffy unicorns each thing is worth. Re-prices everyone.
  if (pathname === '/api/giveaway/rates' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const r = mGiveawayState.giveaway.rates;
    if (body.chatWindow !== undefined) r.chatWindow = mGiveawayState.cleanRate(body.chatWindow, r.chatWindow, 0, 100);
    if (body.subMonth !== undefined) r.subMonth = mGiveawayState.cleanRate(body.subMonth, r.subMonth, 0, 100);
    if (body.giftedSub !== undefined) r.giftedSub = mGiveawayState.cleanRate(body.giftedSub, r.giftedSub, 0, 100);
    if (body.bitsPerUnicorn !== undefined) r.bitsPerUnicorn = mGiveawayState.cleanRate(body.bitsPerUnicorn, r.bitsPerUnicorn, 1, 100000);
    for (const key of Object.keys(mGiveawayState.giveaway.entrants)) mGiveawayState.recomputeEntrant(mGiveawayState.giveaway.entrants[key]);
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, rates: mStorage.clone(r) });
  }

  // Full reset for a new stream night. Manual only - no auto-reset.
  if (pathname === '/api/giveaway/reset' && method === 'POST') {
    mGiveawayBackups.backupGiveaway('before', 'reset-everything');
    mGiveawayActivity.logActivity({ type: 'reset' });
    const keptDisplay = mStorage.clone(mGiveawayState.giveaway.display);
    const keptRates = mStorage.clone(mGiveawayState.giveaway.rates);
    const keptBlocked = mStorage.clone(mGiveawayState.giveaway.blocked);
    mGiveawayState.giveaway = mStorage.clone(mGiveawayDefaults.GIVEAWAY_DEFAULTS);
    mGiveawayState.giveaway.display = keptDisplay; // wording is a setting, not tonight's data
    mGiveawayState.giveaway.rates = keptRates;
    mGiveawayState.giveaway.blocked = keptBlocked;
    mGiveawayState.giveaway.windowStartedAt = new Date().toISOString();
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true });
  }

  // Overlay wording, edited from the dashboard's "Board text" card.
  if (pathname === '/api/giveaway/display' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const d = mGiveawayState.giveaway.display;
    if (typeof body.entrantsTitle === 'string') d.entrantsTitle = mDomainValidation.cleanString(body.entrantsTitle);
    if (typeof body.emptyMessage === 'string') d.emptyMessage = mDomainValidation.cleanString(body.emptyMessage);
    if (typeof body.winnersTitle === 'string') d.winnersTitle = mDomainValidation.cleanString(body.winnersTitle);
    if (typeof body.winnersEmptyMessage === 'string') d.winnersEmptyMessage = mDomainValidation.cleanString(body.winnersEmptyMessage);
    if (body.maxRows !== undefined) {
      const n = Math.trunc(Number(body.maxRows));
      if (Number.isFinite(n)) d.maxRows = Math.min(50, Math.max(1, n));
    }
    if (['left', 'center', 'right'].includes(body.jarSide)) d.jarSide = body.jarSide;
    if (['small', 'medium', 'large'].includes(body.unicornSize)) d.unicornSize = body.unicornSize;
    if (typeof body.showNames === 'boolean') d.showNames = body.showNames;
    if (typeof body.magic === 'boolean') d.magic = body.magic;
    if (typeof body.currentPrizeLabel === 'string') d.currentPrizeLabel = mDomainValidation.cleanString(body.currentPrizeLabel).slice(0, 60);
    if (Array.isArray(body.tickerMessages)) {
      d.tickerMessages = body.tickerMessages.map(m => mDomainValidation.cleanString(m)).filter(Boolean).slice(0, 30);
    }
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, display: mStorage.clone(d) });
  }

  if (pathname === '/api/giveaway/display/reset' && method === 'POST') {
    mGiveawayState.giveaway.display = mStorage.clone(mGiveawayDefaults.GIVEAWAY_DEFAULTS.display);
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, display: mStorage.clone(mGiveawayState.giveaway.display) });
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleGiveawayApi });
