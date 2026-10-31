'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const format = require('pg-format');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { createDatabase } = require('../src/activity/db');
const { adminDatabase } = require('../tools/admin-db');
const {
    definition,
    executeGroup,
    createSchema,
    applyGrants,
    applySchemaPermissions
} = require('../tools/schema');
const { migrate } = require('../tools/migrate');
const { catalog } = require('../tools/schema-check');
const { DATABASE_ROOT } = require('../tools/schema');
const baseline = JSON.parse(
    fs.readFileSync(path.join(DATABASE_ROOT, 'baselines/005.json'), 'utf8')
);

/** Record stable object identities so a namespace move cannot masquerade as a drop/rebuild. */
async function identities(pool, schema) {
    return (
        await pool.query(
            `SELECT c.oid::text,c.relname,c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.oid`,
            [schema]
        )
    ).rows;
}

/** Compare every stored value without exposing fixture rows or credential hashes in output. */
async function contents(pool, schema) {
    const result = {};
    for (const file of baseline.objects.filter((name) => name.startsWith('tables/'))) {
        const table = file.slice(7, -4);
        if (table === 'schema_migrations') continue;
        result[table] = (
            await pool.query(
                format(
                    "SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM %I.%I t",
                    schema,
                    table
                )
            )
        ).rows[0];
    }
    return result;
}

