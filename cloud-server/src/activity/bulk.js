'use strict';
const format = require('pg-format');
const { randomUUID } = require('node:crypto');
const { AUDIT_TYPES } = require('./validation');
const { deltas, COLUMNS } = require('./summaries');
const { fail } = require('./errors');
const TABLES = [
    'activity_event_receipts',
    'source_event_receipts',
    'viewers',
    'support_events',
    'giveaway_audit_events',
    'viewer_daily_stats',
    'stream_daily_stats',
    'support_currency_daily'
];

/** Build multi-row SQL using internal table/column identifiers and parameterized data only. */
async function insertRows(client, table, columns, rows, suffix = '') {
    if (!TABLES.includes(table) || columns.some((column) => !/^[a-z_]+$/.test(column)))
        throw new Error('Invalid SQL identifier.');
    if (!rows.length) return { rows: [], rowCount: 0 };
    const values = [];
    const tuples = rows.map(
        (row) =>
            '(' +
            row
                .map((value) => {
                    values.push(value);
                    return '$' + values.length;
                })
                .join(',') +
            ')'
    );
    return client.query(
        `INSERT INTO ${format('%I', table)}(${columns
            .map((key) => format('%I', key))
            .join(',')}) VALUES ${tuples.join(',')} ${suffix}`,
        values
    );
}

/** Persist permanent UUID/source receipts before allowing any summary increments. */
async function novelRecords(client, owner, records) {
    const unique = [
        ...new Map(records.map((record) => [record.id.toLowerCase(), record])).values()
    ];
    const ids = await insertRows(
        client,
        'activity_event_receipts',
        ['owner_id', 'event_id'],
        unique.map((record) => [owner, record.id]),
        'ON CONFLICT DO NOTHING RETURNING event_id'
    );
    const accepted = new Set(ids.rows.map((row) => row.event_id));
    const sourceKey = (record) => JSON.stringify([record.platform, record.source_id, record.type]);

    const sources = new Map();
    const candidates = unique.filter((record) => {
        if (!accepted.has(record.id.toLowerCase())) return false;
        if (!record.source_id) return true;
        const key = sourceKey(record);
        if (sources.has(key)) return false;
        sources.set(key, record);
        return true;
    });
    const inserted = await insertRows(
        client,
        'source_event_receipts',
        ['owner_id', 'platform', 'source_event_id', 'type'],
        [...sources.values()].map((record) => [
            owner,
            record.platform,
            record.source_id,
            record.type
        ]),
        'ON CONFLICT DO NOTHING RETURNING platform,source_event_id,type'
    );
    const keys = new Set(
        inserted.rows.map((row) => JSON.stringify([row.platform, row.source_event_id, row.type]))
    );
    return candidates.filter((record) => !record.source_id || keys.has(sourceKey(record)));
}

/** Separate canonical IDs from username fallbacks, with one upsert per identity per batch. */
async function viewers(client, owner, records) {
    const key = (viewer) =>
        JSON.stringify([
            viewer.platform,
            viewer.platform_user_id,
            viewer.platform_user_id ? null : viewer.username
        ]);

    const unique = new Map(
        records
            .filter((record) => record.viewer)
            .map((record) => [key(record.viewer), record.viewer])
    );
    const ids = new Map();
    for (const known of [true, false]) {
        const group = [...unique.values()].filter((viewer) => !!viewer.platform_user_id === known);
        const conflict = known
            ? '(owner_id,platform,platform_user_id) WHERE platform_user_id IS NOT NULL'
            : '(owner_id,platform,username) WHERE platform_user_id IS NULL';
        const result = await insertRows(
            client,
            'viewers',
            ['id', 'owner_id', 'platform', 'platform_user_id', 'username', 'display_name'],
            group.map((viewer) => [
                randomUUID(),
                owner,
                viewer.platform,
                viewer.platform_user_id,
                viewer.username,
                viewer.display_name
            ]),
            'ON CONFLICT ' +
                conflict +
                ' DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name RETURNING id,platform,platform_user_id,username'
        );
        result.rows.forEach((row) => ids.set(key(row), row.id));
    }
    return (record) => (record.viewer ? ids.get(key(record.viewer)) : null);
}

/** Insert compact event details in a bounded number of round trips, never individual chat rows. */
async function events(client, owner, records, viewerId) {
    const supportColumns = [
        'owner_id',
        'event_id',
        'viewer_id',
        'platform',
        'type',
        'occurred_at',
        'reporting_date',
        'timezone',
        'source_event_id',
        'quantity',
        'months',
        'bits',
        'money_minor',
        'currency',
        'tier',
        'subtype',
        'anonymous',
        'raid_size',
        'ticket_delta'
    ];
    const support = records.filter(
        (record) => record.type !== 'chat_count' && !AUDIT_TYPES.includes(record.type)
    );
    await insertRows(
        client,
        'support_events',
        supportColumns,
        support.map((record) => [
            owner,
            record.id,
            viewerId(record),
            record.platform,
            record.type,
            record.at,
            record.day,
            record.timezone,
            record.source_id,
            record.quantity ?? null,
            record.months ?? null,
            record.bits ?? null,
            record.money_minor ?? null,
            record.currency ?? null,
            record.tier ?? null,
            record.subtype ?? null,
            !!record.anonymous,
            record.raid_size ?? null,
            record.ticket_delta === null ? null : record.ticket_delta || 0
        ])
    );
    const audit = records.filter((record) => AUDIT_TYPES.includes(record.type));
    await insertRows(
        client,
        'giveaway_audit_events',
        [
            'owner_id',
            'event_id',
            'viewer_id',
            'type',
            'occurred_at',
            'reporting_date',
            'timezone',
            'ticket_delta',
            'action_id'
        ],
        audit.map((record) => [
            owner,
            record.id,
            viewerId(record),
            record.type,
            record.at,
            record.day,
            record.timezone,
            record.ticket_delta === null ? null : record.ticket_delta || 0,
            record.id
        ])
    );
}

/** Aggregate within the batch before one upsert per summary table, avoiding timeout-prone per-event SQL. */
async function summaries(client, owner, records, viewerId) {
    for (const table of ['stream_daily_stats', 'viewer_daily_stats']) {
        const perViewer = table === 'viewer_daily_stats';
        const groups = new Map();
        for (const record of records) {
            const id = perViewer ? viewerId(record) : null;
            if (perViewer && !id) continue;
            const key = record.day + ':' + (id || 'stream');
            const row = groups.get(key) || {
                day: record.day,
                timezone: record.timezone,
                id,
                values: COLUMNS.map(() => 0)
            };
            const delta = deltas(record);
            row.values = row.values.map((value, i) => value + delta[COLUMNS[i]]);
            groups.set(key, row);
        }
        const keys = [
            'owner_id',
            'reporting_date',
            'timezone',
            ...(perViewer ? ['viewer_id'] : [])
        ];
        const conflict = ['owner_id', 'reporting_date', ...(perViewer ? ['viewer_id'] : [])];
        const set = COLUMNS.map((key) => format('%I=%I.%I+EXCLUDED.%I', key, table, key, key)).join(
            ','
        );
        const saved = await insertRows(
            client,
            table,
            [...keys, ...COLUMNS],
            [...groups.values()]
                .sort((a, b) => (a.day + String(a.id)).localeCompare(b.day + String(b.id)))
                .map((row) => [
                    owner,
                    row.day,
                    row.timezone,
                    ...(perViewer ? [row.id] : []),
                    ...row.values
                ]),
            'ON CONFLICT(' +
                conflict.join(',') +
                ') DO UPDATE SET ' +
                set +
                ' WHERE ' +
                format('%I', table) +
                '.timezone=EXCLUDED.timezone RETURNING owner_id'
        );
        if (saved.rowCount !== groups.size) throw fail(409, 'timezone_conflict');
    }
    const amounts = new Map();
    for (const record of records.filter((entry) => ['tip', 'purchase'].includes(entry.type))) {
        const id = viewerId(record);
        for (const subject of ['stream', ...(id ? [id] : [])]) {
            const key = JSON.stringify([record.day, subject, record.currency, record.type]);
            const row = amounts.get(key) || [
                owner,
                record.day,
                record.timezone,
                subject,
                record.currency,
                record.type,
                0
            ];
            row[6] += record.money_minor;
            amounts.set(key, row);
        }
    }
    await insertRows(
        client,
        'support_currency_daily',
        [
            'owner_id',
            'reporting_date',
            'timezone',
            'subject_key',
            'currency',
            'contribution_type',
            'amount_minor'
        ],
        [...amounts.values()],
        'ON CONFLICT(owner_id,reporting_date,subject_key,currency,contribution_type) DO UPDATE SET amount_minor=support_currency_daily.amount_minor+EXCLUDED.amount_minor'
    );
}

module.exports = { novelRecords, viewers, events, summaries };
