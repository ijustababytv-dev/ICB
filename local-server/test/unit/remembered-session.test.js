'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, MAX_AGE } = require('../../src/cloud/session-controller');
const base = 'https://fixture.invalid';

/** Model cloud replies and protected storage independently of Windows, AWS and live state. */
function fixture() {
    let now = Date.parse('2026-11-01T12:00:00Z');
    let saved = null;
    let offline = false;
    let revoked = false;
    let held = null;
    let brokenStore = false;
    const calls = [];
    const store = {
        read: () => structuredClone(saved),

        write(value) {
            if (brokenStore) throw new Error('secure_storage_unavailable');
            saved = structuredClone(value);
        },

        clear() {
            saved = null;
        }
    };
    /** Return only the real protocol's fields; tokens are deliberately fake fixture material. */
    async function request(_base, route, method, body) {
        calls.push({ route, method, body });
        if (offline) throw new Error('offline');
        if (held?.route === route) {
            const pause = held;
            held = null;
            await pause.wait;
        }
        if (route === '/v1/logout') return { status: 200, data: { ok: true } };
        if (revoked) return { status: 401, data: {} };
        return {
            status: 200,
            data: {
                ok: true,
                token: 't'.repeat(43),
                expires_at: new Date(now + MAX_AGE).toISOString(),
                account: { id: 'owner-one', username: 'fixture' },
                protocol_version: 2
            }
        };
    }

    return {
        calls,
        store,
        create: () => createSession({ request, store, now: () => now }),

        saved: () => saved,

        advance: (ms) => {
            now += ms;
        },

        offline: (value) => {
            offline = value;
        },

        revoke: () => {
            revoked = true;
        },

        breakStore: () => {
            brokenStore = true;
        },

        alterSaved: (change) => {
            saved = { ...saved, ...change };
        },

        hold(route) {
            let release;
            held = {
                route,
                wait: new Promise((resolve) => {
                    release = resolve;
                })
            };
            return release;
        }
    };
}

test('Restart revalidates a saved token without retaining or resending a password, with fixed 14-day expiry', async () => {
    const f = fixture();
    const first = f.create();
    await first.login(base, 'fixture', 'fixture-only-password');
    const expiry = first.status().expires_at;
    assert.ok(!JSON.stringify(f.saved()).includes('password'));
    assert.equal(f.saved().expiresAt - f.saved().issuedAt, MAX_AGE);
    f.advance(86400000);
    const second = f.create();
    assert.equal(second.current(), null);
    assert.equal(await second.restore(base), true);
    assert.equal(second.current().account.username, 'fixture');
    assert.equal(second.status().expires_at, expiry, 'Restart must not slide the original expiry');
    assert.equal(f.calls.filter((call) => call.route === '/v1/login').length, 1);
    assert.equal(f.calls.filter((call) => call.route === '/v1/me').length, 1);
    await second.call('/anything');
    f.advance(13 * 86400000);
    assert.equal(second.current(), null);
    assert.equal(f.saved(), null);
    await assert.rejects(second.call('/anything'), /login_required/);
});

test('Expired, invalid and wrong-endpoint saved sessions never grant access or send a token', async () => {
    for (const altered of [
        { expiresAt: 0 },
        { base: 'https://other.invalid' },
        { token: 'invalid' }
    ]) {
        const f = fixture();
        await f.create().login(base, 'fixture', 'fixture-only-password');
        f.alterSaved(altered);
        const calls = f.calls.length;
        const fresh = f.create();
        assert.equal(await fresh.restore(base), false);
        assert.equal(fresh.current(), null);
        assert.equal(f.saved(), null);
        assert.equal(f.calls.length, calls);
    }
});

test('Revoked tokens clear remembered access, including unauthorized replies during normal use', async () => {
    for (const restoring of [true, false]) {
        const f = fixture();
        const current = f.create();
        await current.login(base, 'fixture', 'fixture-only-password');
        f.revoke();
        const target = restoring ? f.create() : current;
        if (restoring) assert.equal(await target.restore(base), false);
        else assert.equal((await target.call('/anything')).status, 401);
        assert.equal(target.current(), null);
        assert.equal(f.saved(), null);
    }
});

test('Connection failures preserve encrypted remembered material while keeping startup locked until retry succeeds', async () => {
    const f = fixture();
    await f.create().login(base, 'fixture', 'fixture-only-password');
    f.offline(true);
    const fresh = f.create();
    assert.equal(await fresh.restore(base), false);
    assert.equal(fresh.current(), null);
    assert.ok(f.saved());
    assert.equal(fresh.status().auth_code, 'cloud_unavailable');
    f.offline(false);
    assert.equal(await fresh.restore(base), true);
});

test('Sign out deletes saved material even offline, and cancels delayed restoration and sign-in responses', async () => {
    for (const route of ['/v1/me', '/v1/login']) {
        const f = fixture();
        await f.create().login(base, 'fixture', 'fixture-only-password');
        const fresh = f.create();
        const release = f.hold(route);
        const pending =
            route === '/v1/me'
                ? fresh.restore(base)
                : fresh.login(base, 'fixture', 'fixture-only-password');
        const settled = Promise.allSettled([pending]);
        await new Promise((resolve) => setImmediate(resolve));
        f.offline(true);
        await fresh.logout();
        release();
        await settled;
        assert.equal(fresh.current(), null);
        assert.equal(f.saved(), null);
    }
});

test('Secure storage failure never falls back to a plaintext password or an unremembered unlocked session', async () => {
    const f = fixture();
    f.breakStore();
    const session = f.create();
    await assert.rejects(
        session.login(base, 'fixture', 'fixture-only-password'),
        /secure_storage_unavailable/
    );
    assert.equal(session.current(), null);
    assert.equal(f.saved(), null);
    assert.ok(f.calls.some((call) => call.route === '/v1/logout'));
});

test('A failed local erase locks access and reports failure rather than claiming the saved sign-in was forgotten', async () => {
    const f = fixture();
    const session = f.create();
    await session.login(base, 'fixture', 'fixture-only-password');
    f.store.clear = () => {
        throw new Error('permission_denied');
    };

    f.offline(true);
    await assert.rejects(session.logout(), /forget_failed/);
    assert.equal(session.current(), null);
    assert.equal(session.status().auth_code, 'forget_failed');
    assert.equal(session.status().remembered, true);
    assert.ok(f.saved());
});
