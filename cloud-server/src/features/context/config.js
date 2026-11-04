'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { clone } = require('../../domain/json');
const PUBLIC_FILES = [
    'runtime-defaults.json',
    'weekly-accomplishments.json',
    'resource-trackers.json',
    'tracker-skin-standard.json',
    'tradeup-game.json',
    'sprites-c7s4.json',
    'aniimo-roster.json'
];

/** Load only versioned public definitions; no cloud model can open a client file or secret. */
function definitions() {
    const folder = process.env.LAMBDA_TASK_ROOT
        ? path.join(process.env.LAMBDA_TASK_ROOT, 'config')
        : path.resolve(__dirname, '../../../../local-server/config');
    return Object.fromEntries(
        PUBLIC_FILES.map((name) => [
            name,
            JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))
        ])
    );
}

/** Virtual names identify domain documents, not local filesystem locations. */
function configuration(files) {
    const root = '/icb';
    const data = root + '/data';
    return {
        ...clone(files['runtime-defaults.json']),
        APP_DIR: root,
        DATA_DIR: data,
        SETTINGS_FILE: data + '/settings.json',
        LIVE_FILE: data + '/live.json',
        TODOS_FILE: data + '/todos.json',
        GIVEAWAY_FILE: data + '/giveaway.json',
        ACTIONS_FILE: data + '/actions.jsonl',
        ACTIVITY_DIR: data + '/activity',
        PORT: 8790,
        HOST: '127.0.0.1',
        VERSION: '2-cloud',
        STALE_LOG_MS: 600000,
        TRACKER_SKIN_STANDARD: clone(files['tracker-skin-standard.json'])
    };
}

module.exports = { PUBLIC_FILES, definitions, configuration };
