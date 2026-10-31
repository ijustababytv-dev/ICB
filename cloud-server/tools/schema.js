'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const DATABASE_ROOT = path.resolve(__dirname, '../../database');
const SCHEMA_LOCK = 19770731;

/** Read dependency order and preserved version hashes without accepting paths outside database/. */
function definition(root = DATABASE_ROOT) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'schema.json'), 'utf8'));
    if (manifest.format !== 1 || manifest.baseline_id !== '000-object-baseline')
        throw new Error('Unsupported database definition format.');
    const allowed = {
        bootstrap: /^(roles|permissions)\/[a-z0-9_-]+\.sql$/,
        objects: /^(tables|indexes|views|functions|sequences|types|triggers)\/[a-z0-9_-]+\.sql$/,
        grants: /^permissions\/[a-z0-9_-]+\.sql$/
    };
    const seen = new Set();
    for (const [group, pattern] of Object.entries(allowed)) {
        if (!Array.isArray(manifest[group])) throw new Error('Missing SQL file group.');
        for (const file of manifest[group]) {
            if (!pattern.test(file) || seen.has(file))
                throw new Error('Invalid or duplicate SQL source path.');
            const real = fs.realpathSync(path.join(root, file));
            if (!real.startsWith(fs.realpathSync(root) + path.sep))
                throw new Error('SQL source escapes database/.');
            seen.add(file);
        }
    }
    if (manifest.objects[0] !== 'tables/schema_migrations.sql')
        throw new Error('Create the schema ledger first.');
    if (!manifest.covers || !Object.keys(manifest.covers).length)
        throw new Error('Missing baseline version history.');
    for (const [version, hash] of Object.entries(manifest.covers)) {
        if (!/^\d{3}[-a-z0-9]*\.sql$/.test(version) || !/^[a-f0-9]{64}$/.test(hash))
            throw new Error('Invalid baseline version history.');
    }
    return manifest;
}

/** Execute checked-in files in explicit order, with no generated or duplicated table DDL. */
async function executeGroup(client, group, root = DATABASE_ROOT) {
    if (!['bootstrap', 'objects', 'grants'].includes(group))
        throw new Error('Unknown SQL file group.');
    for (const file of definition(root)[group])
        await client.query(fs.readFileSync(path.join(root, file), 'utf8'));
}

/** Record the object sources used for a fresh schema; existing databases are never rebuilt. */
function sourceHash(root = DATABASE_ROOT) {
    const manifest = definition(root);
    const hash = createHash('sha256').update(JSON.stringify(manifest.covers));
    for (const file of manifest.objects)
        hash.update(file + '\0').update(fs.readFileSync(path.join(root, file)));
    return hash.digest('hex');
}

/** Serialize administrative schema work using the same lock as earlier releases. */
async function withSchemaLock(pool, operation) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        return await operation(client);
    } finally {
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
        } finally {
            client.release();
        }
    }
}

/** Build an empty schema atomically and baseline the versions represented by its definitions. */
async function installBaseline(client, root = DATABASE_ROOT) {
    const existing =
        await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`);
    if (existing.rowCount)
        throw new Error(
            'Schema creation requires an empty schema; existing objects were left unchanged.'
        );
    const manifest = definition(root);
    const fingerprint = sourceHash(root);
    await client.query('BEGIN');
    try {
        await executeGroup(client, 'objects', root);
        for (const [version, hash] of Object.entries(manifest.covers))
            await client.query('INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)', [
                version,
                hash
            ]);
        await client.query('INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)', [
            manifest.baseline_id,
            fingerprint
        ]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

/** Explicit fresh creation refuses populated databases instead of dropping anything. */
async function createSchema(pool, root = DATABASE_ROOT) {
    return withSchemaLock(pool, (client) => installBaseline(client, root));
}

/** Reapply limited table privileges after creation or a no-ACL restore, as the object owner. */
async function applyGrants(pool, root = DATABASE_ROOT) {
    return withSchemaLock(pool, async (client) => {
        await client.query('BEGIN');
        try {
            await executeGroup(client, 'grants', root);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}

/** Create structure only; accounts and feature data need a private backup or explicit import. */
async function main() {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== '--grants'))
        throw new Error('Unknown schema command.');
    const pool = adminDatabase();
    try {
        if (args[0] === '--grants') {
            await applyGrants(pool);
            console.info('Limited table permissions applied.');
        } else {
            await createSchema(pool);
            console.info('Empty schema created from per-object SQL files.');
        }
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('Schema command failed; verify the target schema and owner permissions.');
        process.exitCode = 1;
    });
module.exports = {
    DATABASE_ROOT,
    definition,
    executeGroup,
    sourceHash,
    withSchemaLock,
    installBaseline,
    createSchema,
    applyGrants
};
