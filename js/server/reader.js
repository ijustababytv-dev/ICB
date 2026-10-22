'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mState = require('./state');
const mResources = require('./resources');
const mWeekly = require('./weekly');
const mDomainLogParser = require('./domain/log-parser');
const mEvents = require('./events');
const mStorage = require('./storage');

/** Prefer an explicit log directory, otherwise search the known Palia Assistant folders. */
function logDirectories() {
  const configured = process.env.ICB_CLEAN_PALIA_LOG_DIR;
  return configured
    ? [configured]
    : [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'PaliaAssistant', 'logs') : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'PaliaAssistant', 'current', 'logs') : null,
    ].filter(Boolean);
}

/** Prefer the configured log file, otherwise select the newest readable app log. */
function findLogFile() {
  const exact = process.env.ICB_CLEAN_PALIA_LOG_FILE;
  if (exact && fs.existsSync(exact)) return path.resolve(exact);

  const candidates = [];
  for (const directory of logDirectories()) {
    try {
      for (const entry of fs.readdirSync(directory)) {
        if (!/^app-.*\.log$/i.test(entry)) continue;
        const file = path.join(directory, entry);
        const stat = fs.statSync(file);
        if (stat.isFile()) candidates.push({ file, mtime: stat.mtimeMs });
      }
    } catch (_error) {
      // A missing Palia Assistant directory is a normal offline state.
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.file || null;
}

/** Treat a log older than the configured freshness window as offline. */
function logState(stat) {
  return Date.now() - stat.mtimeMs <= mConfig.STALE_LOG_MS ? 'live' : 'offline';
}

/** Report freshness without clearing a required reconciliation. */
function readerView(stat, file) {
  return {
    state: mState.live.reconciliation?.required ? 'needs-reconciliation' : logState(stat),
    file,
    fileModifiedAt: new Date(stat.mtimeMs).toISOString(),
  };
}


let activeLog = null;
let activeOffset = 0;
let forceRescan = false;

/** Tail new bytes only, handle rotation/truncation, and apply tracker events after reconciliation. */
function scanLog() {
  const file = findLogFile();
  if (!file) {
    activeLog = null;
    activeOffset = 0;
    mState.updateReader({ state: mState.live.reconciliation?.required ? 'needs-reconciliation' : 'offline', file: null, fileModifiedAt: null });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_error) {
    mState.updateReader({ state: mState.live.reconciliation?.required ? 'needs-reconciliation' : 'offline', file: null, fileModifiedAt: null });
    return;
  }

  if (forceRescan || activeLog !== file) {
    forceRescan = false;
    activeLog = file;
    activeOffset = stat.size;
    mState.updateReader(readerView(stat, file));
    return;
  }

  if (mState.live.reconciliation?.required) {
    activeOffset = stat.size;
    mState.updateReader(readerView(stat, file));
    return;
  }

  if (stat.size < activeOffset) activeOffset = stat.size;
  if (stat.size === activeOffset) {
    mState.updateReader(readerView(stat, file));
    return;
  }

  let appended;
  try {
    const handle = fs.openSync(file, 'r');
    const length = stat.size - activeOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, activeOffset);
    fs.closeSync(handle);
    activeOffset = stat.size;
    appended = buffer.toString('utf8');
  } catch (_error) {
    return;
  }

  let changed = false;
  let resourceChanged = false;
  let weeklyChanged = false;
  for (const line of appended.split(/\r?\n/)) {
    if (mResources.resourceTrackerScan(line)) resourceChanged = true;
    if (mWeekly.weeklyScan(line)) weeklyChanged = true;
    for (const delta of mDomainLogParser.lineDelta(line)) {
      const current = Number(mState.live.resources[delta.resource]) || 0;
      mState.live.resources[delta.resource] = Math.max(0, Math.trunc(current + delta.amount));
      mState.live.reader.lastEvent = { at: new Date().toISOString(), line: line.slice(-300), ...delta };
      mState.live.reader.lastUpdateAt = mState.live.reader.lastEvent.at;
      mState.live.reader.state = 'live';
      mState.live.reader.file = file;
      mState.live.reader.fileModifiedAt = new Date(stat.mtimeMs).toISOString();
      changed = true;
    }
  }
  if (changed) {
    mState.saveLive();
    mEvents.broadcast('live', mStorage.clone(mState.live));
  }
  if (resourceChanged) mResources.broadcastResourceTrackers();
  if (weeklyChanged) mWeekly.broadcastWeekly();
  if (!changed && !resourceChanged && !weeklyChanged) mState.updateReader(readerView(stat, file));
}

// 12MB cap - big enough for a base64-encoded 8MB image (base64 adds ~33%
// overhead, so an 8MB PNG/JPG becomes ~10.7MB of JSON text) plus room for the
// rest of the payload. tradeupSaveImage() and the resource-art upload route
// both enforce their own 8MB *decoded* image limit on top of this - this cap

Object.assign(exports, { scanLog, logDirectories });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
  activeLog: { enumerable: true, get: () => activeLog, set: value => { activeLog = value; } },
  forceRescan: { enumerable: true, get: () => forceRescan, set: value => { forceRescan = value; } },
});
