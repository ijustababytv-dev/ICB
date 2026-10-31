'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('../src/activity/db');
const repository = require('../src/features/repository');
const { descriptor } = require('../src/features/catalog');
const { digest, sanitize, safeValue } = require('../src/features/contracts');
const { uuid } = require('../src/activity/validation');

/** Validate a cloud export; pre-migration JSON and exports from another feature/owner are never accepted. */
function verifyExport(owner, feature, exported) {
    if (
        exported?.format !== 2 ||
        exported.owner !== owner ||
        exported.feature !== feature ||
        exported.sha256 !== digest(exported.payload) ||
        !Number.isFinite(Date.parse(exported.exported_at)) ||
        !Number.isSafeInteger(exported.feature_revision)
    )
        throw new Error('A verified cloud export for this owner and feature is required.');
    safeValue(exported.payload);
}

/** Restore behind an explicit fence, comparing a fresh current export and recording a new immutable rollback boundary. */
async function restoreFeature(db, owner, current, replacement, commandId = randomUUID()) {
    const entry = descriptor(current.feature);
    verifyExport(owner.id, entry.feature, current);
    verifyExport(owner.id, entry.feature, replacement);
    uuid(commandId);
    const feature = 'feature-restore:' + entry.feature;
    const hash = digest({
        current: current.sha256,
        replacement: replacement.sha256,
        revision: current.feature_revision
    });
    return transaction(db, async (client) => {
        const clock = await repository.lockOwner(client, owner.id);
        const old = (
            await client.query(
                'SELECT digest,result FROM feature_commands WHERE owner_id=$1 AND feature=$2 AND command_id=$3',
                [owner.id, feature, commandId]
            )
        ).rows[0];
        if (old) {
            if (old.digest !== hash) throw new Error('Rollback command content changed.');
            return old.result;
        }
        const authority = (await repository.authorities(client, owner.id)).get(entry.feature);
        if (authority?.mode !== 'migrating')
            throw new Error('Fence and export the feature before restoration.');
        const age = clock.now.getTime() - Date.parse(current.exported_at);
        if (
            Number(authority.revision) !== current.feature_revision ||
            age < -5000 ||
            age > 15 * 60000
        )
            throw new Error('Create a fresh fenced current export.');
        const payload = (await repository.loadDocuments(client, owner.id))[entry.file];
        if (digest(payload) !== current.sha256)
            throw new Error('Cloud progress changed after export.');
        const migration = (
            await client.query(
                'SELECT cutover_at FROM feature_migrations WHERE owner_id=$1 AND feature=$2',
                [owner.id, entry.feature]
            )
        ).rows[0];
        if (!migration || Date.parse(replacement.exported_at) < migration.cutover_at.getTime())
            throw new Error('Replacement predates live cloud authority.');
        // Giveaway restoration has extra participation/window rules; use its tested dedicated restore command.
        if (entry.feature === 'giveaway')
            throw new Error(
                'Use the giveaway backup restore API to preserve current window participation.'
            );
        const revision = Number(clock.revision) + 1;
        await client.query(
            'INSERT INTO feature_undo(owner_id,feature,id,backup_name,before_state,after_revision) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
            [
                owner.id,
                entry.feature,
                commandId,
                'rollback_' + commandId + '.json',
                JSON.stringify(payload),
                revision
            ]
        );
        await repository.saveDocument(client, owner.id, entry.file, sanitize(replacement.payload));
        await client.query(
            "UPDATE feature_authority SET mode='cloud',protocol_version=2,revision=$3 WHERE owner_id=$1 AND feature=$2",
            [owner.id, entry.feature, revision]
        );
        await client.query('UPDATE owner_revisions SET revision=$2 WHERE owner_id=$1', [
            owner.id,
            revision
        ]);
        await client.query(
            "INSERT INTO feature_changes(owner_id,revision,feature,snapshot) VALUES($1,$2,$3,'{}'::jsonb)",
            [owner.id, revision, entry.feature]
        );
        const result = {
            ok: true,
            command_id: commandId,
            feature: entry.feature,
            revision,
            restored_sha256: replacement.sha256
        };
        await client.query(
            'INSERT INTO feature_commands(owner_id,feature,command_id,digest,revision,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
            [owner.id, feature, commandId, hash, revision, JSON.stringify(result)]
        );
        return result;
    });
}

module.exports = { restoreFeature };
