'use strict';
const session = require('./session');
const events = require('../events');
const { catalog } = require('../../../cloud-server/src/features/catalog');
const paths = new Map();
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
    }
    return owner;
}

/** Atomically publish a complete snapshot or committed command result after validating owner and order. */
function publish(payload, owner, attempt) {
    if (
        synchronizeAccount() !== owner ||
        attempt !== generation ||
        payload.revision < cache.revision
    )
        return false;
    const previous = cache;
    cache = {
        revision: payload.revision,
        documents: { ...previous.documents, ...payload.documents },
        views: { ...previous.views, ...payload.views },
        authorities: { ...previous.authorities, ...payload.authorities },
        intents: payload.intents || previous.intents
    };
    clockOffset = Date.parse(payload.server_time) - Date.now();
    for (const [file, value] of Object.entries(payload.documents || {})) {
        const entry = catalog.find((item) => item.file === file);
        if (entry) events.broadcast(entry.feature, value);
    }
    problem = null;
    return true;
}

/** Register recently used local DTOs; opening more overlays does not create more cloud poll loops. */
function watch(path) {
    paths.set(path, Date.now() + 30000);
    return view(path);
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
                    paths: [...paths.keys()]
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
    view,
    document,
    authority,
    publish,
    status,
    generation: () => generation,

    intents: () => {
        synchronizeAccount();
        return cache.intents || { commands: {}, name_signup: false };
    }
};
