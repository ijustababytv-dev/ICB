'use strict';
const MAX_AGE = 14 * 86400000;

/** Own one installation session, its protected persistence and cancellation generation. */
function createSession({ request, store, now = Date.now }) {
    let active = null;
    let generation = 0;
    let requests = Promise.resolve();
    let queued = 0;
    let restoring = null;
    let problem = null;
    let remembered = false;
    const listeners = new Set();

    /** Drop cached access immediately and notify connected streams before another account can publish. */
    function change(value) {
        active = value;
        generation++;
        for (const listener of listeners) listener();
    }

    /** Remove the saved token without letting a disk error conceal that access is locked. */
    function forget() {
        try {
            store.clear();
            remembered = false;
            return true;
        } catch (_error) {
            problem = 'secure_storage_unavailable';
            return false;
        }
    }

    /** Local expiry is checked on every use; the cloud independently enforces revocation and expiry. */
    function current() {
        if (active && active.expiresAt <= now()) {
            change(null);
            forget();
            problem = 'session_expired';
        }
        return active;
    }

    /** Require bounded expiry and a complete bearer/account contract before trusting or persisting it. */
    function valid(value, base) {
        return (
            value &&
            value.base === base &&
            /^[A-Za-z0-9_-]{43}$/.test(value.token) &&
            typeof value.account?.id === 'string' &&
            typeof value.account?.username === 'string' &&
            Number.isFinite(value.issuedAt) &&
            value.issuedAt <= now() + 60000 &&
            Number.isFinite(value.expiresAt) &&
            value.expiresAt > now() &&
            value.expiresAt <= value.issuedAt + MAX_AGE + 60000
        );
    }

    /** Validate the deployed feature protocol before opening the application. */
    async function capabilities(value) {
        const reply = await request(
            value.base,
            '/v1/features/capabilities',
            'GET',
            undefined,
            value.token
        );
        if (reply.status !== 200 || reply.data.protocol_version !== 2)
            throw new Error('feature_protocol_required');
    }

    /** Revoke when reachable; callers always clear local access independently of the network. */
    async function revoke(value) {
        if (value)
            try {
                await request(value.base, '/v1/logout', 'POST', {}, value.token);
            } catch (_error) {}
    }

    /** Authenticate and protect a fixed 14-day token; never persist the submitted password. */
    async function login(base, username, password) {
        const previous = active;
        change(null);
        if (!forget()) throw new Error('secure_storage_unavailable');
        const attempt = generation;
        await revoke(previous);
        if (attempt !== generation) throw new Error('login_cancelled');
        const response = await request(base, '/v1/login', 'POST', { username, password });
        if (response.status !== 200) throw new Error('cloud_login_failed');
        const value = {
            base,
            token: response.data.token,
            account: response.data.account,
            issuedAt: now(),
            expiresAt: Date.parse(response.data.expires_at)
        };
        try {
            if (!valid(value, base)) throw new Error('session_protocol_required');
            await capabilities(value);
            if (attempt !== generation) throw new Error('login_cancelled');
            store.write(value);
            remembered = true;
            problem = null;
            change(value);
            return value.account;
        } catch (error) {
            await revoke(value);
            throw error;
        }
    }

    /** Delete remembered access first; logging out while restoration/login runs cancels its result. */
    async function logout() {
        const previous = active;
        change(null);
        const cleared = forget();
        await revoke(previous);
        if (!cleared) {
            problem = 'forget_failed';
            throw new Error('forget_failed');
        }
    }

    /** Revalidate protected saved tokens with /me before granting any local access after a restart. */
    function restore(base) {
        if (restoring) return restoring;
        if (current()) return Promise.resolve(true);
        const attempt = generation;
        restoring = (async () => {
            let value;
            try {
                value = store.read();
                if (!value) return false;
                remembered = true;
                if (!valid(value, base)) {
                    forget();
                    problem = 'session_expired';
                    return false;
                }
                const response = await request(base, '/v1/me', 'GET', undefined, value.token);
                if (attempt !== generation) return false;
                if (response.status === 401) {
                    forget();
                    problem = 'session_expired';
                    return false;
                }
                if (response.status !== 200) throw new Error('cloud_unavailable');
                value.account = response.data.account;
                value.expiresAt = Math.min(value.expiresAt, Date.parse(response.data.expires_at));
                if (!valid(value, base)) {
                    forget();
                    problem = 'session_expired';
                    return false;
                }
                await capabilities(value);
                if (attempt !== generation) return false;
                problem = null;
                change(value);
                return true;
            } catch (_error) {
                if (attempt !== generation) return false;
                // Connectivity failures keep the encrypted token for an explicit retry, but stay locked.
                problem = value ? 'cloud_unavailable' : 'saved_session_unavailable';
                if (!value) forget();
                return false;
            }
        })().finally(() => {
            restoring = null;
        });
        return restoring;
    }

    /** Serialize cloud calls and fence logout, account switches, expiry and unauthorized responses. */
    async function call(route, method = 'GET', body, expectedOwner) {
        const value = current();
        if (!value) throw new Error('login_required');
        if (expectedOwner && value.account.id !== expectedOwner) throw new Error('account_changed');
        if (queued >= 32) throw new Error('cloud_queue_full');
        queued++;
        const pending = requests
            .then(async () => {
                if (value !== current()) throw new Error('account_changed');
                const response = await request(value.base, route, method, body, value.token);
                if (value !== current()) throw new Error('account_changed');
                if (response.status === 401) {
                    change(null);
                    forget();
                    problem = 'session_expired';
                }
                return response;
            })
            .finally(() => {
                queued--;
            });
        requests = pending.then(
            () => {},
            () => {}
        );
        return pending;
    }

    return {
        current,
        login,
        logout,
        restore,
        call,
        generation: () => generation,

        ready: () => restoring || Promise.resolve(),

        status: () => {
            const value = current();
            return {
                restoring: !!restoring,
                remembered,
                auth_code: problem,
                expires_at: value ? new Date(value.expiresAt).toISOString() : null
            };
        },

        onChange: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}

module.exports = { createSession, MAX_AGE };
