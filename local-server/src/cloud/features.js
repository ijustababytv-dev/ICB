'use strict';
const { randomUUID } = require('node:crypto');
const session = require('./session');
const feed = require('./state-feed');
const { routeFor } = require('../../../cloud-server/src/features/executor');
const { readBody } = require('../http/body');
const { sendJson } = require('../http/response');

/** Normalize per-browser delivery cursors locally rather than registering unbounded cloud view URLs. */
function canonicalPath(url) {
    const target = new URL(url.pathname + url.search, 'http://icb.invalid');
    for (const key of ['since', '_', 't', 'ts', 'v']) target.searchParams.delete(key);
    target.searchParams.sort();
    return target.pathname + target.search;
}

/** Retry only the identical command after a lost response; a stale edit is returned to its operator. */
async function command(feature, operands, action = 'request', extra = {}) {
    const owner = session.current()?.account.id;
    if (!owner) throw Object.assign(new Error('login_required'), { status: 401 });
    const authority = feed.authority(feature);
    if (authority?.mode !== 'cloud')
        throw Object.assign(new Error('feature_not_migrated'), { status: 409 });
    const attempt = feed.generation();
    const body = {
        protocol_version: 2,
        command_id: randomUUID(),
        expected_revision: authority.revision,
        action,
        operands,
        ...extra
    };
    let response;
    for (let retry = 0; retry < 2; retry++) {
        try {
            response = await session.call(
                '/v1/features/' + encodeURIComponent(feature) + '/commands',
                'POST',
                body,
                owner
            );
            break;
        } catch (error) {
            if (retry || session.current()?.account.id !== owner) throw error;
        }
    }
    if (response.status !== 200)
        throw Object.assign(new Error(response.data.code || 'cloud_unavailable'), {
            status: response.status
        });
    const result = response.data;
    feed.publish(
        {
            ...result,
            authorities: { [feature]: { ...authority, revision: result.feature_revision } }
        },
        owner,
        attempt
    );
    return result;
}

/** Preserve existing local API URLs while all migrated mutations execute under cloud owner locks. */
async function handleFeature(req, res, url) {
    let feature;
    try {
        feature = routeFor(url.pathname).route[0];
    } catch (_) {
        return false;
    }
    try {
        const path = canonicalPath(url);
        if (req.method === 'GET') {
            const payload = feed.watch(path);
            if (!payload)
                return sendJson(res, 503, {
                    ok: false,
                    code: feed.status().code || 'cloud_loading'
                });
            const since = Number(url.searchParams.get('since')) || 0;
            if (Array.isArray(payload.events))
                payload.events = payload.events.filter(
                    (event) => Number(event.id ?? event.seq) > since
                );
            return sendJson(res, 200, payload);
        }
        if (!require('../routes/cloud-auth').trusted(req))
            return sendJson(res, 403, { ok: false, code: 'local_origin_required' });
        const values = await readBody(req);
        if (path.endsWith('/test') || (feature === 'hunt' && values.test)) {
            const test = feature === 'hunt' ? values.test : values;
            test.intent = require('../domain/feature-intents').parseIntent(
                test.text,
                feed.intents()
            );
            if (!test.intent)
                throw Object.assign(new Error('recognized_command_required'), { status: 400 });
            delete test.text;
        }
        const result = await command(feature, { path, method: req.method, values });
        return sendJson(res, result.status, result.payload);
    } catch (error) {
        return sendJson(res, error.status || 503, { ok: false, code: error.message });
    }
}

module.exports = { command, canonicalPath, handleFeature };
