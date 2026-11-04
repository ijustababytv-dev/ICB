'use strict';
const { adminDatabase } = require('./admin-db');

/** Prune bounded event/session pages without deleting summaries or deduplication receipts. */
async function maintain(pool) {
    const counts = {};
    for (const table of ['support_events', 'giveaway_audit_events']) {
        const result = await pool.query(`DELETE FROM ${table} WHERE ctid IN
            (SELECT ctid FROM ${table} WHERE occurred_at<now()-interval '365 days' ORDER BY occurred_at LIMIT 1000)`);
        counts[table] = result.rowCount;
    }
    for (const table of ['sessions', 'login_attempts']) {
        const result = await pool.query(`DELETE FROM ${table} WHERE ctid IN
            (SELECT ctid FROM ${table} WHERE expires_at<now() ORDER BY expires_at LIMIT 1000)`);
        counts[table] = result.rowCount;
    }
    return counts;
}

/** Keep retention manual until actual table growth warrants scheduling. */
async function main() {
    const pool = adminDatabase();
    try {
        console.info(JSON.stringify(await maintain(pool)));
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('Maintenance failed.');
        process.exitCode = 1;
    });
module.exports = { maintain };
