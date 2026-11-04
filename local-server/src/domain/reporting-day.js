'use strict';

/** Group activity by the configured 06:00 wall-clock boundary, including DST transitions. */
function reportingDay(value, timezone = 'America/Chicago') {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('invalid_timestamp');
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23'
        })
            .formatToParts(date)
            .map((part) => [part.type, part.value])
    );
    const calendar = new Date(
        Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
    );
    if (Number(parts.hour) < 6) calendar.setUTCDate(calendar.getUTCDate() - 1);
    return calendar.toISOString().slice(0, 10);
}

module.exports = { reportingDay };
