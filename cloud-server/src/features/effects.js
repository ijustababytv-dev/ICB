'use strict';
const { normalizeSupport } = require('../domain/support-normalize');
const bulk = require('../activity/bulk');

/** Preserve compact support/audit reporting in the same SQL transaction as its actual balance change. */
async function commitEffects(client, owner, effects) {
    const records = effects
        .map((entry) => normalizeSupport(entry, owner.reporting_timezone, entry.at))
        .filter(Boolean);
    if (!records.length) return;
    const novel = await bulk.novelRecords(client, owner.id, records);
    const viewers = await bulk.viewers(client, owner.id, novel);
    await bulk.events(client, owner.id, novel, viewers);
    await bulk.summaries(client, owner.id, novel, viewers);
    for (const record of novel)
        if (record.ticket_delta !== undefined && record.ticket_delta !== null)
            await client.query(
                `INSERT INTO giveaway_awards(owner_id,id,name_key,source_key,delta,kind,occurred_at)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
                [
                    owner.id,
                    record.id,
                    record.viewer?.username || null,
                    record.id,
                    record.ticket_delta,
                    record.type,
                    record.at
                ]
            );
}

module.exports = { commitEffects };
