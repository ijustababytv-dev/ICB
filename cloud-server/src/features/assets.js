'use strict';
const { fields, uuid, integer } = require('../activity/validation');
const { transaction } = require('../activity/db');
const { fail } = require('../activity/errors');
const { lockOwner } = require('./repository');

/** Cloud validation sees only safe relative filenames and file metadata, never artwork bytes or PC paths. */
async function saveAssets(db, owner, body) {
    fields(body, ['collector_id', 'references']);
    uuid(body.collector_id);
    if (!Array.isArray(body.references) || body.references.length > 50000)
        throw fail(413, 'too_many_assets');
    for (const item of body.references) {
        fields(item, ['relative_path', 'modified_at', 'bytes']);
        if (
            typeof item.relative_path !== 'string' ||
            item.relative_path.length > 350 ||
            !/^assets\/(?:[^.\/\\\x00-\x1f][^\/\\\x00-\x1f]*\/)*[^\/\\\x00-\x1f]+\.(?:png|jpe?g|webp|gif|svg|mp3|wav|ogg|m4a)$/i.test(
                item.relative_path
            ) ||
            item.relative_path.split('/').some((part) => part === '..' || part.startsWith('.'))
        )
            throw fail(400, 'invalid_asset_reference');
        integer(item.modified_at, 0, Number.MAX_SAFE_INTEGER);
        integer(item.bytes, 0, 1000000000);
    }
    return transaction(db, async (client) => {
        await lockOwner(client, owner.id);
        const lease = await client.query(
            'SELECT 1 FROM collector_leases WHERE owner_id=$1 AND collector_id=$2 AND expires_at>now()',
            [owner.id, body.collector_id]
        );
        if (!lease.rowCount) throw fail(409, 'collector_lease_expired');
        await client.query(
            `INSERT INTO asset_references(owner_id,relative_path,modified_at,bytes)
            SELECT $1,relative_path,modified_at,bytes FROM jsonb_to_recordset($2::jsonb)
            AS t(relative_path text,modified_at bigint,bytes bigint)
            ON CONFLICT(owner_id,relative_path) DO UPDATE SET modified_at=EXCLUDED.modified_at,bytes=EXCLUDED.bytes`,
            [owner.id, JSON.stringify(body.references)]
        );
        return { ok: true };
    });
}

/** Load metadata for pure filename selection and UI lists; no filesystem is available to Lambda models. */
async function loadAssets(client, owner) {
    return (
        await client.query(
            'SELECT relative_path,modified_at,bytes FROM asset_references WHERE owner_id=$1',
            [owner]
        )
    ).rows;
}

module.exports = { saveAssets, loadAssets };
