'use strict';
const { fields, uuid, text } = require('../activity/validation');
const { fail } = require('../activity/errors');
const { digest } = require('./contracts');
const { applyGame } = require('./inputs');

/** Store a boot boundary in the same transaction as the intentional startup-stock reset. */
async function startSession(client, owner, body, context) {
    fields(body.operands, ['sequence', 'source_key', 'at', 'session_id']);
    uuid(body.operands.session_id);
    await client.query(
        'UPDATE game_sessions SET ended_at=$2 WHERE owner_id=$1 AND ended_at IS NULL',
        [owner.id, body.operands.at]
    );
    await client.query(
        'INSERT INTO game_sessions(owner_id,session_id,collector_id,started_at) VALUES($1,$2,$3,$4)',
        [owner.id, body.operands.session_id, body.collector_id, body.operands.at]
    );
    context.use('resources').resetCountdownStock();
    context.use('tradeup').resetBoard();
    return { status: 200, payload: { ok: true } };
}

/** Per-line identities survive different batching boundaries after a crash, restart or rotated log. */
async function applyGameBatch(client, owner, body, context) {
    const input = body.operands;
    fields(input, ['sequence', 'source_key', 'at', 'session_id', 'facts']);
    uuid(input.session_id);
    if (!Array.isArray(input.facts) || !input.facts.length || input.facts.length > 200)
        throw fail(400, 'invalid_game_batch');
    const session = await client.query(
        'SELECT started_at,ended_at FROM game_sessions WHERE owner_id=$1 AND session_id=$2 AND collector_id=$3',
        [owner.id, input.session_id, body.collector_id]
    );
    if (!session.rowCount) throw fail(409, 'game_session_required');
    const rows = input.facts.map((entry) => {
        fields(entry, ['source_key', 'at', 'fact']);
        text(entry.source_key, 240);
        const at = Date.parse(entry.at);
        if (
            !Number.isFinite(at) ||
            at < Date.UTC(2020, 0, 1) ||
            at > context.now + 5000 ||
            at < session.rows[0].started_at.getTime() - 5000 ||
            (session.rows[0].ended_at && at > session.rows[0].ended_at.getTime() + 5000)
        )
            throw fail(400, 'invalid_timestamp');
        return { source_key: entry.source_key, digest: digest(entry.fact), occurred_at: entry.at };
    });
    if (new Set(rows.map((row) => row.source_key)).size !== rows.length)
        throw fail(400, 'duplicate_game_fact');
    const accepted = await client.query(
        `INSERT INTO game_event_receipts(owner_id,source_key,digest,collector_id,session_id,occurred_at)
        SELECT $1,t.source_key,t.digest,$2,$3,t.occurred_at FROM jsonb_to_recordset($4::jsonb) AS t(source_key text,digest text,occurred_at timestamptz)
        ON CONFLICT DO NOTHING RETURNING source_key`,
        [owner.id, body.collector_id, input.session_id, JSON.stringify(rows)]
    );
    const saved = await client.query(
        'SELECT source_key,digest FROM game_event_receipts WHERE owner_id=$1 AND source_key=ANY($2::text[])',
        [owner.id, rows.map((row) => row.source_key)]
    );
    const hashes = new Map(saved.rows.map((row) => [row.source_key, row.digest]));
    if (rows.some((row) => hashes.get(row.source_key) !== row.digest))
        throw fail(409, 'game_source_content_changed');
    const novel = new Set(accepted.rows.map((row) => row.source_key));
    for (const entry of input.facts)
        if (novel.has(entry.source_key)) applyGame(context, { sequence: input.sequence, ...entry });
    return { status: 200, payload: { ok: true, accepted: novel.size } };
}

module.exports = { startSession, applyGameBatch };
