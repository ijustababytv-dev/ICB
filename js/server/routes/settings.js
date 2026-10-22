'use strict';

const mHttpResponse = require('../http/response');
const mRandomizer = require('../randomizer');
const mHttpBody = require('../http/body');
const mDomainRandomizer = require('../domain/randomizer');
const mStorage = require('../storage');
const mState = require('../state');
const mEvents = require('../events');
const mDomainValidation = require('../domain/validation');

/** Handle settings requests; reject unmatched paths. */
async function handleSettingsApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/api/randomizer' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, ...mRandomizer.randomizer });
  if (pathname === '/api/randomizer' && ['PUT', 'POST'].includes(method)) {
    const body = await mHttpBody.readBody(req);
    const next = mDomainRandomizer.randomizerClean(body);
    if (!next.games.length) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Keep at least one game.' });
    mRandomizer.randomizer = next;
    mStorage.writeJson(mRandomizer.RANDOMIZER_FILE, mRandomizer.randomizer);
    return mHttpResponse.sendJson(res, 200, { ok: true, ...mRandomizer.randomizer });
  }

  if (pathname === '/api/layout' && ['PUT', 'POST', 'PATCH'].includes(method)) {
    const body = await mHttpBody.readBody(req);
    // 2026-10-01: also carries the Tracker Command Center's card order
    // (trackerOrder) and the cards Baby removed from the dashboard
    // (trackerHidden). Each field is optional so the panel arrows and the
    // tracker drag/remove can save independently. Removing a card only hides
    // it on the dashboard - its config, count and Meld page are untouched.
    const keys = list => list.filter(key => typeof key === 'string' && key).map(key => key.slice(0, 60)).slice(0, 200);
    const next = {};
    if (Array.isArray(body.panelOrder)) next.panelOrder = keys(body.panelOrder).slice(0, 50);
    if (Array.isArray(body.trackerOrder)) next.trackerOrder = keys(body.trackerOrder);
    if (Array.isArray(body.trackerHidden)) next.trackerHidden = keys(body.trackerHidden);
    if (!Object.keys(next).length) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Send panelOrder, trackerOrder or trackerHidden as an array.' });
    mState.settings = mStorage.mergeDefaults(mState.settings, { layout: next });
    mState.saveSettings();
    mEvents.broadcast('settings', mStorage.clone(mState.settings));
    return mHttpResponse.sendJson(res, 200, { ok: true, settings: mStorage.clone(mState.settings) });
  }

  // Ticker banner text + speed/pause (control.html only). A separate small endpoint, same idea as
  // /api/layout - she can update these any time without it getting tangled up with the bigger
  // "Save settings" form. Every field is optional so the dashboard can send just the ones on its
  // form without clobbering the others.
  if (pathname === '/api/ticker' && ['PUT', 'POST', 'PATCH'].includes(method)) {
    const body = await mHttpBody.readBody(req);
    const next = {};
    if (body.text !== undefined) {
      const text = mDomainValidation.cleanString(body.text);
      if (!text) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'The ticker needs some text.' });
      next.text = text.slice(0, 300);
    }
    if (body.speed !== undefined) {
      const speed = Math.round(Number(body.speed));
      if (!Number.isFinite(speed) || speed < 10 || speed > 500) {
        return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Speed must be between 10 and 500 (pixels per second).' });
      }
      next.speed = speed;
    }
    if (body.pause !== undefined) {
      const pause = Number(body.pause);
      if (!Number.isFinite(pause) || pause < 0 || pause > 30) {
        return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Pause must be between 0 and 30 seconds.' });
      }
      next.pause = Math.round(pause * 10) / 10;
    }
    if (!Object.keys(next).length) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Nothing to save.' });
    mState.settings = mStorage.mergeDefaults(mState.settings, { ticker: next });
    mState.saveSettings();
    mEvents.broadcast('settings', mStorage.clone(mState.settings));
    return mHttpResponse.sendJson(res, 200, { ok: true, settings: mStorage.clone(mState.settings) });
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleSettingsApi });
