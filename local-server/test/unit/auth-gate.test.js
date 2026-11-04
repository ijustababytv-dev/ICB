'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const session = require('../../src/cloud/session');
const { requireSignIn, bindStreams } = require('../../src/http/auth-gate');

test('Actual HTTP requests require sign-in for all pages, assets, features, mutations and SSE', async (t) => {
    let active = null;
    t.mock.method(session, 'current', () => active);
    t.mock.method(session, 'ready', async () => {});
    const server = http.createServer(async (req, res) => {
        if (await requireSignIn(req, res, new URL(req.url, 'http://local.invalid'))) return;
        res.writeHead(200);
        res.end('authorized handler');
    });
    server.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const route of [
        '/',
        '/hub.html',
        '/control.html',
        '/overlay.html',
        '/weekly.html',
        '/amber-echo.html',
        '/wk/giveaway-listener.html',
        '/decor/all.html'
    ]) {
        const response = await fetch(base + route, { redirect: 'manual' });
        assert.equal(response.status, 303, route);
        assert.equal(
            response.headers.get('location'),
            '/cloud.html?next=' + encodeURIComponent(route)
        );
    }
    for (const route of [
        '/api/state',
        '/api/diagnostics',
        '/api/settings',
        '/api/desktop',
        '/api/giveaway/listener',
        '/api/activity/nights',
        '/events',
        '/assets/private.png',
        '/resource-art/AMBER_ECHO.png',
        '/js/client/hub.js'
    ]) {
        assert.equal((await fetch(base + route)).status, 401, route);
        assert.equal(
            (await fetch(base + route, { method: 'POST', body: '{}' })).status,
            401,
            route
        );
    }
    for (const route of [
        '/cloud.html',
        '/css/hub.css',
        '/css/cloud.css',
        '/js/client/cloud-auth.js',
        '/js/client/local-api.js',
        '/api/cloud/status',
        '/api/cloud/csrf'
    ])
        assert.equal((await fetch(base + route)).status, 200, route);
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.auth_required, true);
    assert.deepEqual(Object.keys(health).sort(), ['auth_required', 'ok', 'port', 'service']);
    assert.match(
        (await (await fetch(base + '/api/hub/startup-urls')).json()).urls[0],
        /cloud.html\?startup=1$/
    );
    active = { account: { id: 'fixture' } };
    for (const route of ['/', '/control.html', '/events', '/api/desktop', '/assets/private.png'])
        assert.equal((await fetch(base + route)).status, 200, route);
    active = null;
    assert.equal((await fetch(base + '/events')).status, 401);
});

test('Logout/account/expiry notifications close existing event streams immediately', (t) => {
    const events = require('../../src/events');
    let changed;
    let closed = 0;
    t.mock.method(session, 'onChange', (listener) => {
        changed = listener;
        return () => {};
    });
    const stop = bindStreams();
    events.clients.add({
        end() {
            closed++;
        }
    });
    events.clients.add({
        end() {
            throw new Error('already closed');
        }
    });
    changed();
    assert.equal(closed, 1);
    assert.equal(events.clients.size, 0);
    stop();
});
