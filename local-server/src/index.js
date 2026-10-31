'use strict';

// Create the state directory before loading features; only this entry point starts ICB.
const fs = require('node:fs');
const { DATA_DIR } = require('./config');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (fs.existsSync(require('node:path').join(DATA_DIR, '.feature-cutover.json')))
    throw new Error('Feature cutover is in progress. Finish or recover it before starting ICB.');
require('./server');
