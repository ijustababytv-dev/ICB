'use strict';
const { adminDatabase } = require('./admin-db');
const { definition } = require('./schema');

/** A release cannot start against missing or mismatched administrative objects. No DDL runs here. */
async function preflight(pool) {
    const expected = definition();
    const versions = (await pool.query('SELECT version,sha256 FROM schema_migrations')).rows;
    for (const [version, sha] of Object.entries(expected.covers))
        if (!versions.some((row) => row.version === version && row.sha256 === sha))
            throw new Error('Apply and verify the current database upgrades before releasing.');
    const count = (
        await pool.query(
            "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'"
        )
    ).rows[0].n;
    if (Number(count) !== expected.objects.filter((file) => file.startsWith('tables/')).length)
        throw new Error('Database object inventory does not match this release.');
}

async function main() {
    const pool = adminDatabase();
    try {
        await preflight(pool);
        console.info('Release database preflight passed.');
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { preflight };
