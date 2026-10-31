'use strict';
const path = require('node:path');
const { adminDatabase, databaseAdapter } = require('./admin-db');
const { buildImport, stableId, hashFile } = require('../../local-server/tools/activity-import');
const { ingest } = require('../src/activity/ingest');
const { loginName } = require('../src/activity/validation');

/** Import a frozen source through the same transaction/deduplication path, without calling local awards. */
async function importHistory(pool, owner, file, cutoff, apply = false) {
    const plan = await buildImport(file, cutoff, owner.reporting_timezone);
    if (!apply) return plan.stats;
    const id = stableId(plan.hash, 'migration-run');
    const existing = await pool.query(
        'SELECT source_sha256 FROM migration_runs WHERE owner_id=$1 AND source_file=$2',
        [owner.id, path.basename(file)]
    );
    if (existing.rows.some((row) => row.source_sha256 !== plan.hash))
        throw new Error('source_already_imported_with_different_hash');
    await pool.query(
        `INSERT INTO migration_runs(id,owner_id,source_file,source_sha256,importer_version,cutoff_at,status,verification)
        VALUES($1,$2,$3,$4,$5,$6,'prepared',$7) ON CONFLICT(owner_id,source_sha256,importer_version)
        DO UPDATE SET status='prepared',verification=EXCLUDED.verification`,
        [id, owner.id, path.basename(file), plan.hash, plan.version, cutoff, plan.stats]
    );
    if ((await hashFile(file)) !== plan.hash) throw new Error('source_changed_before_upload');
    let chunk = [];
    let number = 0;

    /** Stable chunk keys make a repeated or interrupted import safe after commit. */
    async function flush() {
        if (!chunk.length) return;
        await ingest(databaseAdapter(pool), owner, {
            schema_version: 1,
            batch_id: stableId(plan.hash, 'batch:' + number++),
            collector_id: id,
            sealed_at: cutoff,
            migration_id: id,
            records: chunk
        });
        chunk = [];
    }

    for (const record of plan.records) {
        if (chunk.length >= 500 || Buffer.byteLength(JSON.stringify([...chunk, record])) > 245000)
            await flush();
        chunk.push(record);
    }
    await flush();
    for (const day of new Set(plan.records.map((record) => record.day))) {
        await pool.query(
            `INSERT INTO daily_summary_quality(owner_id,reporting_date,partial,details) VALUES($1,$2,$3,$4)
            ON CONFLICT(owner_id,reporting_date) DO UPDATE SET partial=daily_summary_quality.partial OR EXCLUDED.partial,
            details=daily_summary_quality.details || EXCLUDED.details`,
            [owner.id, day, plan.stats.partial, { [path.basename(file)]: plan.stats }]
        );
    }
    await pool.query('UPDATE migration_runs SET status=$1 WHERE id=$2 AND owner_id=$3', [
        plan.stats.partial ? 'partial' : 'complete',
        id,
        owner.id
    ]);
    return plan.stats;
}

/** Require explicit --apply and a cutover boundary; report only aggregate verification results. */
async function main() {
    const [file, cutoff] = process.argv.slice(2).filter((arg) => arg !== '--apply');
    if (!file || !cutoff) throw new Error('Usage: import-history.js FILE CUTOFF_ISO [--apply]');
    const pool = adminDatabase();
    try {
        const owner = (
            await pool.query('SELECT * FROM accounts WHERE login_name=$1', [
                loginName(process.env.ICB_ACCOUNT_USERNAME || 'ijustababytv')
            ])
        ).rows[0];
        if (!owner) throw new Error('account_required');
        console.info(
            JSON.stringify(
                await importHistory(pool, owner, file, cutoff, process.argv.includes('--apply'))
            )
        );
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.code || error.message);
        process.exitCode = 1;
    });
module.exports = { importHistory };