test(
    'public to icb migration preserves rows/OIDs/grants, rolls back conflicts, and never duplicates tables',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' },
    async (t) => {
        const admin = adminDatabase();
        const database = 'icb_test_schema_' + randomUUID().replaceAll('-', '');
        let legacy;
        let target;
        let service;
        let runtime;
        try {
            await admin.query(format('CREATE DATABASE %I', database));
            legacy = adminDatabase({
                ...process.env,
                PGDATABASE: database,
                ICB_DB_SCHEMA: 'public'
            });
            target = adminDatabase({ ...process.env, PGDATABASE: database });
            // Fresh rebuilds use the checked-in namespace creation file and leave public empty.
            await createSchema(target);
            const freshCatalog = await catalog(target, 'icb');
            assert.equal(
                new Set((await catalog(target, 'icb')).columns.map((column) => column.table_name))
                    .size,
                definition().objects.filter((file) => file.startsWith('tables/')).length
            );
            assert.equal((await identities(legacy, 'public')).length, 0);
            assert.equal(
                (
                    await target.query(
                        "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='icb'"
                    )
                ).rows[0].owner,
                'icb_migrator'
            );
            // Verify the connected database before replacing only this generated fixture with legacy data.
            assert.match(database, /^icb_test_schema_[a-f0-9]{32}$/);
            assert.equal(
                (await target.query('SELECT current_database() AS name')).rows[0].name,
                database
            );
            await target.query('DROP SCHEMA icb CASCADE');
            const client = await legacy.connect();
            try {
                // Reconstruct the old deployed layout only inside this disposable database.
                for (const file of baseline.objects)
                    await client.query(fs.readFileSync(path.join(DATABASE_ROOT, file), 'utf8'));
                for (const [version, hash] of Object.entries(baseline.covers)) {
                    if (version !== '005-icb-schema.sql')
                        await client.query(
                            'INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)',
                            [version, hash]
                        );
                }
                const owner = randomUUID();
                await client.query(
                    "INSERT INTO accounts(id,login_name,password_salt,password_hash,scrypt_n,scrypt_r,scrypt_p) VALUES($1,'schema_fixture','fixture','fixture',16384,8,1)",
                    [owner]
                );
                await client.query(
                    "INSERT INTO stream_daily_stats(owner_id,reporting_date,timezone,messages,bits) VALUES($1,'2026-10-30','America/Chicago',123,456)",
                    [owner]
                );
                await client.query(
                    "INSERT INTO feature_state(owner_id,state_key,revision,payload,sha256,captured_at,collector_id) VALUES($1,'live.json',1,$2::jsonb,'fixture',now(),$3)",
                    [owner, JSON.stringify({ resources: { amber: 17 } }), randomUUID()]
                );
            } finally {
                client.release();
            }
            const before = await contents(legacy, 'public');
            const beforeIds = await identities(legacy, 'public');
            const beforeCatalog = await catalog(legacy, 'public');
            const ledger = (await legacy.query('SELECT * FROM schema_migrations ORDER BY version'))
                .rows;
            await assert.rejects(() => createSchema(legacy), /not public/);
            await assert.rejects(() => createSchema(target), /require.*migration/);
            const schemaClient = await target.connect();
            try {
                await executeGroup(schemaClient, 'schemas');
            } finally {
                schemaClient.release();
            }
            await target.query('CREATE TABLE icb.sessions(collision integer)');
            await assert.rejects(
                () => migrate(target, undefined, { through: '005-icb-schema.sql' }),
                /already exists/
            );
            assert.ok(
                (await legacy.query("SELECT to_regclass('public.accounts') AS table_name")).rows[0]
                    .table_name
            );
            assert.equal(
                (await target.query("SELECT to_regclass('icb.accounts') AS table_name")).rows[0]
                    .table_name,
                null
            );
            assert.deepEqual(await contents(legacy, 'public'), before);
            assert.deepEqual(
                (await legacy.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
                ledger
            );
            await target.query('DROP TABLE icb.sessions');
            await migrate(target, undefined, { through: '005-icb-schema.sql' });
            assert.deepEqual(await identities(target, 'icb'), beforeIds);
            assert.deepEqual(await catalog(target, 'icb'), beforeCatalog);
            assert.deepEqual(await contents(target, 'icb'), before);
            assert.equal((await identities(legacy, 'public')).length, 0);
            assert.deepEqual(
                (
                    await target.query(
                        "SELECT * FROM schema_migrations WHERE version<>'005-icb-schema.sql' ORDER BY version"
                    )
                ).rows,
                ledger
            );
            await migrate(target, undefined, { through: '005-icb-schema.sql' });
            assert.equal(
                (
                    await target.query(
                        "SELECT 1 FROM schema_migrations WHERE version='005-icb-schema.sql'"
                    )
                ).rowCount,
                1
            );
            await applySchemaPermissions(target);
            // New per-table grants are valid only after the additive Step 2 upgrade.
            await migrate(target);
            assert.deepEqual(await catalog(target, 'icb'), freshCatalog);
            assert.deepEqual(await contents(target, 'icb'), before);
            assert.equal(
                new Set((await catalog(target, 'icb')).columns.map((column) => column.table_name))
                    .size,
                definition().objects.filter((file) => file.startsWith('tables/')).length
            );
            await applyGrants(target);
            if (process.env.ICB_TEST_SERVICE_PASSWORD) {
                service = adminDatabase({
                    ...process.env,
                    PGDATABASE: database,
                    PGUSER: 'icb_service',
                    PGPASSWORD: process.env.ICB_TEST_SERVICE_PASSWORD
                });
                assert.equal(
                    (await service.query('SELECT messages FROM stream_daily_stats')).rows[0]
                        .messages,
                    '123'
                );
                await assert.rejects(
                    () => service.query('DELETE FROM accounts'),
                    /permission denied/
                );
                await assert.rejects(
                    () => service.query('CREATE TABLE forbidden(value integer)'),
                    /permission denied/
                );
                // A legacy role default and public decoy must never redirect the runtime's queries.
                await target.query('CREATE TABLE public.stream_daily_stats(messages bigint)');
                await target.query('INSERT INTO public.stream_daily_stats VALUES(999)');
                await target.query('GRANT SELECT ON public.stream_daily_stats TO icb_service');
                await target.query(
                    format('ALTER ROLE icb_service IN DATABASE %I SET search_path=public', database)
                );
                t.mock.method(SecretsManagerClient.prototype, 'send', async () => ({
                    SecretString: JSON.stringify({
                        username: 'icb_service',
                        password: process.env.ICB_TEST_SERVICE_PASSWORD
                    })
                }));
                runtime = createDatabase({
                    DB_HOST: process.env.PGHOST,
                    DB_PORT: process.env.PGPORT,
                    DB_NAME: database,
                    DB_USER: 'icb_service',
                    DB_CA_FILE: process.env.PGSSLROOTCERT,
                    DB_SECRET_ARN: 'fixture-only'
                });
                const actual = await runtime.withClient((client) =>
                    client.query(
                        'SELECT current_schema() AS schema,messages FROM stream_daily_stats'
                    )
                );
                assert.deepEqual(actual.rows, [{ schema: 'icb', messages: '123' }]);
            }
        } finally {
            if (runtime) await runtime.close();
            if (service) await service.end();
            if (target) await target.end();
            if (legacy) await legacy.end();
            // The only database removed is this invocation's generated, allowlisted fixture.
            assert.match(database, /^icb_test_schema_[a-f0-9]{32}$/);
            await admin.query(format('DROP DATABASE IF EXISTS %I', database));
            await admin.end();
        }
    }
);
