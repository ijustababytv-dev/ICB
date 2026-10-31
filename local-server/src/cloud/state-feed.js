'use strict';
const session = require('./session');
const cacheEvents = require('./cache-events');
const paths = new Map();
const waiters = new Set();
let cache = { revision: 0, documents: {}, views: {}, authorities: {} };
let account = null;
let generation = 0;
let pending = null;
let nextAttempt = 0;
let failures = 0;
let problem = 'login_required';
let clockOffset = 0;

/** Never let an account switch or delayed response publish another owner's state. */
function synchronizeAccount() {
    const owner = session.current()?.account.id || null;
    if (owner !== account) {
        account = owner;
        generation++;
        cache = { revision: 0, documents: {}, views: {}, authorities: {} };
        problem = owner ? 'cloud_loading' : 'login_required';
        failures = 0;
        nextAttempt = 0;
        cacheEvents.reset();
        for (const waiter of [...waiters]) waiter.finish(null);
    }
    return owner;
}

/** Atomically publish a complete snapshot or committed command result after validating owner and order. */
function publish(payload, owner, attempt, options = {}) {
    if (
        synchronizeAccount() !== owner ||
        attempt !== generation ||
        !Number.isSafeInteger(payload.revision) ||
        payload.revision < cache.revision
    )
        return false;
    const previous = cache;
    const { mergeSnapshot } = require('./versioned-cache');
    cache = mergeSnapshot(previous, payload, options.command);
    const sent = Date.parse(payload.sent_at || payload.server_time);
    if (Number.isFinite(sent)) clockOffset = sent - Date.now();
    require('./clock').observe(payload.sent_at || payload.server_time);
    cacheEvents.broadcast(
        Object.fromEntries(
            Object.keys(payload.views || {})
                .filter((path) => cache.views[path] === payload.views[path])
                .map((path) => [path, cache.views[path]])
        )
    );
    for (const waiter of [...waiters]) {
        const value = cache.views[waiter.path];
        if (value !== undefined) waiter.finish(structuredClone(value));
    }
    problem = null;
    return true;
}

/** Register recently used local DTOs; opening more overlays does not create more cloud poll loops. */
function watch(path) {
    for (const [key, until] of paths) if (until < Date.now()) paths.delete(key);
    if (!paths.has(path) && paths.size >= 150) throw new Error('too_many_active_views');
    paths.set(path, Date.now() + 30000);
    return view(path);
}

/** Reuse the registered views in mutation responses, without adding an extra cloud poll. */
function watchedPaths() {
    return [...paths].filter(([, until]) => until > Date.now()).map(([path]) => path);
}

/** Initial page requests wait for the shared poll; they never start their own cloud read loop. */
function waitForView(path, signal, timeout = 4500) {
    const cached = watch(path);
    if (cached) return Promise.resolve(cached);
    if (!session.current()) return Promise.resolve(null);
    return new Promise((resolve) => {
        let timer;
        const waiter = {
            path,
            finish(value) {
                clearTimeout(timer);
                waiters.delete(waiter);
                signal?.removeEventListener('abort', abort);
                resolve(value);
            }
        };
        /** A disconnected tab releases its waiter without affecting other local consumers. */
        function abort() {
            waiter.finish(null);
        }

        if (signal?.aborted) return resolve(null);
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => waiter.finish(null), timeout);
        timer.unref();
        waiters.add(waiter);
    });
}

/** Serve the last confirmed local DTO without allowing handlers to mutate the shared cache. */
function view(path) {
    synchronizeAccount();
    return cache.views[path] === undefined ? null : structuredClone(cache.views[path]);
}

/** Presentation adapters may read documents, but every mutation still goes through Express. */
function document(file) {
    synchronizeAccount();
    return cache.documents[file] === undefined ? null : structuredClone(cache.documents[file]);
}

/** Read authority/revision only from authenticated cloud responses. */
function authority(feature) {
    synchronizeAccount();
    return cache.authorities[feature] || null;
}

/** One bounded account-level read buffers immutable pages before any local state becomes visible. */
async function tick(force = false) {
    const owner = synchronizeAccount();
    if (!owner || pending || (!force && Date.now() < nextAttempt)) return pending;
    const attempt = generation;
    nextAttempt = Date.now() + 2000;
    pending = (async () => {
        try {
            for (const [path, until] of paths) if (until < Date.now()) paths.delete(path);
            const started = Date.now();
            let response = await session.call(
                '/v1/features/state/read',
                'POST',
                {
                    after: cache.revision,
                    paths: [...paths.keys()],
                    known_views: Object.fromEntries(
                        [...paths.keys()]
                            .filter((path) => cache.views[path] !== undefined)
                            .map((path) => [
                                path,
                                require('../../../cloud-server/src/domain/view-digest').viewDigest(
                                    cache.views[path]
                                )
                            ])
                    )
                },
                owner
            );
            if (response.status !== 200) throw new Error(response.data.code || 'cloud_unavailable');
            const combined = structuredClone(response.data);
            let pages = 0;
            while (!response.data.complete) {
                if (++pages > 50 || Date.now() - started > 90000)
                    throw new Error('cloud_snapshot_too_large');
                response = await session.call(
                    '/v1/features/state/read',
                    'POST',
                    {
                        snapshot_token: combined.snapshot_token,
                        page: pages
                    },
                    owner
                );
                if (
                    response.status !== 200 ||
                    response.data.revision !== combined.revision ||
                    response.data.page !== pages
                )
                    throw new Error('cloud_snapshot_expired');
                Object.assign(combined.documents, response.data.documents);
                Object.assign(combined.views, response.data.views);
                combined.sent_at = response.data.sent_at || combined.sent_at;
            }
            publish(combined, owner, attempt);
            failures = 0;
        } catch (error) {
            if (attempt === generation) {
                problem = error.message;
                nextAttempt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(++failures, 5));
            }
        } finally {
            pending = null;
        }
    })();
    return pending;
}

/** Expose synchronization health without credentials, feature payloads or chat text. */
function status() {
    synchronizeAccount();
    return {
        code: problem,
        revision: cache.revision,
        in_flight: !!pending,
        clock_offset_ms: clockOffset
    };
}

module.exports = {
    tick,
    watch,
    watchedPaths,
    waitForView,
    view,
    document,
    authority,
    revisions: () => {
        synchronizeAccount();
        return Object.fromEntries(
            Object.entries(cache.authorities).map(([feature, value]) => [feature, value.revision])
        );
    },

    viewRevision: (path) => cache.view_revisions?.[path] ?? 0,

    publish,
    status,
    generation: () => generation,

    intents: () => {
        synchronizeAccount();
        return cache.intents || { commands: {}, name_signup: false };
    }
};
