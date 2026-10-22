'use strict';

const mHttpResponse = require('../http/response');
const mGiveawayBackups = require('../giveaway/backups');
const mHttpBody = require('../http/body');
const fs = require('node:fs');
const path = require('node:path');
const mGiveawayState = require('../giveaway/state');
const mStorage = require('../storage');
const mGiveawayDefaults = require('../giveaway/defaults');
const mGiveawayActivity = require('../giveaway/activity');

/** Handle giveaway backups requests; reject unmatched paths. */
async function handleGiveawayBackupsApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/api/giveaway/backups' && method === 'GET') {
    return mHttpResponse.sendJson(res, 200, { ok: true, backups: mGiveawayBackups.listGiveawayBackups() });
  }
  if (pathname === '/api/giveaway/backups/now' && method === 'POST') {
    const file = mGiveawayBackups.backupGiveaway('before', 'manual');
    return mHttpResponse.sendJson(res, file ? 200 : 500, { ok: !!file, file });
  }
  if (pathname === '/api/giveaway/backups/restore' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const file = String(body.file || '');
    if (!/^[a-z]+_[0-9_-]+(_[a-z0-9-]+)?\.json$/i.test(file)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Bad backup name.' });
    const full = path.join(mGiveawayBackups.GIVEAWAY_BACKUP_DIR, file);
    let restored;
    try { restored = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch (_error) { return mHttpResponse.sendJson(res, 404, { ok: false, error: 'That backup could not be read.' }); }
    const safety = mGiveawayBackups.backupGiveaway('before', 'restore');
    mGiveawayState.giveaway = mStorage.mergeDefaults(mGiveawayDefaults.GIVEAWAY_DEFAULTS, restored);
    if (!mGiveawayState.giveaway.windowStartedAt) mGiveawayState.giveaway.windowStartedAt = new Date().toISOString();
    mGiveawayState.migrateGiveaway();
    mGiveawayState.purgeBlocked();
    mGiveawayActivity.logActivity({ type: 'backup_restored', file, safetyCopy: safety });
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, restored: file, safetyCopy: safety });
  }

  // Runs the full drawing show on unicorn-jar.html with IJustABabyTv as the
  // winner, for demos - no entrant, winners-list, or activity-log data is
  // touched, so it never shows up in the real Winners Circle or nightly
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleGiveawayBackupsApi });
