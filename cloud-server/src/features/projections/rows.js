'use strict';
const format = require('pg-format');
const { fail } = require('../../activity/errors');
const TABLES = new Set([
    'steam_accounts',
    'todos',
    'turn_entries',
    'giveaway_entrants',
    'giveaway_winners',
    'poll_options',
    'poll_votes',
    'signup_events',
    'signup_entries',
    'team_members',
    'hunt_players',
    'resource_progress',
    'resource_slot_progress',
    'weekly_progress',
    'feature_timers',
    'collection_entries',
    'steam_achievements'
]);

/** Replace only this owner's selected projection under the owner's mutation transaction lock. */
async function replaceRows(client, table, owner, rows, scope = {}) {
    if (
        !TABLES.has(table) ||
        Object.keys(scope).some((key) => !['feature', 'app_id'].includes(key))
    )
        throw fail(500, 'invalid_projection');
    const where = ['owner_id=$1'];
    const values = [owner];
    for (const [key, value] of Object.entries(scope)) {
        values.push(value);
        where.push(format('%I=$%s', key, values.length));
    }
    await client.query(format('DELETE FROM %I WHERE ', table) + where.join(' AND '), values);
    if (!rows.length) return;
    if (rows.length > 12000) throw fail(413, 'too_many_feature_rows');
    const prepared = rows.map((row) => ({ ...row, owner_id: owner }));
    // Explicit table allowlist; pg performs type/constraint checks on every projected value.
    const columns = Object.keys(prepared[0]);
    const sql = format(
        'INSERT INTO %I(%s) SELECT %s FROM jsonb_populate_recordset(NULL::%I,$1::jsonb)',
        table,
        columns.map((key) => format('%I', key)).join(','),
        columns.map((key) => format('%I', key)).join(','),
        table
    );
    await client.query(sql, [JSON.stringify(prepared)]);
}

/** Read selected tenant rows; identifiers never come from a request. */
async function readRows(client, table, owner) {
    if (!TABLES.has(table)) throw fail(500, 'invalid_projection');
    return (await client.query(format('SELECT * FROM %I WHERE owner_id=$1', table), [owner])).rows;
}

module.exports = { replaceRows, readRows };
