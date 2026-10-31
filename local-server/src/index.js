'use strict';

// Create the state directory before loading features; only this entry point starts ICB.
const fs = require('node:fs');
const { DATA_DIR } = require('./config');
fs.mkdirSync(DATA_DIR, { recursive: true });
require('./server');
