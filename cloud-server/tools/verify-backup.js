'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const format = require('pg-format');
const { adminDatabase } = require('./admin-db');
const run = promisify(execFile);
const { tableFingerprints } = require('./table-fingerprints');
const { restorePermissions } = require('./restore-permissions');

/** Restore a real private dump into an allowlisted disposable database and compare stored counts. */
async function main() {
    const root = path.resolve(__dirname, '../..');
    const dump = path.resolve(process.argv[2] || '');
    if (!dump.startsWith(path.join(root, 'backups') + path.sep))
        throw new Error('Use a private project backup.');
    const name = 'icb_test_restore_' + randomUUID().replaceAll('-', '');
    if (!/^icb_test_restore_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid test database.');
    const admin = adminDatabase();
    let restored;
    try {
        const expected = (
            await admin.query(`SELECT (SELECT count(*) FROM accounts)::text AS accounts,
            (SELECT count(*) FROM feature_state)::text AS states,(SELECT SUM(messages) FROM stream_daily_stats)::text AS messages`)
        ).rows[0];
        const expectedTables = await tableFingerprints(admin);
        await admin.query(format('CREATE DATABASE %I', name));
        await run(
            'pg_restore',
            [
                '--dbname=' + name,
                '--no-owner',
                '--no-acl',
                '--single-transaction',
                '--exit-on-error',
                dump
            ],
            { env: { ...process.env, PGSSLMODE: 'verify-full' }, maxBuffer: 1024 * 1024 }
        );
        restored = adminDatabase({ ...process.env, PGDATABASE: name });
        await restorePermissions(restored);
        const actualTables = await tableFingerprints(restored);
        if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables))
            throw new Error('Restored table contents differ.');
        const actual = (
            await restored.query(`SELECT (SELECT count(*) FROM accounts)::text AS accounts,
            (SELECT count(*) FROM feature_state)::text AS states,(SELECT SUM(messages) FROM stream_daily_stats)::text AS messages`)
        ).rows[0];
        if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw new Error('Restored totals differ.');
        console.info(
            JSON.stringify({
                restored_database_verified: true,
                verified_tables: Object.keys(actualTables).length,
                ...actual
            })
        );
    } finally {
        if (restored) await restored.end();
        // Only this invocation's generated test database can be removed.
        if (/^icb_test_restore_[a-f0-9]{32}$/.test(name))
            await admin.query(format('DROP DATABASE IF EXISTS %I', name));
        await admin.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('Backup restore verification failed.');
        process.exitCode = 1;
    });
