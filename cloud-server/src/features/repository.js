'use strict';
const { byFeature, byFile } = require('./catalog');
const { sanitize, safeValue } = require('./contracts');
const { saveProgress } = require('./projections/save');
const { loadProgress } = require('./projections/load');
const META = new Set(['seq', 'epoch', 'rseq', 'updatedAt', 'recent', 'liveId', 'runtime']);

/** Serialize commands, collector input, retention and state feeds using the established owner lock. */
async function lockOwner(client, owner) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('icb-owner:' || $1,0))", [
        owner
    ]);
    await client.query('INSERT INTO owner_revisions(owner_id) VALUES($1) ON CONFLICT DO NOTHING', [
        owner
    ]);
    return (
        await client.query(
            'SELECT revision,transaction_timestamp() AS now FROM owner_revisions WHERE owner_id=$1 FOR UPDATE',
            [owner]
        )
    ).rows[0];
}

/** Load only this account's authoritative documents, keeping progress outside presentation settings. */
async function loadDocuments(client, owner) {
    const documents = {};
    for (const row of (
        await client.query('SELECT feature,settings FROM owner_settings WHERE owner_id=$1', [owner])
    ).rows) {
        const entry = byFeature.get(row.feature);
        if (entry) documents[entry.file] = row.settings;
    }
    for (const row of (
        await client.query('SELECT feature,metadata FROM feature_metadata WHERE owner_id=$1', [
            owner
        ])
    ).rows) {
        const entry = byFeature.get(row.feature);
        if (entry) documents[entry.file] = { ...documents[entry.file], ...row.metadata };
    }
    await loadProgress(client, owner, documents, byFeature);
    return documents;
}

/** Project a known domain document into settings, operational metadata and typed entity rows. */
async function saveDocument(client, owner, file, value) {
    const entry = byFile.get(file);
    if (!entry) return;
    const clean = sanitize(value);
    safeValue(clean);
    const handled = await saveProgress(client, owner, entry.feature, clean);
    const settings = {};
    const metadata = {};
    for (const [key, item] of Object.entries(clean)) {
        if (handled.has(key)) continue;
        if (entry.progress.includes(key) || META.has(key)) metadata[key] = item;
        else if (entry.fields.includes(key)) settings[key] = item;
    }
    await client.query(
        `INSERT INTO owner_settings(owner_id,feature,settings) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(owner_id,feature) DO UPDATE SET settings=EXCLUDED.settings`,
        [owner, entry.feature, JSON.stringify(settings)]
    );
    await client.query(
        `INSERT INTO feature_metadata(owner_id,feature,metadata) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(owner_id,feature) DO UPDATE SET metadata=EXCLUDED.metadata`,
        [owner, entry.feature, JSON.stringify(metadata)]
    );
}

/** Publish immutable revision payloads only for cloud-owned documents that actually changed. */
async function saveChanges(client, owner, context, revision, authorities) {
    context.runtime.checkpoint();
    const changed = [...context.dirty].filter(
        (file) => byFile.has(file) && authorities.get(byFile.get(file).feature)?.mode === 'cloud'
    );
    if (!changed.length) return Number(revision);
    const next = Number(revision) + 1;
    for (const file of changed) {
        const entry = byFile.get(file);
        await saveDocument(client, owner, file, context.documents[file]);
        await client.query(
            'UPDATE feature_authority SET revision=$3 WHERE owner_id=$1 AND feature=$2',
            [owner, entry.feature, next]
        );
        await client.query(
            'INSERT INTO feature_changes(owner_id,revision,feature,snapshot) VALUES($1,$2,$3,$4::jsonb)',
            [owner, next, entry.feature, JSON.stringify(sanitize(context.documents[file]))]
        );
    }
    await client.query('UPDATE owner_revisions SET revision=$2 WHERE owner_id=$1', [owner, next]);
    return next;
}

/** Read per-feature authority without trusting any client-provided owner or migration status. */
async function authorities(client, owner) {
    return new Map(
        (
            await client.query(
                'SELECT feature,mode,protocol_version,revision FROM feature_authority WHERE owner_id=$1',
                [owner]
            )
        ).rows.map((row) => [row.feature, { ...row, revision: Number(row.revision) }])
    );
}

module.exports = { lockOwner, loadDocuments, saveDocument, saveChanges, authorities };
