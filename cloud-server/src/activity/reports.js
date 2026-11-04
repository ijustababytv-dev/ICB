'use strict';
const express = require('express');
const { day, uuid, fields } = require('./validation');
const { fail } = require('./errors');
const { COLUMNS } = require('./summaries');

/** Bound report scans to a validated 366-day inclusive calendar range. */
function range(query) {
    const to = day(query.to || new Date().toISOString().slice(0, 10));
    const from = day(
        query.from || new Date(Date.parse(to) - 365 * 86400000).toISOString().slice(0, 10)
    );
    const distance = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (distance < 0 || distance > 365) throw fail(400, 'invalid_date_range');
    return [from, to];
}

/** Read summaries directly; reports never replay chat/event logs or local standings. */
function reportRoutes(db) {
    const router = express.Router();
    router.get('/days', async (req, res) => {
        fields(req.query, ['from', 'to']);
        const [from, to] = range(req.query);
        const result = await db.withClient((client) =>
            client.query(
                `SELECT s.*,COALESCE(q.partial,false) AS partial,
            (SELECT count(*) FROM viewer_daily_stats v WHERE v.owner_id=s.owner_id AND v.reporting_date=s.reporting_date AND v.messages>0) AS unique_chatters
            FROM stream_daily_stats s LEFT JOIN daily_summary_quality q ON q.owner_id=s.owner_id AND q.reporting_date=s.reporting_date
            WHERE s.owner_id=$1 AND s.reporting_date BETWEEN $2 AND $3 ORDER BY s.reporting_date DESC`,
                [req.owner.id, from, to]
            )
        );
        res.json({ ok: true, days: result.rows });
    });
    router.get('/days/:date', async (req, res) => {
        fields(req.query, ['after']);
        const date = day(req.params.date);
        const after = req.query.after ? uuid(req.query.after) : null;
        const payload = await db.withClient(async (client) => {
            const totals = await client.query(
                'SELECT s.*,COALESCE(q.partial,false) AS partial FROM stream_daily_stats s LEFT JOIN daily_summary_quality q ON q.owner_id=s.owner_id AND q.reporting_date=s.reporting_date WHERE s.owner_id=$1 AND s.reporting_date=$2',
                [req.owner.id, date]
            );
            const viewers = await client.query(
                `SELECT v.id,v.username,v.display_name,v.platform,s.* FROM viewer_daily_stats s JOIN viewers v
                ON v.owner_id=s.owner_id AND v.id=s.viewer_id WHERE s.owner_id=$1 AND s.reporting_date=$2 ORDER BY s.messages DESC,v.username`,
                [req.owner.id, date]
            );
            const amounts = await client.query(
                'SELECT * FROM support_currency_daily WHERE owner_id=$1 AND reporting_date=$2 ORDER BY subject_key,currency,contribution_type',
                [req.owner.id, date]
            );
            const events = await client.query(
                `SELECT event_id,type,occurred_at,viewer_id,ticket_delta FROM
                (SELECT event_id,type,occurred_at,viewer_id,ticket_delta FROM support_events WHERE owner_id=$1 AND reporting_date=$2
                UNION ALL SELECT event_id,type,occurred_at,viewer_id,ticket_delta FROM giveaway_audit_events WHERE owner_id=$1 AND reporting_date=$2) e
                WHERE ($3::uuid IS NULL OR event_id>$3) ORDER BY event_id LIMIT 101`,
                [req.owner.id, date, after]
            );
            return {
                totals: totals.rows[0] || null,
                viewers: viewers.rows,
                currencies: amounts.rows,
                events: events.rows.slice(0, 100),
                next_cursor: events.rowCount > 100 ? events.rows[99].event_id : null
            };
        });
        res.json({ ok: true, date, timezone: req.owner.reporting_timezone, ...payload });
    });
    router.get('/viewers/:id', async (req, res) => {
        fields(req.query, ['from', 'to']);
        const id = uuid(req.params.id);
        const [from, to] = range(req.query);
        const result = await db.withClient((client) =>
            client.query(
                `SELECT ${COLUMNS.map((key) => 'SUM(' + key + ') AS ' + key).join(',')}
            FROM viewer_daily_stats WHERE owner_id=$1 AND viewer_id=$2 AND reporting_date BETWEEN $3 AND $4`,
                [req.owner.id, id, from, to]
            )
        );
        res.json({ ok: true, from, to, totals: result.rows[0] });
    });
    router.get('/viewers/:id/lifetime', async (req, res) => {
        fields(req.query, []);
        const id = uuid(req.params.id);
        const result = await db.withClient((client) =>
            client.query(
                `SELECT ${COLUMNS.map((key) => 'SUM(' + key + ') AS ' + key).join(',')}
            FROM viewer_daily_stats WHERE owner_id=$1 AND viewer_id=$2`,
                [req.owner.id, id]
            )
        );
        res.json({ ok: true, totals: result.rows[0] });
    });
    return router;
}

module.exports = { reportRoutes, range };
