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

const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    // Stream Timer widget (added 2026-09-15): a Meld overlay (timer.html) plus its own private
    // control page (timer-control.html), both plain static files served like any other. heading/
    // subheading are freely editable text; targetAt is an ISO timestamp the overlay counts down to,
    // empty when there's no active timer. status drives which of the overlay's three states renders
    // - 'idle' (hidden), 'running' (ticking countdown), 'timesup' (celebration) - independent of
    // whether targetAt has actually elapsed, so "Time's Up!" can end a countdown early and "Reset"
    // can clear it without touching the heading/subheading text the streamer already typed.
    countdown: {
        heading: 'NEXT ADVENTURE IN',
        subheading: '',
        targetAt: '',
        timezone: 'America/Chicago',
        status: 'idle'
    },
    // World Time Bar (added 2026-09-15): a horizontal strip of clocks (worldclock.html) plus its
    // own control page (worldclock-control.html). Six fixed slots (zone1..zone6) rather than a
    // free-form list - editing an existing slot's label/subLabel/timezone/visible is supported,
    // adding or removing slots is not, which keeps the PUT handler a simple per-field whitelist
    // instead of needing to validate arbitrary array edits. "4 to 6 zones" is just zone5/zone6
    // starting hidden - toggle visible to bring a 5th or 6th clock onto the bar.
    worldClock: {
        zones: [
            {
                id: 'zone1',
                label: 'CHICAGO',
                subLabel: 'HOME BASE',
                timezone: 'America/Chicago',
                visible: true
            },
            {
                id: 'zone2',
                label: 'LOS ANGELES',
                subLabel: '',
                timezone: 'America/Los_Angeles',
                visible: true
            },
            {
                id: 'zone3',
                label: 'NEW YORK',
                subLabel: '',
                timezone: 'America/New_York',
                visible: true
            },
            {
                id: 'zone4',
                label: 'LONDON',
                subLabel: '',
                timezone: 'Europe/London',
                visible: true
            },
            { id: 'zone5', label: 'TOKYO', subLabel: '', timezone: 'Asia/Tokyo', visible: false },
            {
                id: 'zone6',
                label: 'SYDNEY',
                subLabel: '',
                timezone: 'Australia/Sydney',
                visible: false
            }
        ]
    },
    stream: { title: '', category: 'Palia', goLiveMessage: '' },
    // The scrolling banner overlay (added 2026-08-25) - the ijustababyTV unicorn banner art with a
    // message that scrolls through the empty glass panel. Editable from the dashboard so Baby never
    // needs a file edit to change it. See renderTickerPage() and /ticker.html below.
    // speed = pixels per second the text travels (higher = faster). pause = seconds the panel sits
    // empty between one full pass finishing and the next one starting (2026-08-28: switched from a
    // continuous double-scroll to one single pass at a time, per Baby's request).
    ticker: { text: 'Welcome to ijustababyTv', speed: 90, pause: 1 },
    // Dashboard-only: the order Baby dragged the control.html panels into with the ▲▼ buttons.
    // An array of panel keys (e.g. ["run","trackers","stream",...]); empty until she first
    // reorders something, at which point control.html sends the full current order here.
    // Meld/overlay pages never read this - it only affects the private Chrome dashboard layout.
    layout: { panelOrder: [], trackerOrder: [], trackerHidden: [] },
    updatedAt: null
};

const DEFAULT_LIVE = {
    schemaVersion: 1,
    resources: { amber: 0, essence: 0, sweetLeaf: 0 },
    session: { mode: 'offline' },
    reader: {
        state: 'offline',
        file: null,
        fileModifiedAt: null,
        lastEvent: null,
        lastUpdateAt: null
    },
    reconciliation: { required: false, reason: null, historicalBaseline: null, reconciledAt: null },
    updatedAt: null
};

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
