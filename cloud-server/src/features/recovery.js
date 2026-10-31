'use strict';
const { randomUUID } = require('node:crypto');
const { sanitize, safeValue } = require('./contracts');
const PREFIX = '/icb/data/backups/giveaway/';

/** Existing backup UI contracts operate on owner-scoped SQL snapshots, never disk files. */
async function loadRecovery(client, owner, fullName = null) {
    const result = await client.query(
        "SELECT backup_name,backup_metadata,CASE WHEN backup_name=$2::text THEN before_state ELSE NULL END AS before_state,created_at FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' ORDER BY created_at DESC LIMIT 350",
        [owner, fullName]
    );
    const tuples = result.rows.map((row) => [
        PREFIX + row.backup_name,
        JSON.stringify(row.before_state || {}),
        row.created_at.getTime()
    ]);
    tuples.metadata = Object.fromEntries(
        result.rows.map((row) => [
            row.backup_name,
            {
                file: row.backup_name,
                kind: row.backup_name.split('_')[0],
                at: row.created_at.toISOString(),
                bytes: row.backup_metadata.bytes || 0,
                entrants: row.backup_metadata.entrants || 0,
                unicorns: row.backup_metadata.unicorns || 0,
                winners: row.backup_metadata.winners || 0
            }
        ])
    );
    return tuples;
}

/** Calculate backup-list counts once when a snapshot is created, rather than reading every historical payload. */
function backupMetadata(value) {
    const entries = Object.values(value.entrants || {});
    return {
        bytes: Buffer.byteLength(JSON.stringify(value)),
        entrants: entries.length,
        winners: (value.winners || []).length,
        unicorns: entries.reduce(
            (sum, item) =>
                sum +
                ['chatTickets', 'subTickets', 'giftTickets', 'bitsTickets', 'manualTickets'].reduce(
                    (n, key) => n + (Number(item[key]) || 0),
                    0
                ),
            0
        )
    };
}

/** Create safety snapshots atomically with destructive actions; preserve each category's existing retention. */
async function saveRecovery(client, owner, context, revision) {
    for (const file of context.dirty) {
        if (!/^sprites-[a-z0-9-]+\.json$/.test(file)) continue;
        const value = sanitize(context.documents[file]);
        safeValue(value);
        await client.query(
            `INSERT INTO feature_undo(owner_id,feature,id,backup_name,before_state,after_revision)
            VALUES($1,'sprites',$2,$3,$4::jsonb,$5) ON CONFLICT(owner_id,feature,backup_name) DO NOTHING`,
            [owner, randomUUID(), file, JSON.stringify(value), revision]
        );
    }
    for (const [file, content] of context.backups) {
        if (context.originalBackups.get(file) === content) continue;
        const value = sanitize(JSON.parse(content));
        safeValue(value);
        await client.query(
            `INSERT INTO feature_undo(owner_id,feature,id,backup_name,before_state,after_revision,backup_metadata)
            VALUES($1,'giveaway',$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(owner_id,feature,backup_name) DO NOTHING`,
            [
                owner,
                randomUUID(),
                file.slice(PREFIX.length),
                JSON.stringify(value),
                revision,
                JSON.stringify(backupMetadata(value))
            ]
        );
    }
    for (const file of context.originalBackups.keys())
        if (!context.backups.has(file))
            await client.query(
                "DELETE FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' AND backup_name=$2",
                [owner, file.slice(PREFIX.length)]
            );
}

module.exports = { loadRecovery, saveRecovery, backupMetadata };
