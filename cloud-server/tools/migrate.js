'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase } = require('./admin-db');
const {
    definition,
    withSchemaLock,
    installBaseline,
    selectedSchema,
    executeGroup
} = require('./schema');

/** Create missing fresh schemas from tables/, then apply only unapplied, checksum-checked deltas. */
async function migrate(pool, directory = path.resolve(__dirname, '../../database/migrations')) {
    const baseline = definition();
    const files = fs
        .readdirSync(directory)
        .filter((name) => /^\d{3}[-a-z0-9]*\.sql$/.test(name))
        .sort();
    const sources = new Map(
        files.map((file) => {
            const sql = fs.readFileSync(path.join(directory, file), 'utf8');
            return [file, { sql, hash: createHash('sha256').update(sql).digest('hex') }];
        })
    );
    const expected = { ...baseline.covers };
    for (const [file, source] of sources) {
        if (expected[file] && expected[file] !== source.hash)
            throw new Error('Covered migration checksum changed: ' + file);
        expected[file] = source.hash;
    }
    return withSchemaLock(pool, async (client) => {
        const target = await selectedSchema(client);
        if (target === 'public')
            throw new Error('Migrations target icb; public is for legacy inspection only.');
        const found = (
            await client.query(
                "SELECT to_regclass($1) AS target,to_regclass('public.schema_migrations') AS legacy",
                [target + '.schema_migrations']
            )
        ).rows[0];
        if (target === 'icb' && found.target && found.legacy)
            throw new Error('Conflicting public and icb migration ledgers.');
        let ledgerSchema = target === 'icb' && !found.target && found.legacy ? 'public' : target;
        if (!found.target && ledgerSchema !== 'public') await installBaseline(client);
        const previous = await client.query(
            format('SELECT version,sha256 FROM %I.schema_migrations', ledgerSchema)
        );
        const applied = new Map(previous.rows.map((row) => [row.version, row.sha256]));
        for (const [version, hash] of applied) {
            if (version === baseline.baseline_id) continue;
            if (!expected[version])
                throw new Error('Missing source for applied migration: ' + version);
            if (expected[version] !== hash)
                throw new Error('Applied migration checksum changed: ' + version);
        }
        for (const version of Object.keys(baseline.covers)) {
            if (!applied.has(version) && !sources.has(version))
                throw new Error(
                    'Incomplete legacy schema; recover the original migration release before upgrading.'
                );
        }
        for (const [file, { sql, hash }] of sources) {
            if (applied.has(file)) continue;
            await client.query('BEGIN');
            try {
                if (ledgerSchema === 'public') {
                    if (file !== '005-icb-schema.sql')
                        throw new Error('Move the legacy schema before other upgrades.');
                    await executeGroup(client, 'schemas');
                }
                await client.query(sql);
                if (ledgerSchema === 'public') ledgerSchema = target;
                await client.query(
                    format(
                        'INSERT INTO %I.schema_migrations(version,sha256) VALUES($1,$2)',
                        ledgerSchema
                    ),
                    [file, hash]
                );
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    });
}

/** Administrative migrations never run on Lambda cold starts or restart the local server. */
async function main() {
    const pool = adminDatabase();
    try {
        await migrate(pool);
        console.info('Database definition and migration history verified.');
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('Schema migration failed; inspect version history and database access.');
        process.exitCode = 1;
    });
module.exports = { migrate };
