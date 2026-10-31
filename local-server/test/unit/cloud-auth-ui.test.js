'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../ui/js/cloud-auth.js'), 'utf8');

/** Exercise the real form controller with fake DOM/network, never real account credentials. */
function form() {
    const nodes = {};
    const requests = [];
    const intervals = [];
    let status = { configured: true, account: null, pending: 0, quarantined: 0 };
    let loginOK = true;
    let unavailable = false;
    let loginCount = 0;
    let heldStatus = null;
    /** Provide only DOM operations used by this focused controller. */
    function node(id) {
        return (
            nodes[id] ||
            (nodes[id] = {
                textContent: '',
                value: '',
                hidden: false,
                disabled: false,
                dataset: {},
                addEventListener(type, listener) {
                    this[type] = listener;
                }
            })
        );
    }

    const context = {
        document: { getElementById: node },
        setInterval(callback) {
            intervals.push(callback);
        },

        async fetch(url, options) {
            requests.push({ url, options });
            if (unavailable) throw new Error('offline');
            if (url.endsWith('/status')) {
                const snapshot = status;
                if (heldStatus) {
                    const held = heldStatus;
                    heldStatus = null;
                    await new Promise((resolve) => {
                        held.release = resolve;
                    });
                }
                return { ok: true, json: async () => snapshot };
            }

            if (url.endsWith('/csrf'))
                return { ok: true, json: async () => ({ csrf: 'test-csrf' }) };

            if (url.endsWith('/login')) {
                loginCount++;
                if (loginOK) status = { ...status, account: { username: 'test-user' } };
                return { ok: loginOK, json: async () => ({ ok: loginOK }) };
            }
            status = { ...status, account: null };
            return { ok: true, json: async () => ({ ok: true }) };
        }
    };
    vm.runInNewContext(source, context);
    return {
        node,
        requests,
        intervals,
        status(value) {
            status = { ...status, ...value };
        },

        rejectLogin() {
            loginOK = false;
        },

        offline() {
            unavailable = true;
        },

        loginCount: () => loginCount,

        /** Delay one poll so a completed credential action can overtake it. */
        holdNextStatus() {
            const held = {};
            heldStatus = held;
            return () => held.release();
        }
    };
}

/** Drain asynchronous status rendering without wall-clock sleeps. */
async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('Sign-in posts CSRF-protected credentials, blocks duplicate submits and clears password', async () => {
    const f = form();
    await settle();
    assert.equal(f.node('accountState').textContent, 'Signed out');
    assert.equal(f.node('logout').hidden, true);
    f.node('username').value = '  TEST-user  ';
    f.node('password').value = 'fixture-only';
    const first = f.node('login').submit({ preventDefault() {} });

    assert.equal(f.node('signin').disabled, true);
    await f.node('login').submit({ preventDefault() {} });

    await first;
    assert.equal(f.loginCount(), 1);
    const request = f.requests.find((item) => item.url.endsWith('/login'));
    assert.deepEqual(JSON.parse(request.options.body), {
        username: 'TEST-user',
        password: 'fixture-only'
    });
    assert.equal(request.options.headers['X-ICB-CSRF'], 'test-csrf');
    assert.equal(f.node('password').value, '');
    assert.equal(f.node('signin').disabled, false);
    assert.equal(f.node('logout').hidden, false);
    assert.match(f.node('accountState').textContent, /test-user/);
    assert.match(f.node('result').textContent, /dashboards are ready/);
    f.node('logout').click();
    await settle();
    assert.equal(f.node('accountState').textContent, 'Signed out');
    assert.equal(f.node('logout').hidden, true);
});

test('Rejected and unavailable sign-ins announce errors without leaving password or disabled controls', async () => {
    for (const offline of [false, true]) {
        const f = form();
        await settle();
        if (offline) f.offline();
        else f.rejectLogin();
        f.node('password').value = 'fixture-only';
        await f.node('login').submit({ preventDefault() {} });

        assert.equal(f.node('password').value, '');
        assert.equal(f.node('signin').disabled, false);
        assert.equal(f.node('result').dataset.error, 'true');
        assert.match(f.node('result').textContent, offline ? /unavailable/ : /Sign-in failed/);
    }
});

test('Sync status preserves attention counts and distinguishes unavailable counters from zero', async () => {
    const f = form();
    await settle();
    f.status({
        account: { username: '<unsafe>' },
        pending: 3,
        quarantined: 2,
        uncounted_events: 4,
        feed: { code: 'cloud_unavailable' }
    });
    await f.intervals[0]();
    await settle();
    assert.equal(f.node('accountState').textContent, 'Signed in as <unsafe>');
    assert.equal(f.node('pendingUploads').textContent, 3);
    assert.equal(f.node('quarantinedUploads').textContent, 2);
    assert.equal(f.node('uncountedEvents').textContent, 4);
    assert.match(f.node('connectionState').textContent, /cloud_unavailable/);
    f.status({ pending: null, quarantined: null, code: 'outbox_unreadable' });
    f.intervals[0]();
    await settle();
    assert.equal(f.node('pendingUploads').textContent, 'Unavailable');
    assert.equal(f.node('quarantinedUploads').textContent, 'Unavailable');
    assert.match(f.node('connectionState').textContent, /needs attention/);
});

test('A delayed signed-out status cannot overwrite a completed sign-in', async () => {
    const f = form();
    await settle();
    const release = f.holdNextStatus();
    f.intervals[0]();
    await settle();
    f.node('username').value = 'test-user';
    f.node('password').value = 'fixture-only';
    await f.node('login').submit({ preventDefault() {} });

    release();
    await settle();
    assert.equal(f.node('accountState').textContent, 'Signed in as test-user');
    assert.equal(f.node('logout').hidden, false);
});
