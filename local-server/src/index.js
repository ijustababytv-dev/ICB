'use strict';

// Create the state directory before loading features; only this entry point starts ICB.
const fs = require('node:fs');
const { DATA_DIR } = require('./config');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (fs.existsSync(require('node:path').join(DATA_DIR, '.feature-cutover.json')))
    throw new Error('Feature cutover is in progress. Finish or recover it before starting ICB.');
// Startup stays locked until the protected token is validated online. The login page remains available.
require('./cloud/session').restore(process.env.ICB_CLOUD_API_URL);
require('./server');
