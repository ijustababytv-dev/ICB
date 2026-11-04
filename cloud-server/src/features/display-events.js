'use strict';
const { stableId } = require('../domain/stable-id');
const { sanitize, safeValue } = require('./contracts');

/** Persist bounded occurrence delivery separately from settings; cold starts cannot recreate event identities. */
async function captureDisplayEvents(client, owner, context, revision) {
    const sources = [
        ['paliaclock', context.documents['paliaclock.json']?.runtime?.pcEvents, 15000],
        ['sprites', context.documents['sprites.json']?.runtime?.sjEvents, 120000],
        ['steam', context.documents['steam.json']?.popups, 120000],
        ['oceanfish', context.documents['oceanfish.json']?.runtime?.commands?.list, 120000]
    ];
    const events = [];
    for (const [kind, values, ttl] of sources)
        for (const value of values || []) {
            const at = Number(value.at);
            if (!Number.isFinite(at) || at + ttl <= context.now || at > context.now + 5000)
                continue;
            const payload = sanitize(value);
            safeValue(payload);
            events.push({
                id: stableId(owner, kind, value.id ?? value.n, at),
                kind,
                payload,
                expires_at: new Date(at + ttl).toISOString()
            });
        }
    if (events.length)
        await client.query(
            `INSERT INTO feature_display_events(owner_id,id,revision,kind,payload,expires_at)
        SELECT $1,id,$2,kind,payload,expires_at FROM jsonb_to_recordset($3::jsonb)
        AS t(id uuid,kind text,payload jsonb,expires_at timestamptz) ON CONFLICT DO NOTHING`,
            [owner, revision, JSON.stringify(events)]
        );
}

/** Initial login establishes the cursor without replaying old sounds; every later page uses the same committed watermark. */
async function displayEvents(client, owner, after) {
    if (!after) return [];
    return (
        await client.query(
            'SELECT id,revision,kind,payload,expires_at FROM feature_display_events WHERE owner_id=$1 AND revision>$2 AND expires_at>now() ORDER BY revision,id LIMIT 1000',
            [owner, after]
        )
    ).rows;
}

module.exports = { captureDisplayEvents, displayEvents };
