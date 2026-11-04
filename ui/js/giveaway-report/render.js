'use strict';
window.ICBReport = (function () {
    var columns = [
        'messages',
        'active_windows',
        'sub_events',
        'sub_months',
        'gifted_subs',
        'bits',
        'follows',
        'raids',
        'ticket_delta',
        'unknown_award_events'
    ];

    /** Escape every account/viewer string before placing it in report markup. */
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** Render stored daily summaries without reconstructing speech or repricing historical tickets. */
    function render(report) {
        var html =
            '<h1>Stream report: ' +
            esc(report.date) +
            '</h1><p class="meta">' +
            esc(report.timezone) +
            ' · Day starts at 06:00 · Pending: ' +
            esc(report.sync.pending) +
            ' · Last cloud acknowledgment: ' +
            esc(report.sync.last_ack || 'none') +
            '</p>';
        if (!report.totals) return html + '<p>No stored summary for this day.</p>';
        if (report.totals.partial)
            html +=
                '<p><strong>Partial historical import:</strong> source records differ or are incomplete. These totals represent recoverable activity; unknown awards are shown separately.</p>';
        html +=
            '<p>Messages: ' +
            esc(report.totals.messages) +
            ' · Unique chatters: ' +
            report.viewers.filter(function (v) {
                return Number(v.messages) > 0;
            }).length +
            '</p>';
        html +=
            '<table><thead><tr><th>Viewer</th><th>Platform</th>' +
            columns
                .map(function (key) {
                    return '<th>' + esc(key.replace(/_/g, ' ')) + '</th>';
                })
                .join('') +
            '</tr></thead><tbody>';
        report.viewers.forEach(function (viewer) {
            html +=
                '<tr><td>' +
                esc(viewer.display_name) +
                '</td><td>' +
                esc(viewer.platform) +
                '</td>' +
                columns
                    .map(function (key) {
                        return '<td class="num">' + esc(viewer[key]) + '</td>';
                    })
                    .join('') +
                '</tr>';
        });
        html +=
            '</tbody></table><h2>Currency totals (minor units)</h2><table><tr><th>Subject</th><th>Currency</th><th>Type</th><th>Amount</th></tr>';
        report.currencies.forEach(function (row) {
            var viewer = report.viewers.find(function (v) {
                return v.viewer_id === row.subject_key;
            });
            html +=
                '<tr><td>' +
                esc(
                    row.subject_key === 'stream'
                        ? 'Stream total'
                        : viewer
                        ? viewer.display_name
                        : 'Viewer'
                ) +
                '</td><td>' +
                esc(row.currency) +
                '</td><td>' +
                esc(row.contribution_type) +
                '</td><td>' +
                esc(row.amount_minor) +
                '</td></tr>';
        });
        return (
            html +
            '</table><p class="foot">Anonymous support is included in stream totals. Ticket deltas are the amounts actually awarded at the time.</p>'
        );
    }

    /** Neutralize spreadsheet formulas as well as CSV delimiters and newlines. */
    function cell(value) {
        var text = String(value == null ? '' : value);
        if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    /** Export summary rows only, with a separate currency section and no transcript/raw event fields. */
    function csv(report) {
        var rows = [['date', 'timezone', 'viewer', 'platform'].concat(columns)];
        report.viewers.forEach(function (viewer) {
            rows.push(
                [report.date, report.timezone, viewer.display_name, viewer.platform].concat(
                    columns.map(function (key) {
                        return viewer[key];
                    })
                )
            );
        });
        rows.push([], ['date', 'subject', 'currency', 'contribution_type', 'amount_minor']);
        report.currencies.forEach(function (row) {
            rows.push([
                report.date,
                row.subject_key,
                row.currency,
                row.contribution_type,
                row.amount_minor
            ]);
        });
        return rows
            .map(function (row) {
                return row.map(cell).join(',');
            })
            .join('\r\n');
    }

    return { render: render, csv: csv };
})();
