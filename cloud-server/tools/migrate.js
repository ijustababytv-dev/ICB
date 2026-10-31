'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { adminDatabase } = require('./admin-db');

/** Apply ordered, checksum-checked SQL under an advisory lock; never run on Lambda startup. */
async function migrate(pool, directory = path.resolve(__dirname, '../../database/migrations')) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock(19770731)');
        await client.query(
            'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())'
        );
        for (const file of fs
            .readdirSync(directory)
            .filter((name) => /^\d{3}[-a-z0-9]*\.sql$/.test(name))
            .sort()) {
            const sql = fs.readFileSync(path.join(directory, file), 'utf8');
            const hash = createHash('sha256').update(sql).digest('hex');
            const previous = await client.query(
                'SELECT sha256 FROM schema_migrations WHERE version=$1',
                [file]
            );
            if (previous.rowCount) {
                if (previous.rows[0].sha256 !== hash)
                    throw new Error('Applied migration checksum changed: ' + file);
                continue;
            }
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)', [
                    file,
                    hash
                ]);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    } finally {
        await client.query('SELECT pg_advisory_unlock(19770731)');
        client.release();
    }
}

/** Run private administrative migrations and report only a generic success/failure. */
async function main() {
    const pool = adminDatabase();
    try {
        await migrate(pool);
        console.info('Database migrations applied.');
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('Migration failed; inspect migration version and database access.');
        process.exitCode = 1;
    });
module.exports = { migrate };
