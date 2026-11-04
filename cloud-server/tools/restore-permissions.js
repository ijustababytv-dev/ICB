'use strict';
const format = require('pg-format');
const { adminDatabase } = require('./admin-db');
const { withSchemaLock, applySchemaPermissions, applyGrants } = require('./schema');

/** A no-owner dump restore transfers only application objects back to the migration role. */
async function restorePermissions(pool) {
    const found = (await pool.query("SELECT to_regnamespace('icb') AS schema")).rows[0];
    if (!found.schema)
        throw new Error('Upgrade the legacy public dump to icb before repairing ownership.');
    await withSchemaLock(pool, async (client) => {
        await client.query('BEGIN');
        try {
            await client.query('ALTER SCHEMA icb OWNER TO icb_migrator');
            const objects = (
                await client.query(
                    "SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='icb' AND c.relkind IN ('r','p','v','m','S')"
                )
            ).rows;
            const kinds = {
                r: 'TABLE',
                p: 'TABLE',
                v: 'VIEW',
                m: 'MATERIALIZED VIEW',
                S: 'SEQUENCE'
            };
            for (const row of objects)
                await client.query(
                    'ALTER ' +
                        kinds[row.relkind] +
                        format(' icb.%I OWNER TO icb_migrator', row.relname)
                );
            const routines = (
                await client.query(
                    "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='icb'"
                )
            ).rows;
            for (const row of routines)
                await client.query(
                    format('ALTER FUNCTION icb.%I(%s) OWNER TO icb_migrator', row.proname, row.args)
                );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
    await applySchemaPermissions(pool);
    await applyGrants(pool);
    const check = (
        await pool.query(
            "SELECT count(*) AS wrong FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='icb' AND c.relkind IN ('r','p','v','m','S') AND pg_get_userbyid(c.relowner)<>'icb_migrator'"
        )
    ).rows[0];
    if (check.wrong !== '0') throw new Error('Restored migration ownership differs.');
}

async function main() {
    const pool = adminDatabase();
    try {
        await restorePermissions(pool);
        console.info('Restored icb ownership and limited service privileges verified.');
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { restorePermissions };
