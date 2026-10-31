'use strict';
const { owned } = require('./catalog');
const { createContext } = require('./context');
const { definitions } = require('./context/config');
const { sanitize, digest } = require('./contracts');
const repository = require('./repository');

/** Only a genuinely new account gets defaults; existing recovery copies or activity always require an explicit cutover. */
async function bootstrapOwner(client, owner, clock, authorities) {
    if (authorities.size) return false;
    const existing = await client.query(
        `SELECT 1 FROM feature_state WHERE owner_id=$1
        UNION ALL SELECT 1 FROM migration_runs WHERE owner_id=$1
        UNION ALL SELECT 1 FROM activity_receipts WHERE owner_id=$1 LIMIT 1`,
        [owner.id]
    );
    if (existing.rowCount) return false;
    const documents = createContext(
        {},
        { now: clock.now.getTime(), timezone: owner.reporting_timezone }
    ).initialize().documents;
    const defaults = definitions()['runtime-defaults.json'];
    documents['settings.json'] ||= defaults.DEFAULT_SETTINGS;
    documents['live.json'] ||= defaults.DEFAULT_LIVE;
    documents['todos.json'] ||= { daily: [], weekly: [] };
    const revision = Number(clock.revision) + 1;
    for (const entry of owned) {
        const value = sanitize(documents[entry.file] || {});
        await repository.saveDocument(client, owner.id, entry.file, value);
        await client.query(
            "INSERT INTO feature_authority(owner_id,feature,mode,protocol_version,revision) VALUES($1,$2,'cloud',2,$3)",
            [owner.id, entry.feature, revision]
        );
        await client.query(
            "INSERT INTO feature_migrations(owner_id,feature,source_sha256,cutover_at,input_watermark,revision) VALUES($1,$2,$3,now(),'new-account-defaults',$4)",
            [owner.id, entry.feature, digest(value), revision]
        );
        await client.query(
            'INSERT INTO feature_changes(owner_id,revision,feature,snapshot) VALUES($1,$2,$3,$4::jsonb)',
            [owner.id, revision, entry.feature, '{}']
        );
        authorities.set(entry.feature, {
            feature: entry.feature,
            mode: 'cloud',
            protocol_version: 2,
            revision
        });
    }
    await client.query('UPDATE owner_revisions SET revision=$2 WHERE owner_id=$1', [
        owner.id,
        revision
    ]);
    clock.revision = revision;
    return true;
}

module.exports = { bootstrapOwner };
