'use strict';
const format = require('pg-format');

/** Compare all application rows without printing secrets, names, account data, or full snapshots. */
async function tableFingerprints(pool) {
    const tables = (
        await pool.query(
            "SELECT tablename FROM pg_tables WHERE schemaname='icb' ORDER BY tablename"
        )
    ).rows;
    const result = {};
    for (const { tablename } of tables)
        result[tablename] = (
            await pool.query(
                format(
                    `SELECT count(*)::text AS rows,
        md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS fingerprint FROM icb.%I t`,
                    tablename
                )
            )
        ).rows[0];
    return result;
}

module.exports = { tableFingerprints };
