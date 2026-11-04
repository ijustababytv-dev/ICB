'use strict';
const { request } = require('./client');
const { createSession } = require('./session-controller');
const { createStore, defaultFile } = require('./credential-store');

// Protected machine storage holds an opaque session token, never the account password.
module.exports = createSession({ request, store: createStore(defaultFile()) });
