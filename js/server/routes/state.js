'use strict';

const mHttpResponse = require('../http/response');
const mState = require('../state');
const mStorage = require('../storage');
const mHttpBody = require('../http/body');
const mDomainResources = require('../domain/resources');
const mEvents = require('../events');
const mReader = require('../reader');
const mDomainValidation = require('../domain/validation');
const crypto = require('node:crypto');

/** Handle state requests; reject unmatched paths. */
async function handleStateApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/api/state' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, ...mState.publicState() });
  if (pathname === '/api/settings' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, settings: mStorage.clone(mState.settings) });
  if (pathname === '/api/live' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, live: mStorage.clone(mState.live) });
  if (pathname === '/api/actions' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, actions: mStorage.clone(mState.actions.slice(-50)) });

  if (pathname === '/api/live/reconcile' && ['PUT', 'POST'].includes(method)) {
    const body = await mHttpBody.readBody(req);
    const incoming = body.resources && typeof body.resources === 'object' ? body.resources : body;
    const resources = {};
    for (const resource of Object.keys(mDomainResources.RESOURCE_META)) {
      const value = Number(incoming[resource]);
      if (!Number.isFinite(value) || value < 0) return mHttpResponse.sendJson(res, 400, { ok: false, error: `A non-negative ${resource} total is required.` });
      resources[resource] = Math.trunc(value);
    }
    const now = new Date().toISOString();
    mState.live.resources = resources;
    mState.live.reconciliation = {
      ...mState.live.reconciliation,
      required: false,
      reconciledAt: now,
      reconciledBy: 'operator',
    };
    mState.live.reader.lastEvent = { at: now, source: 'operator-reconciliation', resources: mStorage.clone(resources) };
    mState.live.reader.lastUpdateAt = now;
    mState.saveLive();
    mEvents.broadcast('live', mStorage.clone(mState.live));
    mReader.forceRescan = true;
    mReader.scanLog();
    return mHttpResponse.sendJson(res, 200, { ok: true, live: mStorage.clone(mState.live) });
  }

  if (pathname === '/api/settings' && ['PUT', 'POST', 'PATCH'].includes(method)) {
    const body = await mHttpBody.readBody(req);
    const incoming = body.settings && typeof body.settings === 'object' ? body.settings : body;
    const incomingStatus = mDomainValidation.cleanString(incoming.countdown?.status);
    const incomingZones = Array.isArray(incoming.worldClock?.zones) ? incoming.worldClock.zones : [];
    const incomingZoneById = {};
    for (const z of incomingZones) { if (z && typeof z === 'object' && typeof z.id === 'string') incomingZoneById[z.id] = z; }
    mState.settings = mStorage.mergeDefaults(mState.settings, {
      countdown: {
        heading: mDomainValidation.cleanString(incoming.countdown?.heading, mState.settings.countdown.heading),
        subheading: mDomainValidation.cleanString(incoming.countdown?.subheading, mState.settings.countdown.subheading),
        targetAt: mDomainValidation.cleanString(incoming.countdown?.targetAt, mState.settings.countdown.targetAt),
        timezone: mDomainValidation.cleanString(incoming.countdown?.timezone, mState.settings.countdown.timezone),
        status: ['idle', 'running', 'timesup'].includes(incomingStatus) ? incomingStatus : mState.settings.countdown.status,
      },
      worldClock: {
        // Six fixed slots only - an id in the incoming body that doesn't already exist is
        // ignored, so this can edit but never add or remove a clock.
        zones: mState.settings.worldClock.zones.map(zone => {
          const patch = incomingZoneById[zone.id];
          if (!patch || typeof patch !== 'object') return zone;
          return {
            id: zone.id,
            label: mDomainValidation.cleanString(patch.label, zone.label),
            subLabel: mDomainValidation.cleanString(patch.subLabel, zone.subLabel),
            timezone: mDomainValidation.validTimezone(patch.timezone) ? patch.timezone : zone.timezone,
            visible: typeof patch.visible === 'boolean' ? patch.visible : zone.visible,
          };
        }),
      },
      stream: {
        title: mDomainValidation.cleanString(incoming.stream?.title, mState.settings.stream.title),
        category: mDomainValidation.cleanString(incoming.stream?.category, mState.settings.stream.category),
        goLiveMessage: mDomainValidation.cleanString(incoming.stream?.goLiveMessage, mState.settings.stream.goLiveMessage),
      },
    });
    mState.saveSettings();
    mEvents.broadcast('settings', mStorage.clone(mState.settings));
    return mHttpResponse.sendJson(res, 200, { ok: true, settings: mStorage.clone(mState.settings) });
  }

  // Dashboard panel order (control.html only - never read by any Meld/overlay page). Saved
  // automatically every time Baby clicks a ▲/▼ button, separately from the "Save settings" button.
  const resourceMatch = pathname.match(/^\/api\/live\/(amber|essence|sweetLeaf)(?:\/correct)?$/);
  if (resourceMatch) {
    const resource = resourceMatch[1];
    if (!mDomainValidation.validResource(resource)) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown resource.' });
    if (method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, resource, label: mDomainResources.RESOURCE_META[resource].label, value: mState.live.resources[resource] });
    if (!['PUT', 'POST', 'PATCH'].includes(method) || !pathname.endsWith('/correct')) return mHttpResponse.sendJson(res, 405, { ok: false, error: 'Use the deliberate /correct endpoint for writes.' });
    if (mState.live.reconciliation?.required) return mHttpResponse.sendJson(res, 409, { ok: false, error: 'Set all three current totals with /api/live/reconcile before correcting individual resources.' });
    const body = await mHttpBody.readBody(req);
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'value must be a non-negative number.' });
    mState.live.resources[resource] = Math.trunc(value);
    mState.live.reader.lastEvent = { at: new Date().toISOString(), source: 'manual-correction', resource, value: mState.live.resources[resource] };
    mState.live.reader.lastUpdateAt = mState.live.reader.lastEvent.at;
    mState.saveLive();
    mEvents.broadcast('live', mStorage.clone(mState.live));
    return mHttpResponse.sendJson(res, 200, { ok: true, resource, value: mState.live.resources[resource] });
  }

  if (pathname === '/api/actions' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const target = mDomainValidation.cleanString(body.target);
    if (!target) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'target is required.' });
    const commandId = mDomainValidation.cleanString(body.commandId) || `cmd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const action = {
      commandId,
      target,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      status: 'accepted',
      requestedAt: new Date().toISOString(),
    };
    mState.recordAction(action);

    if (target === 'reader.rescan') {
      mReader.forceRescan = true;
      mReader.scanLog();
      action.status = 'completed';
      action.message = 'Reader scan requested.';
    } else if (target === 'session.set-mode' && ['offline', 'on-air', 'break'].includes(action.payload.mode)) {
      mState.live.session.mode = action.payload.mode;
      mState.saveLive();
      mEvents.broadcast('live', mStorage.clone(mState.live));
      action.status = 'completed';
      action.message = `Session mode set to ${action.payload.mode}.`;
    } else if (target === 'overlay.ping') {
      action.status = 'completed';
      action.message = 'Overlay event path is available.';
    } else {
      action.status = 'rejected';
      action.message = 'This clean build does not execute that command yet.';
    }
    mState.recordAction({ ...action, completedAt: new Date().toISOString() });
    return mHttpResponse.sendJson(res, action.status === 'rejected' ? 400 : 202, { ok: action.status !== 'rejected', action });
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleStateApi });
