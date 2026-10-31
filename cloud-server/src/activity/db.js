'use strict';
const fs = require('node:fs');
const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { fail } = require('./errors');

/** Cache service credentials briefly and rebuild pools after rotation or authentication failure. */
function createDatabase(env = process.env) {
    const secrets = new SecretsManagerClient({});
    let active;
    let refreshing;

    /** Reuse one bounded pool per warm environment, verifying the RDS CA and hostname. */
    async function pool() {
        if (active && active.expires > Date.now()) return active.pool;
        if (refreshing) return refreshing;
        refreshing = (async () => {
            const response = await secrets.send(
                new GetSecretValueCommand({ SecretId: env.DB_SECRET_ARN })
            );
            const credentials = JSON.parse(response.SecretString);
            if (credentials.username !== env.DB_USER || typeof credentials.password !== 'string')
                throw fail(503, 'database_unavailable');
            const next = new Pool({
                host: env.DB_HOST,
                port: Number(env.DB_PORT || 5432),
                database: env.DB_NAME,
                user: env.DB_USER,
                password: credentials.password,
                ssl: { ca: fs.readFileSync(env.DB_CA_FILE, 'utf8'), rejectUnauthorized: true },
                max: 1,
                connectionTimeoutMillis: 3000,
                idleTimeoutMillis: 10000,
                statement_timeout: 5000,
                idle_in_transaction_session_timeout: 5000
            });
            next.on('error', () => {
                if (active?.pool === next) active.expires = 0;
            });
            const previous = active;
            active = { pool: next, expires: Date.now() + 60000 };
            if (previous) previous.pool.end().catch(() => {});
            return next;
        })();
        try {
            return await refreshing;
        } finally {
            refreshing = null;
        }
    }

    /** Release every borrowed client, including on rollback, timeout, and failed authentication. */
    async function withClient(operation) {
        let client;
        try {
            client = await (await pool()).connect();
            return await operation(client);
        } catch (error) {
            if (error.code === '28P01' && active) active.expires = 0;
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    return {
        withClient,
        close: async () => {
            if (active) await active.pool.end();
            secrets.destroy();
        }
    };
}

/** Keep transaction commands on the same checked-out client. */
async function transaction(db, operation) {
    return db.withClient(async (client) => {
        await client.query('BEGIN');
        try {
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}

module.exports = { createDatabase, transaction };
