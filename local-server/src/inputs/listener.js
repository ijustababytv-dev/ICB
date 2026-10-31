'use strict';
const { readBody } = require('../http/body');
const { sendJson } = require('../http/response');
const { listenerStatus } = require('../giveaway/state');
const collector = require('../activity/collector');

/** The Meld listener owns only a local relay lease and connection diagnostics. */
async function handleListener(req, res) {
    const body = await readBody(req, 4096);
    if (body.listener_id && !require('../activity/listener-lease').claim(body.listener_id))
        return sendJson(res, 200, { ok: true, collecting: false });
    listenerStatus.lastSeen = new Date().toISOString();
    listenerStatus.firehose = ['connected', 'connecting', 'no-sdk'].includes(body.firehose)
        ? body.firehose
        : 'unknown';
    const health = require('../health').health;
    const reload = !!health.listenerReload;
    health.listenerReload = false;
    return sendJson(res, 200, { ok: true, reload, collecting: collector.canCollect() });
}

/** Old local event URLs are normalized into the same ordered cloud input path. */
async function handleLegacyEvent(req, res) {
    const body = await readBody(req, 262144);
    const activity = require('../routes/activity');
    const reply =
        body.type === 'chat'
            ? {
                  status: 202,
                  payload: {
                      ok: true,
                      ...activity.acceptChat({ ...body, data: { sender: body.username } })
                  }
              }
            : activity.acceptSupport(body);
    return sendJson(res, reply.status || 200, reply.payload || { ok: true, ...reply });
}

module.exports = { handleListener, handleLegacyEvent };
