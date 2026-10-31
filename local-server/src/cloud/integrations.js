'use strict';
const { randomUUID } = require('node:crypto');
const session = require('./session');

/** Strip provider credentials before constructing feature commands; only the scoped secret endpoint receives them. */
async function prepareIntegration(path, values, expectedRevision) {
    const owner = session.current()?.account.id;
    if (!owner) throw new Error('login_required');
    let method;
    let body;
    if (path === '/api/steam/settings' && values.apiKey) {
        method = 'PUT';
        body = { command_id: randomUUID(), api_key: values.apiKey };
    } else if (path === '/api/steam/forget') {
        method = 'DELETE';
        body = { command_id: randomUUID() };
    }
    delete values.apiKey;
    let revision = expectedRevision;
    if (method) {
        body.expected_revision = expectedRevision;
        const result = await session.call('/v1/integrations/steam/secret', method, body, owner);
        if (result.status !== 200)
            throw Object.assign(new Error(result.data.code || 'integration_unavailable'), {
                status: result.status
            });
        if (
            result.data.command_id !== body.command_id ||
            !Number.isSafeInteger(result.data.feature_revision)
        )
            throw new Error('integration_ack_mismatch');
        revision = result.data.feature_revision;
    }
    return { values, revision };
}

module.exports = { prepareIntegration };
