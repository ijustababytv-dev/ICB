'use strict';
// Test-only preload: the normal application never imports this file.
// HTTP/browser tests exercise the real cloud rule factories; PostgreSQL tests exercise the actual SQL store.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const config = require('../../src/config');
const session = require('../../src/cloud/session');
const { createContext } = require('../../../cloud-server/src/features/context');
const {
    executeRequest,
    finalizeDue,
    routeFor,
    readView
} = require('../../../cloud-server/src/features/executor');
const { sanitize, digest } = require('../../../cloud-server/src/features/contracts');
const { owned, byFile } = require('../../../cloud-server/src/features/catalog');
const { intentSpec } = require('../../../cloud-server/src/features/intent-spec');
const { scanAssets } = require('../../src/assets/references');
const store = path.join(config.DATA_DIR, 'fixture-cloud-store.json');
const account = {
    id: '12345678-1234-4234-8234-123456789012',
    username: 'fixture',
    timezone: 'America/Chicago'
};
let saved;
try {
    saved = JSON.parse(fs.readFileSync(store, 'utf8'));
} catch (_) {
    const documents = {};
    for (const entry of owned) {
        try {
            documents[entry.file] = sanitize(
                JSON.parse(fs.readFileSync(path.join(config.DATA_DIR, entry.file), 'utf8'))
            );
        } catch (_) {
            documents[entry.file] = {};
        }
    }
    saved = {
        revision: 1,
        documents,
        authorities: Object.fromEntries(
            owned.map((entry) => [
                entry.feature,
                { mode: 'cloud', protocol_version: 2, revision: 1 }
            ])
        )
    };
}
let assets = scanAssets();
let chain = Promise.resolve();
const receipts = new Map();
const presence = new Set();

/** Keep the test backend durable across a local process restart, without adding a runtime fallback store. */
function commit(context) {
    context.runtime.checkpoint();
    if (context.dirty.size) {
        saved.revision++;
        for (const file of context.dirty) {
            const entry = byFile.get(file);
            if (entry) saved.authorities[entry.feature].revision = saved.revision;
        }
    }
    saved.documents = sanitize(context.documents);
    fs.writeFileSync(store, JSON.stringify(saved));
}

/** Use fresh cloud contexts on every call so warm-process singleton state cannot make a test pass. */
function context() {
    return createContext(saved.documents, {
        now: Date.now(),
        timezone: account.timezone,
        assets
    }).initialize();
}

/** Implement only the upstream contracts needed by isolated local/browser feature tests. */
async function call(route, method, body) {
    const ctx = context();
    if (route === '/v1/features/assets') {
        if (method === 'GET') return { status: 200, data: { ok: true, references: assets } };
        assets = [
            ...new Map(
                [...assets, ...body.references].map((entry) => [entry.relative_path, entry])
            ).values()
        ];
        assets = assets.filter((entry) => !body.removed?.includes(entry.relative_path));
        return { status: 200, data: { ok: true } };
    }
    if (route === '/v1/collectors/claim')
        return {
            status: 200,
            data: { ok: true, expires_at: new Date(Date.now() + 90000).toISOString() }
        };
    if (route === '/v1/activity/batches')
        return {
            status: 200,
            data: { ok: true, batch_id: body.batch_id, accepted: body.records.length }
        };
    if (route.startsWith('/v1/reports/'))
        return {
            status: 200,
            data: {
                ok: true,
                days: [],
                timezone: account.timezone,
                reporting_date: route.split('/').pop(),
                summary: null,
                viewers: [],
                events: []
            }
        };
    if (route === '/v1/features/state/read') {
        finalizeDue(ctx);
        const views = {};
        for (const path of body.paths || [])
            views[path] = sanitize(await readView(ctx, routeFor(path).route[0], path));
        commit(ctx);
        return {
            status: 200,
            data: {
                ok: true,
                complete: true,
                page: 0,
                revision: saved.revision,
                authorities: saved.authorities,
                server_time: new Date().toISOString(),
                sent_at: new Date().toISOString(),
                documents: saved.documents,
                views,
                intents: intentSpec(ctx)
            }
        };
    }
    const match = /^\/v1\/features\/([^/]+)\/commands$/.exec(route);
    if (match) {
        const key = body.command_id;
        const hash = digest(body);
        if (receipts.has(key)) {
            const prior = receipts.get(key);
            if (prior.hash !== hash)
                return { status: 409, data: { code: 'command_content_changed' } };
            return { status: 200, data: { ...prior.result, duplicate: true } };
        }
        const feature = match[1];
        if (
            body.action === 'request' &&
            saved.authorities[feature].revision !== body.expected_revision
        )
            return { status: 409, data: { code: 'stale_feature_revision' } };
        finalizeDue(ctx);
        let reply = { status: 200, payload: { ok: true } };
        if (body.action === 'request') reply = await executeRequest(ctx, feature, body.operands);
        else if (body.action === 'collector_start') {
            ctx.use('resources').resetCountdownStock();
            ctx.use('tradeup').resetBoard();
        } else if (body.action === 'game') {
            const { applyGame } = require('../../../cloud-server/src/features/inputs');
            for (const entry of body.operands.facts)
                applyGame(ctx, { sequence: body.operands.sequence, ...entry });
        } else if (body.action === 'intent') {
            // Interactive intent rules use the production executor; presence/support SQL dedup is covered by PostgreSQL tests.
            const input = body.operands;
            if (input.kind === 'command') {
                const { applyIntent } = require('../../../cloud-server/src/features/inputs');
                reply = await applyIntent(ctx, input, null, { id: account.id });
            } else if (['presence', 'presence_batch'].includes(input.kind)) {
                // Model SQL window uniqueness while exercising the production presence/check-in rules.
                const client = {
                    query: async (_sql, values) => {
                        const key = values.slice(0, 3).join(':');
                        const added = !presence.has(key);
                        presence.add(key);
                        return { rows: [], rowCount: added ? 1 : 0 };
                    }
                };
                reply = await require('../../../cloud-server/src/features/inputs').applyIntent(
                    ctx,
                    input,
                    client,
                    { id: account.id }
                );
            }
        }
        const views = {};
        for (const path of body.read_paths || [])
            views[path] = sanitize(await readView(ctx, routeFor(path).route[0], path));
        const reader_event = feature === 'live' ? ctx.use('state').live.reader?.lastEvent : null;
        commit(ctx);
        const result = {
            ok: true,
            command_id: key,
            revision: saved.revision,
            feature_revision: saved.authorities[feature].revision,
            status: reply.status,
            payload: reply.payload,
            documents: saved.documents,
            views,
            reader_event,
            authorities: saved.authorities,
            intents: intentSpec(ctx),
            server_time: new Date().toISOString(),
            sent_at: new Date().toISOString()
        };
        receipts.set(key, { hash, result: structuredClone(result) });
        return { status: 200, data: result };
    }
    return { status: 404, data: { code: 'fixture_route_not_found' } };
}

session.current = () => ({ account, base: 'https://fixture.invalid', token: 'test-only-token' });

session.call = (route, method = 'GET', body = {}) => {
    const pending = chain.then(async () => {
        try {
            return await call(route, method, body);
        } catch (error) {
            return {
                status: error.status || 503,
                data: { code: error.code || error.message, error: error.detail || error.message }
            };
        }
    });
    chain = pending.then(
        () => {},
        () => {}
    );
    return pending;
};

// Only the auth-flow preload imports this transport; production never imports test helpers.
module.exports = { call, account };
