'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const { loginName } = require('../src/activity/validation');
const { manifest, validatePayload } = require('../src/activity/feature-state');
const { sanitize } = require('../../local-server/src/activity/state-sync');

/** Import relevant current data files as account backups without restoring or changing local totals. */
async function importState(pool, owner, directory, apply = false) {
    const result = [];
    const collector = randomUUID();
    for (const [key, allowed] of Object.entries(manifest)) {
        const file = path.join(directory, key);
        if (!fs.existsSync(file)) continue;
        const source = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const payload = sanitize(
            Object.fromEntries(
                Object.entries(source).filter(
                    ([field]) => allowed.includes(field) && field !== 'reader'
                )
            )
        );
        validatePayload(payload);
        const content = JSON.stringify(payload);
        const hash = createHash('sha256').update(content).digest('hex');
        if (Buffer.byteLength(content) > 240000)
            throw new Error('state_requires_explicit_size_review');
        if (apply) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO feature_state(owner_id,state_key,revision,sha256,payload,captured_at,collector_id)
                    VALUES($1,$2,$3,$4,$5,now(),$6) ON CONFLICT(owner_id,state_key) DO UPDATE SET
                    revision=EXCLUDED.revision,sha256=EXCLUDED.sha256,payload=EXCLUDED.payload,captured_at=EXCLUDED.captured_at,collector_id=EXCLUDED.collector_id`,
                    [owner.id, key, Date.now() * 1000, hash, payload, collector]
                );
                await client.query(
                    'INSERT INTO state_import_runs(owner_id,state_key,source_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
                    [owner.id, key, hash]
                );
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }
        result.push({ key, sha256: hash, bytes: Buffer.byteLength(content) });
    }
    return result;
}

/** Preview by default; explicit --apply saves only allowlisted, scrubbed current state. */
async function main() {
    const pool = adminDatabase();
    try {
        const owner = (
            await pool.query('SELECT id FROM accounts WHERE login_name=$1', [
                loginName(process.env.ICB_ACCOUNT_USERNAME || 'ijustababytv')
            ])
        ).rows[0];
        if (!owner) throw new Error('account_required');
        const result = await importState(
            pool,
            owner,
            path.resolve(__dirname, '../../data'),
            process.argv.includes('--apply')
        );
        console.info(
            JSON.stringify({
                apply: process.argv.includes('--apply'),
                files: result,
                total_bytes: result.reduce((sum, row) => sum + row.bytes, 0)
            })
        );
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('State import failed; source data was left unchanged.');
        process.exitCode = 1;
    });
module.exports = { importState };
