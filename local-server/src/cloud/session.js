'use strict';
const { request } = require('./client');
let session = null;
let generation = 0;

/** Keep the cloud token exclusively in this process and expire it on logout/account changes. */
function current() {
    return session;
}

/** Authenticate through Node; a concurrent logout cannot resurrect an obsolete login response. */
async function login(base, username, password) {
    const attempt = ++generation;
    const response = await request(base, '/v1/login', 'POST', { username, password });
    if (response.status !== 200) throw new Error(response.data.code || 'login_failed');
    if (attempt !== generation) throw new Error('login_cancelled');
    session = { base, token: response.data.token, account: response.data.account };
    return response.data.account;
}

/** Revoke the remote token when reachable and always forget it locally. */
async function logout() {
    const previous = session;
    session = null;
    generation++;
    if (previous)
        try {
            await request(previous.base, '/v1/logout', 'POST', {}, previous.token);
        } catch (_error) {}
}

/** Proxy an authenticated request without exposing the bearer token to UI or diagnostics. */
async function call(route, method = 'GET', body, expectedOwner) {
    const active = session;
    if (!active) throw new Error('login_required');
    if (expectedOwner && active.account.id !== expectedOwner) throw new Error('account_changed');
    const response = await request(active.base, route, method, body, active.token);
    if (response.status === 401 && active === session) {
        session = null;
        generation++;
    }
    return response;
}

module.exports = { current, login, logout, call };
