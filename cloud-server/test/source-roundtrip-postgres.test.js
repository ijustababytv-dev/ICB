'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const format = require('pg-format');
const { adminDatabase, databaseAdapter } = require('../tools/admin-db');
const { createSchema } = require('../tools/schema');
const { provisionAccount } = require('../tools/account');
const { featureSources, projectedHash } = require('../tools/feature-source');
const { importFeature } = require('../src/features/commands');
const { claimCollector } = require('../src/activity/collectors');
const repository = require('../src/features/repository');

test(
    'every supported field in a frozen backup survives typed PostgreSQL projection without exposing its contents',
    { skip: process.env.ICB_TEST_POSTGRES !== '1' || !process.env.ICB_TEST_SOURCE_DIR },
    async () => {
        const root = path.resolve(__dirname, '../..');
        const directory = path.resolve(process.env.ICB_TEST_SOURCE_DIR);
        assert.ok(
            directory.startsWith(path.join(root, 'backups') + path.sep),
            'Read a backup copy, never live data.'
        );
        const sources = featureSources(directory, root);
        const admin = adminDatabase();
        const schema = 'icb_test_' + randomUUID().replaceAll('-', '');
        let pool;
        try {
            await admin.query(format('CREATE SCHEMA %I', schema));
            pool = adminDatabase({ ...process.env, ICB_DB_SCHEMA: schema });
            await createSchema(pool);
            const db = databaseAdapter(pool);
            const owner = {
                id: await provisionAccount(pool, 'SourceFixture', 'FixturePassword123!'),
                reporting_timezone: 'America/Chicago'
            };
            const collector = randomUUID();
            await claimCollector(db, owner, collector);
            for (const source of sources)
                await importFeature(db, owner, source.entry.feature, {
                    command_id: randomUUID(),
                    collector_id: collector,
                    source_sha256: source.sha256,
                    input_watermark: 'frozen-fixture:no-pending-inputs',
                    payload: source.payload
                });
            const documents = await db.withClient((client) =>
                repository.loadDocuments(client, owner.id)
            );
            for (const source of sources)
                for (const key of Object.keys(source.payload)) {
                    const expected = { [key]: source.payload[key] };
                    assert.equal(
                        projectedHash(expected, documents[source.entry.file]),
                        projectedHash(expected, expected),
                        'Supported field mismatch: ' + source.entry.feature + '.' + key
                    );
                }
            assert.equal(
                (
                    await pool.query(
                        'SELECT count(*) AS n FROM feature_migrations WHERE owner_id=$1',
                        [owner.id]
                    )
                ).rows[0].n,
                String(sources.length)
            );
        } finally {
            if (pool) await pool.end();
            assert.match(schema, /^icb_test_[a-f0-9]{32}$/);
            await admin.query(format('DROP SCHEMA IF EXISTS %I CASCADE', schema));
            await admin.end();
        }
    }
);
