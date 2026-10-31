'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase } = require('./admin-db');
const { createSchema } = require('./schema');

/** Remove only the selected schema qualifier so independently created structures can be compared. */
function unqualify(sql, schema) {
    if (sql === null) return null;
    return sql
        .split('"' + schema + '".')
        .join('')
        .split(schema + '.')
        .join('');
}

/** Inspect definitions only, never table contents, role passwords, or connection credentials. */
async function catalog(pool, schema) {
    const columns = await pool.query(
        `SELECT c.relname AS table_name,a.attnum AS position,a.attname AS column_name,
        format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
        pg_get_expr(d.adbin,d.adrelid) AS default_expression
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
        [schema]
    );
    const constraints = await pool.query(
        `SELECT t.relname AS table_name,c.conname AS name,c.contype AS type,
        pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 ORDER BY t.relname,c.conname`,
        [schema]
    );
    const indexes = await pool.query(
        'SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
        [schema]
    );
    const views = await pool.query(
        `SELECT c.relname AS name,c.relkind AS kind,pg_get_viewdef(c.oid,true) AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('v','m') ORDER BY c.relname`,
        [schema]
    );
    const routines = await pool.query(
        `SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`,
        [schema]
    );
    const sequences = await pool.query(
        'SELECT sequencename AS name,data_type::text AS type,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename',
        [schema]
    );
    const triggers = await pool.query(
        `SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
        [schema]
    );
    const output = {};
    for (const [name, result] of Object.entries({
        columns,
        constraints,
        indexes,
        views,
        routines,
        sequences,
        triggers
    }))
        output[name] = result.rows.map((row) =>
            Object.fromEntries(
                Object.entries(row).map(([key, value]) => [
                    key,
                    typeof value === 'string' ? unqualify(value, schema) : value
                ])
            )
        );
    return output;
}

/** Recreate in an isolated schema and compare against the existing database without altering it. */
async function verifySchema(env = process.env) {
    const schema = 'icb_test_' + randomUUID().replaceAll('-', '');
    const existing = adminDatabase(env);
    let recreated;
    try {
        await existing.query(format('CREATE SCHEMA %I', schema));
        recreated = adminDatabase({ ...env, ICB_DB_SCHEMA: schema });
        await createSchema(recreated);
        const target = env.ICB_DB_SCHEMA || 'public';
        const before = await catalog(existing, target);
        assert.deepEqual(
            await catalog(recreated, schema),
            before,
            'Per-object SQL does not match the existing schema.'
        );
        const tables = new Set(before.columns.map((column) => column.table_name));
        return {
            equivalent: true,
            tables: tables.size,
            indexes: before.indexes.length,
            views: before.views.length,
            routines: before.routines.length,
            sequences: before.sequences.length,
            triggers: before.triggers.length
        };
    } finally {
        if (recreated) await recreated.end();
        // Only this invocation's allowlisted disposable schema can be removed.
        if (/^icb_test_[a-f0-9]{32}$/.test(schema))
            await existing.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
        await existing.end();
    }
}

/** Report structural equivalence only; mismatches cannot change live objects or data. */
async function main() {
    console.info(JSON.stringify(await verifySchema()));
}

if (require.main === module)
    main().catch(() => {
        console.error('Schema comparison failed; existing database objects were not modified.');
        process.exitCode = 1;
    });
module.exports = { catalog, verifySchema };
