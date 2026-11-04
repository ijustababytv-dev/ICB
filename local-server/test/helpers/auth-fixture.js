'use strict';
// Test-only cloud transport. Keep the real session controller, DPAPI store and HTTP auth gate.
const client = require('../../src/cloud/client');
let fixture;
const token = 't'.repeat(43);

/** Supply fake cloud credentials only inside the isolated harness; no AWS/account state is touched. */
client.request = async (_base, route, method, body, bearer) => {
    if (
        route === '/v1/login' &&
        (String(body.username).toLowerCase() !== 'fixture' ||
            body.password !== 'FixturePassword123!')
    )
        return { status: 401, data: { code: 'invalid_login' } };
    if (route !== '/v1/login' && bearer !== token) return { status: 401, data: {} };
    if (route === '/v1/login' || route === '/v1/me')
        return {
            status: 200,
            data: {
                ok: true,
                token,
                account: fixture.account,
                expires_at: new Date(Date.now() + 14 * 86400000).toISOString()
            }
        };
    if (route === '/v1/logout') return { status: 200, data: { ok: true } };
    if (route === '/v1/features/capabilities')
        return { status: 200, data: { ok: true, protocol_version: 2 } };
    return fixture.call(route, method, body || {});
};

const session = require('../../src/cloud/session');
const realCurrent = session.current;
const realCall = session.call;
fixture = require('./cloud-fixture');
session.current = realCurrent;
session.call = realCall;
