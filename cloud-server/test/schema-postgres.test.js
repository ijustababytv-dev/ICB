'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase } = require('../tools/admin-db');
const { migrate } = require('../tools/migrate');
const { DATABASE_ROOT, definition, createSchema } = require('../tools/schema');
const { catalog } = require('../tools/schema-check');

test(
    'per-object PostgreSQL rebuild preserves legacy history, upgrades once and rolls back failures',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' },
    async (t) => {
        const admin = adminDatabase();
        const schema = 'icb_test_' + randomUUID().replaceAll('-', '');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-schema-pg-'));
        let pool;
        try {
            await admin.query(format('CREATE SCHEMA %I', schema));
            pool = adminDatabase({ ...process.env, ICB_DB_SCHEMA: schema });
            // Compare the entire catalog before exercising upgrade-only behavior in this disposable schema.
            await createSchema(pool);
            assert.deepEqual(
                await catalog(pool, schema),
                await catalog(admin, process.env.ICB_DB_SCHEMA || 'public')
            );
            await assert.rejects(() => createSchema(pool), /empty schema/);

            // Existing deployments have only the original four ledger entries. They must remain byte-for-byte unchanged.
            await pool.query('DELETE FROM schema_migrations WHERE version=$1', [
                definition().baseline_id
            ]);
            const legacy = (await pool.query('SELECT * FROM schema_migrations ORDER BY version'))
                .rows;
            assert.equal(legacy.length, 4);
            await migrate(pool);
            assert.deepEqual(
                (await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
                legacy
            );
            const delta = path.join(root, '005-fixture.sql');
            fs.writeFileSync(delta, 'ALTER TABLE accounts ADD COLUMN fixture_marker text;');
            await migrate(pool, root);
            await pool.query(
                "INSERT INTO accounts(id,login_name,password_salt,password_hash,scrypt_n,scrypt_r,scrypt_p,fixture_marker) VALUES($1,'fixture','test','test',16384,8,1,'preserved')",
                [randomUUID()]
            );
            const upgraded = (await pool.query('SELECT * FROM schema_migrations ORDER BY version'))
                .rows;
            await migrate(pool, root);
            assert.deepEqual(
                (await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
                upgraded
            );
            fs.appendFileSync(delta, '\n-- illegal edit after application');
            await assert.rejects(() => migrate(pool, root), /checksum changed/);
            fs.writeFileSync(delta, 'ALTER TABLE accounts ADD COLUMN fixture_marker text;');
            fs.writeFileSync(
                path.join(root, '006-failure.sql'),
                'ALTER TABLE accounts ADD COLUMN rolled_back text; SELECT 1/0;'
            );
            await assert.rejects(() => migrate(pool, root), /division by zero/);
            assert.deepEqual(
                (await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
                upgraded
            );
            assert.equal(
                (
                    await pool.query(
                        "SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND column_name='rolled_back'",
                        [schema]
                    )
                ).rowCount,
                0
            );
            assert.equal(
                (await pool.query('SELECT fixture_marker FROM accounts')).rows[0].fixture_marker,
                'preserved'
            );
            await assert.rejects(() => migrate(pool), /Missing source for applied migration/);
            // Missing legacy versions must fail rather than pretending a partial deployment is current.
            await pool.query("DELETE FROM schema_migrations WHERE version='004-source-index.sql'");
            await assert.rejects(() => migrate(pool, root), /Incomplete legacy schema/);
            await t.test('production structure and rows were never migration targets', () =>
                assert.match(schema, /^icb_test_[a-f0-9]{32}$/)
            );
        } finally {
            if (pool) await pool.end();
            assert.match(schema, /^icb_test_[a-f0-9]{32}$/);
            await admin.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
            await admin.end();
            assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
            assert.match(path.basename(root), /^icb-schema-/);
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
);

test(
    'a failed object definition leaves an empty schema unchanged',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' },
    async () => {
        const admin = adminDatabase();
        const schema = 'icb_test_' + randomUUID().replaceAll('-', '');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-schema-rollback-'));
        let pool;
        try {
            fs.cpSync(DATABASE_ROOT, root, {
                recursive: true,
                filter: (file) => !path.basename(file).startsWith('.') && !file.endsWith('.pem')
            });
            fs.appendFileSync(path.join(root, 'tables/accounts.sql'), '\nSELECT 1/0;');
            await admin.query(format('CREATE SCHEMA %I', schema));
            pool = adminDatabase({ ...process.env, ICB_DB_SCHEMA: schema });
            await assert.rejects(() => createSchema(pool, root), /division by zero/);
            assert.equal((await catalog(pool, schema)).columns.length, 0);
            // No ledger or partially created tables survive the failed transaction.
            assert.equal(
                (await pool.query("SELECT to_regclass('schema_migrations') AS ledger")).rows[0]
                    .ledger,
                null
            );
        } finally {
            if (pool) await pool.end();
            assert.match(schema, /^icb_test_[a-f0-9]{32}$/);
            await admin.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
            await admin.end();
            assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
            assert.match(path.basename(root), /^icb-schema-/);
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
);
