#!/usr/bin/env node
// palia-log-bridge.js
//
// Replaces Palia Assistant as ICB's data source. Tails Palia's OWN raw
// game log (LogInventoryComponent lines) directly, keeps ONLY Baby's own
// real gains (see OwnEventClassifier in bridge-core.js - 2026-09-27: the
// old dedup counted items for every player near her), and writes synthetic "Inventory gained: itemtype_x xN" lines into
// an app-bridge-YYYYMMDD.log file inside the same folder Palia Assistant
// used to write to. ICB's server.js already auto-discovers any file
// matching /^app-.*\.log$/i in that folder and polls it every second, so
// no server.js changes are needed at all.
//
// Zero npm dependencies - only Node.js built-ins.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { OwnEventClassifier, formatEventLine } = require('./bridge-core');

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const PALIA_LOG_DIR = process.env.ICB_PALIA_GAME_LOG_DIR || path.join(LOCALAPPDATA, 'Palia', 'Saved', 'Logs');
const PALIA_LOG_FILE = process.env.ICB_PALIA_GAME_LOG_FILE || path.join(PALIA_LOG_DIR, 'Palia.log');

const OUTPUT_DIR = process.env.ICB_CLEAN_PALIA_LOG_DIR || path.join(LOCALAPPDATA, 'PaliaAssistant', 'logs');
const STATE_FILE = path.resolve(__dirname, '../../bridge/.palia-log-bridge-state.json');

const POLL_MS = 1000;
// If the game log goes quiet for this many polls, decide any held lines now
// (each RECEIVED line waits ~1.5 s of log time for the stat line after it).
const QUIET_POLLS_BEFORE_FORCE = 3;

// ---------------------------------------------------------------------
// State (persists read offset + which file we were tailing, across restarts)
// ---------------------------------------------------------------------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { filePath: null, offset: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
  } catch (e) {
    log(`WARN: could not persist state: ${e.message}`);
  }
}

let state = loadState();
let classifier = new OwnEventClassifier();
let quietPolls = 0;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ---------------------------------------------------------------------
// Output: write synthetic gained-events into today's app-bridge log
// ---------------------------------------------------------------------
function todayOutputPath() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return path.join(OUTPUT_DIR, `app-bridge-${stamp}.log`);
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function emitEvent(evt) {
  const line = formatEventLine(evt) + os.EOL;
  const outPath = todayOutputPath();
  fs.appendFileSync(outPath, line, 'utf8');
}

// ---------------------------------------------------------------------
// Rotation handling
// ---------------------------------------------------------------------
// Palia renames the current log to Palia-backup-<timestamp>.log on
// relaunch and starts a fresh Palia.log. We detect this by tracking the
// file's identity (birthtimeMs) alongside its path; if the file at
// PALIA_LOG_FILE has a different birthtime than what we last saw, or has
// shrunk since we last read it, treat it as a brand new file and reset
// our offset to 0.
function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function readNewLines() {
  const st = statOrNull(PALIA_LOG_FILE);
  if (!st) {
    return []; // game not running / log not present yet
  }

  const isSameFile = state.filePath === PALIA_LOG_FILE && state.birthtimeMs === st.birthtimeMs.valueOf();
  if (!isSameFile) {
    log(`Detected new/rotated log file (or first run). Starting from current end of file.`);
    // Start from the END of the file on first sight, so we don't replay a
    // huge historical backlog the first time the bridge is ever run.
    // (On subsequent legitimate rotations mid-session this also means we
    // start fresh at whatever the file has grown to by the time we notice —
    // acceptable since rotation only happens on game relaunch.)
    state = { filePath: PALIA_LOG_FILE, birthtimeMs: st.birthtimeMs.valueOf(), offset: st.size };
    saveState(state);
    classifier = new OwnEventClassifier(); // fresh game session = fresh context
    return [];
  }

  if (st.size < state.offset) {
    // File shrank without changing birthtime (defensive case) - reset.
    log(`Log file shrank unexpectedly. Resetting offset.`);
    state.offset = 0;
  }

  if (st.size === state.offset) {
    return []; // nothing new
  }

  const fd = fs.openSync(PALIA_LOG_FILE, 'r');
  try {
    const length = st.size - state.offset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, state.offset);
    const text = buffer.toString('utf8');

    // The game may still be mid-write on the final line. Only advance our
    // offset past the LAST complete newline we found, so a partial final
    // line is re-read (and completed) on the next poll instead of being
    // silently truncated.
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) {
      return []; // no complete line yet; leave offset untouched
    }
    const completeText = text.slice(0, lastNewline);
    state.offset += Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8');
    saveState(state);
    return completeText.split(/\r?\n/).filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------
// Main poll loop
// ---------------------------------------------------------------------
let running = false;

function pollOnce() {
  if (running) return; // avoid overlap if a poll takes unusually long
  running = true;
  try {
    const lines = readNewLines();
    let newEvents = 0;
    for (const line of lines) {
      classifier.feed(line);
      for (const evt of classifier.flush(false)) { emitEvent(evt); newEvents++; }
    }
    quietPolls = lines.length ? 0 : quietPolls + 1;
    if (quietPolls >= QUIET_POLLS_BEFORE_FORCE && classifier.pending.length) {
      for (const evt of classifier.flush(true)) { emitEvent(evt); newEvents++; }
    }
    if (newEvents > 0) {
      const st = classifier.stats;
      log(`Emitted ${newEvents} of your own gain(s). (so far: ${st.received} counted, ${st.movedNotEarned} moved-not-earned skipped, ${st.ignoredMulticast} other-player/broadcast lines ignored)`);
    }
  } catch (e) {
    log(`ERROR during poll: ${e.stack || e.message}`);
  } finally {
    running = false;
  }
}

function main() {
  ensureOutputDir();
  log(`Palia log bridge starting.`);
  log(`  Reading:  ${PALIA_LOG_FILE}`);
  log(`  Writing:  ${todayOutputPath()}`);
  log(`  Polling every ${POLL_MS}ms.`);
  pollOnce();
  setInterval(pollOnce, POLL_MS);
}

main();
