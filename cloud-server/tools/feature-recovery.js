'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { adminDatabase, databaseAdapter } = require('./admin-db');
const { transaction } = require('../src/activity/db');
const repository = require('../src/features/repository');
const { descriptor } = require('../src/features/catalog');
const { digest } = require('../src/features/contracts');
const { loginName } = require('../src/activity/validation');

/** Freeze one authority and export its current SQL state; never copy a historical local file over current progress. */
async function exportFeature(db, owner, feature, fence = false) {
    const entry = descriptor(feature);
    return transaction(db, async (client) => {
        const clock = await repository.lockOwner(client, owner.id);
        const authority = (await repository.authorities(client, owner.id)).get(feature);
        if (!authority) throw new Error('Feature is not initialized.');
        if (fence) {
            await client.query(
                "UPDATE feature_authority SET mode='migrating' WHERE owner_id=$1 AND feature=$2",
                [owner.id, feature]
            );
            await client.query('UPDATE collector_leases SET expires_at=now() WHERE owner_id=$1', [
                owner.id
            ]);
        }
        const payload = (await repository.loadDocuments(client, owner.id))[entry.file];
        return {
            format: 2,
            owner: owner.id,
            feature,
            revision: Number(clock.revision),
            feature_revision: authority.revision,
            exported_at: clock.now.toISOString(),
            sha256: digest(payload),
            payload
        };
    });
}

/** Resume only while the verified export still matches the current feature; restoring older state requires a separate deliberate command. */
async function resumeFeature(db, owner, exported) {
    descriptor(exported.feature);
    if (exported.owner !== owner.id || exported.sha256 !== digest(exported.payload))
        throw new Error('Export verification failed.');
    await transaction(db, async (client) => {
        await repository.lockOwner(client, owner.id);
        const documents = await repository.loadDocuments(client, owner.id);
        if (digest(documents[descriptor(exported.feature).file]) !== exported.sha256)
            throw new Error('Cloud state changed after export.');
        await client.query(
            "UPDATE feature_authority SET mode='cloud',protocol_version=2 WHERE owner_id=$1 AND feature=$2 AND mode='migrating'",
            [owner.id, exported.feature]
        );
    });
}

/** Run manually with private admin credentials; exports stay in ignored backups. */
async function main() {
    const pool = adminDatabase();
    try {
        const owner = (
            await pool.query('SELECT id FROM accounts WHERE login_name=$1', [
                loginName(process.env.ICB_ACCOUNT_USERNAME || 'ijustababytv')
            ])
        ).rows[0];
        if (!owner) throw new Error('Account required.');
        const db = databaseAdapter(pool);
        if (process.argv[2] === '--restore') {
            const readExport = (file) => {
                const resolved = path.resolve(file);
                if (
                    !resolved.startsWith(
                        path.resolve(__dirname, '../../backups/cloud-exports') + path.sep
                    )
                )
                    throw new Error('Use a private cloud-exports file.');
                return JSON.parse(fs.readFileSync(resolved, 'utf8'));
            };

            const result = await require('./restore-feature').restoreFeature(
                db,
                owner,
                readExport(process.argv[4]),
                readExport(process.argv[3]),
                process.argv[5]
            );
            console.info(JSON.stringify(result));
            return;
        }
        if (process.argv[2] === '--resume') {
            await resumeFeature(db, owner, JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
            console.info('Verified cloud feature resumed.');
            return;
        }
        const feature = process.argv[2];
        const exported = await exportFeature(db, owner, feature, process.argv.includes('--fence'));
        const folder = path.resolve(__dirname, '../../backups/cloud-exports');
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, feature + '-' + Date.now() + '.json');
        fs.writeFileSync(file, JSON.stringify(exported, null, 2), { flag: 'wx' });
        console.info('Verified export saved: ' + file);
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { exportFeature, resumeFeature };
