'use strict';
const assert = require('node:assert/strict');
const format = require('pg-format');
const { randomBytes } = require('node:crypto');
const { provisionAccount } = require('./account');
const { definition } = require('./schema');

/** Disposable verification identities only; never accept a caller-supplied production account for cleanup. */
async function createOwner(pool) {
    const username = 'icb_step2_' + randomBytes(6).toString('hex');
    const password = randomBytes(24).toString('hex');
    const id = await provisionAccount(pool, username, password);
    await pool.query("UPDATE accounts SET live_cutover_at=now()-interval '1 minute' WHERE id=$1", [
        id
    ]);
    return { id, username, password };
}

/** Delete only this generated identity, in reverse source dependency order, under the normal owner lock. */
async function removeOwner(pool, owner) {
    assert.match(owner.username, /^icb_step2_[a-f0-9]{12}$/);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const found = await client.query('SELECT id FROM accounts WHERE id=$1 AND login_name=$2', [
            owner.id,
            owner.username
        ]);
        assert.equal(found.rowCount, 1);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('icb-owner:' || $1,0))", [
            owner.id
        ]);
        const tables = definition()
            .objects.filter((file) => file.startsWith('tables/'))
            .map((file) => file.split('/')[1].replace(/\.sql$/, ''))
            .reverse();
        const columns = await client.query(
            "SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='owner_id'"
        );
        const scoped = new Set(columns.rows.map((row) => row.table_name));
        for (const table of tables)
            if (scoped.has(table))
                await client.query(format('DELETE FROM %I WHERE owner_id=$1', table), [owner.id]);
        await client.query('DELETE FROM accounts WHERE id=$1 AND login_name=$2', [
            owner.id,
            owner.username
        ]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { createOwner, removeOwner };
