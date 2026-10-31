'use strict';
const { randomUUID } = require('node:crypto');
const { sanitize, safeValue } = require('./contracts');
const PREFIX = '/icb/data/backups/giveaway/';

/** Existing backup UI contracts operate on owner-scoped SQL snapshots, never disk files. */
async function loadRecovery(client, owner) {
    const result = await client.query(
        "SELECT backup_name,before_state,created_at FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' ORDER BY created_at DESC LIMIT 350",
        [owner]
    );
    return result.rows.map((row) => [
        PREFIX + row.backup_name,
        JSON.stringify(row.before_state),
        row.created_at.getTime()
    ]);
}

/** Create safety snapshots atomically with destructive actions; preserve each category's existing retention. */
async function saveRecovery(client, owner, context, revision) {
    for (const [file, content] of context.backups) {
        if (context.originalBackups.get(file) === content) continue;
        const value = sanitize(JSON.parse(content));
        safeValue(value);
        await client.query(
            `INSERT INTO feature_undo(owner_id,feature,id,backup_name,before_state,after_revision)
            VALUES($1,'giveaway',$2,$3,$4::jsonb,$5) ON CONFLICT(owner_id,feature,backup_name) DO NOTHING`,
            [owner, randomUUID(), file.slice(PREFIX.length), JSON.stringify(value), revision]
        );
    }
    for (const file of context.originalBackups.keys())
        if (!context.backups.has(file))
            await client.query(
                "DELETE FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' AND backup_name=$2",
                [owner, file.slice(PREFIX.length)]
            );
}

module.exports = { loadRecovery, saveRecovery };
