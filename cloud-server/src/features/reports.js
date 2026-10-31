'use strict';
const { fields, integer, day } = require('../activity/validation');
const { fail } = require('../activity/errors');
const QUERIES = {
    archives: [
        'SELECT id,feature,backup_name,after_revision,created_at,octet_length(before_state::text) AS bytes FROM feature_undo WHERE owner_id=$1',
        'created_at DESC,id'
    ],
    draws: [
        'SELECT id,command_id,revision,prize,result,created_at FROM giveaway_draws WHERE owner_id=$1',
        'created_at DESC,id'
    ],
    awards: [
        'SELECT id,name_key,source_key,delta,kind,occurred_at AS created_at FROM giveaway_awards WHERE owner_id=$1',
        'occurred_at DESC,id'
    ],
    commands: [
        'SELECT feature,command_id,revision,created_at FROM feature_commands WHERE owner_id=$1',
        'created_at DESC,feature,command_id'
    ],
    signups: [
        'SELECT feature,event_id,id,name_key,display_name,position,checked_in FROM signup_entries WHERE owner_id=$1',
        'feature,event_id,position,id'
    ],
    turns: [
        'SELECT entry_uuid,round_id,name,state,position FROM turn_entries WHERE owner_id=$1',
        'position,id'
    ],
    resources: [
        'SELECT resource_id,quantity,secondary_quantity FROM resource_progress WHERE owner_id=$1',
        'resource_id'
    ]
};

/** Read compact audit references or typed progress directly, with owner isolation and bounded pages. */
async function featureReport(db, owner, kind, query) {
    fields(query, ['limit', 'offset', 'date', 'format']);
    if (!QUERIES[kind]) throw fail(404, 'unknown_feature_report');
    const limit = query.limit === undefined ? 100 : integer(Number(query.limit), 1, 200);
    const offset = query.offset === undefined ? 0 : integer(Number(query.offset), 0, 1000000);
    const [base, order] = QUERIES[kind];
    const args = [owner.id];
    let filter = '';
    if (query.date) {
        if (!['draws', 'awards', 'commands'].includes(kind))
            throw fail(400, 'report_date_not_supported');
        args.push(day(query.date), owner.reporting_timezone);
        const column = kind === 'awards' ? 'occurred_at' : 'created_at';
        filter = ` AND ((${column} AT TIME ZONE $3)-interval '6 hours')::date=$2::date`;
    }
    args.push(limit + 1, offset);
    const rows = await db.withClient(
        async (client) =>
            (
                await client.query(
                    base +
                        filter +
                        ' ORDER BY ' +
                        order +
                        ` LIMIT $${args.length - 1} OFFSET $${args.length}`,
                    args
                )
            ).rows
    );
    return {
        ok: true,
        kind,
        timezone: owner.reporting_timezone,
        rows: rows.slice(0, limit),
        next_offset: rows.length > limit ? offset + limit : null
    };
}

/** Escape all cells, including deliberate names, so exports cannot execute spreadsheet formulas. */
function reportCsv(rows) {
    if (!rows.length) return '';
    const columns = Object.keys(rows[0]);
    const cell = (value) => {
        let text =
            value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
    };

    return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
        .map((row) => row.map(cell).join(','))
        .join('\r\n');
}

module.exports = { featureReport, reportCsv };
