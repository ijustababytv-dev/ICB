'use strict';
const fs = require('node:fs');
const { Pool } = require('pg');
const format = require('pg-format');

/** Administrative commands require explicit credentials and certificate validation. */
function adminDatabase(env = process.env) {
    if (!env.PGHOST || !env.PGUSER || !env.PGPASSWORD || !env.PGSSLROOTCERT)
        throw new Error('Set PGHOST, PGUSER, PGPASSWORD, PGDATABASE, and PGSSLROOTCERT privately.');
    const schema = env.ICB_DB_SCHEMA || 'public';
    if (schema !== 'public' && !/^icb_test_[a-z0-9_]+$/.test(schema))
        throw new Error('Invalid schema.');
    return new Pool({
        host: env.PGHOST,
        port: Number(env.PGPORT || 5432),
        database: env.PGDATABASE || 'icb',
        user: env.PGUSER,
        password: env.PGPASSWORD,
        ssl: { ca: fs.readFileSync(env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true },
        max: 2,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
        options: '-c search_path=' + format('%I', schema)
    });
}

/** Expose the same interface as the runtime without ever persisting administrative credentials. */
function databaseAdapter(pool) {
    return {
        withClient: async (operation) => {
            const client = await pool.connect();
            try {
                return await operation(client);
            } finally {
                client.release();
            }
        }
    };
}

module.exports = { adminDatabase, databaseAdapter };
