'use strict';
const { readBody } = require('../http/body');
const { sendJson } = require('../http/response');
const { relayChat } = require('../activity/chat-relay');
const collector = require('../activity/collector');
const health = require('../health');
const session = require('../cloud/session');
const inputs = require('../cloud/inputs');

/** Count messages and preserve transient visuals; only recognized semantic operands cross the cloud boundary. */
function acceptChat(body) {
    collector.requireCapacity();
    if (!require('../activity/listener-lease').permits(body.listener_id))
        throw new Error('duplicate_listener');
    const data = body.data;
    if (!data || typeof data.sender !== 'string' || !data.sender.trim() || data.sender.length > 80)
        throw new Error('invalid_chat_sender');
    if (!collector.acceptSource(body.platform || 'twitch', body.source_id, 'chat', false))
        return { duplicate: true };
    const identity = {
        username: data.sender,
        platform: body.platform,
        platform_user_id: body.platform_user_id,
        source_id: body.source_id
    };
    inputs.notePresence(identity);
    relayChat(data, { platform: body.platform, source_id: body.source_id });
    if (!collector.chat(identity)) throw new Error('outbox_full');
    collector.acceptSource(body.platform || 'twitch', body.source_id, 'chat');
    health.healthNoteRaw('chat', data);
    return { accepted: true, pending: true };
}

/** Queue minimal supporter facts; one cloud transaction decides awards and reporting effects. */
function acceptSupport(body) {
    collector.requireCapacity();
    if (!require('../activity/listener-lease').permits(body.listener_id))
        throw new Error('duplicate_listener');
    if (!collector.acceptSource(body.platform || 'twitch', body.source_id, body.type, false))
        return { duplicate: true };
    const command_id = inputs.support(body);
    collector.acceptSource(body.platform || 'twitch', body.source_id, body.type);
    require('../avatars').avEvent(body.type, body.username, body);
    require('../neon-chat').neonChatEvent(body.type, body.username, body);
    return { status: 202, payload: { ok: true, pending: true, command_id } };
}

/** Serve minimal relay endpoints and PostgreSQL-backed report proxies, never JSONL reports. */
async function handleActivityApi(req, res, url) {
    const pathname = url.pathname.replace(/\/$/, '');
    if (
        req.method === 'GET' &&
        /^\/api\/activity\/reports\/(?:days(?:\/\d{4}-\d{2}-\d{2})?|viewers\/[a-f0-9-]{36}(?:\/lifetime)?)$/.test(
            pathname
        )
    ) {
        if (!session.current())
            return sendJson(res, 503, { ok: false, code: 'cloud_login_required' });
        try {
            const result = await session.call(
                pathname.replace('/api/activity/reports/', '/v1/reports/') + url.search
            );
            return sendJson(res, result.status, { ...result.data, sync: collector.status() });
        } catch (_error) {
            return sendJson(res, 503, { ok: false, code: 'cloud_offline' });
        }
    }
    if (req.method === 'POST' && pathname === '/api/activity/chat') {
        const body = await readBody(req, 256 * 1024);
        return sendJson(res, 200, { ok: true, ...acceptChat(body) });
    }
    if (req.method === 'POST' && pathname === '/api/activity/support') {
        const result = acceptSupport(await readBody(req, 256 * 1024));
        return sendJson(res, result.status || 200, result.payload || { ok: true, ...result });
    }
    if (req.method === 'POST' && pathname === '/api/activity/raw') {
        const body = await readBody(req, 256 * 1024);
        // Compatibility with already-running listener pages: live fan-out only, no archive.
        health.healthNoteRaw(String(body.kind || '').slice(0, 60), body.data);
        const owner = session.current()?.account.id;
        const command =
            body.kind === 'chat' && typeof body.data?.sender === 'string'
                ? relayChat(body.data)
                : null;
        const confirmed = !command || (await collector.waitForAck(command, owner));
        return sendJson(res, confirmed ? 200 : 202, { ok: true, pending: !confirmed });
    }
    if (
        req.method === 'GET' &&
        ['/api/activity/nights', '/api/activity/night'].includes(pathname)
    ) {
        const today = require('../domain/reporting-day').reportingDay(
            Date.now(),
            session.current()?.account.timezone || 'America/Chicago'
        );
        const date = url.searchParams.get('date') || today;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
            return sendJson(res, 400, { ok: false, code: 'invalid_date' });
        if (!session.current())
            return sendJson(res, 503, {
                ok: false,
                code: 'cloud_login_required',
                sync: collector.status()
            });
        try {
            const result = await session.call(
                pathname.endsWith('/nights') ? '/v1/reports/days' : '/v1/reports/days/' + date
            );
            const body =
                pathname.endsWith('/nights') && result.status === 200
                    ? {
                          ok: true,
                          nights: result.data.days.map((row) =>
                              String(row.reporting_date).slice(0, 10)
                          ),
                          tonight: today
                      }
                    : result.data;
            return sendJson(res, result.status, { ...body, sync: collector.status() });
        } catch (_error) {
            return sendJson(res, 503, {
                ok: false,
                code: 'cloud_offline',
                sync: collector.status()
            });
        }
    }
    return sendJson(res, 404, { ok: false, code: 'not_found' });
}

module.exports = { handleActivityApi, acceptChat, acceptSupport };
