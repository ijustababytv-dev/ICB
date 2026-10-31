'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The only local cloud setting is a public API URL; credentials remain process-only after login.
const cloudEnvFile = path.resolve(__dirname, '../.env');
if (!process.env.ICB_CLOUD_API_URL && fs.existsSync(cloudEnvFile)) {
    const match = /^ICB_CLOUD_API_URL=(https:\/\/[^\r\n]+)$/m.exec(
        fs.readFileSync(cloudEnvFile, 'utf8')
    );
    if (match) process.env.ICB_CLOUD_API_URL = match[1].trim();
}

const VERSION = '0.1.0-clean';
const PORT = Number(process.env.ICB_CLEAN_PORT || 8790);
const HOST = '127.0.0.1';
const APP_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = process.env.ICB_CLEAN_DATA_DIR || path.join(APP_DIR, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LIVE_FILE = path.join(DATA_DIR, 'live.json');
const ACTIONS_FILE = path.join(DATA_DIR, 'actions.jsonl');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const GIVEAWAY_FILE = path.join(DATA_DIR, 'giveaway.json');
const ACTIVITY_DIR = path.join(DATA_DIR, 'activity');
const STALE_LOG_MS = Number(process.env.ICB_CLEAN_LOG_STALE_MS || 10 * 60 * 1000);

// The Official ICB Resource Tracker Skin Standard (2048x768, 8:3) is defined
// once, in config/tracker-skin-standard.json, and read from there. Do not
// restate those numbers anywhere else in the codebase — reference this
// constant or GET /api/tracker-skin-standard so every tracker component
// inherits the same geometry. See docs/ICB-TRACKER-SKIN-STANDARD.md.
const TRACKER_SKIN_STANDARD_FILE = path.join(
    APP_DIR,
    'local-server',
    'config',
    'tracker-skin-standard.json'
);
const TRACKER_SKIN_STANDARD = JSON.parse(fs.readFileSync(TRACKER_SKIN_STANDARD_FILE, 'utf8'));

// One versioned default document is shared with the cloud release.
const { DEFAULT_SETTINGS, DEFAULT_LIVE } = require('../config/runtime-defaults.json');

Object.assign(exports, {
    DATA_DIR,
    DEFAULT_SETTINGS,
    SETTINGS_FILE,
    DEFAULT_LIVE,
    LIVE_FILE,
    ACTIONS_FILE,
    TODOS_FILE,
    GIVEAWAY_FILE,
    ACTIVITY_DIR,
    STALE_LOG_MS,
    APP_DIR,
    PORT,
    HOST,
    VERSION,
    TRACKER_SKIN_STANDARD
});
