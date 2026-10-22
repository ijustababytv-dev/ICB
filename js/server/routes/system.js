'use strict';

const mHttpResponse = require('../http/response');
const mConfig = require('../config');
const mState = require('../state');
const mEvents = require('../events');
const mOverlayDiagnostics = require('../overlay-diagnostics');
const mStorage = require('../storage');
const mReader = require('../reader');

/** Handle system requests; reject unmatched paths. */
async function handleSystemApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/api/health' && method === 'GET') {
    return mHttpResponse.sendJson(res, 200, {
      ok: true,
      service: 'ICB Clean Room',
      version: mConfig.VERSION,
      port: mConfig.PORT,
      uptimeSeconds: Math.floor((Date.now() - mState.startedAt) / 1000),
      readerState: mState.live.reader.state,
      connectedClients: mEvents.clientCounts(),
      overlayPolls: mOverlayDiagnostics.overlayPollView(),
    });
  }

  if (pathname === '/api/diagnostics' && method === 'GET') return mHttpResponse.sendJson(res, 200, {
    ok: true,
    version: mConfig.VERSION,
    port: mConfig.PORT,
    dataFiles: { settings: mConfig.SETTINGS_FILE, live: mConfig.LIVE_FILE, actions: mConfig.ACTIONS_FILE },
    reader: mStorage.clone(mState.live.reader),
    activeLog: mReader.activeLog,
    logDirectories: mReader.logDirectories(),
    staleAfterSeconds: Math.round(mConfig.STALE_LOG_MS / 1000),
    connectedClients: mEvents.clientCounts(),
    overlayPolls: mOverlayDiagnostics.overlayPollView(),
    trackerSkinStandard: {
      standardId: mConfig.TRACKER_SKIN_STANDARD.standardId,
      width: mConfig.TRACKER_SKIN_STANDARD.master.width,
      height: mConfig.TRACKER_SKIN_STANDARD.master.height,
      aspectRatio: mConfig.TRACKER_SKIN_STANDARD.master.aspectRatio,
      valueBoxBakedIntoArtwork: mConfig.TRACKER_SKIN_STANDARD.structure.valueBox.bakedIntoArtwork,
      spec: '/api/tracker-skin-standard',
    },
  });

  // Canonical tracker skin geometry, served so overlay/dashboard/future
  // tracker components inherit the standard instead of hardcoding it.
  if (pathname === '/api/tracker-skin-standard' && method === 'GET') {
    return mHttpResponse.sendJson(res, 200, { ok: true, trackerSkinStandard: mStorage.clone(mConfig.TRACKER_SKIN_STANDARD) });
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleSystemApi });
