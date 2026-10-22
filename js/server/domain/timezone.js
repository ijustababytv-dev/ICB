'use strict';

/** Reject timezone identifiers that Intl cannot resolve. */
function etValidTz(tz) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: String(tz) });
        return true;
    } catch (_e) {
        return false;
    }
}

/** Calculate the timezone offset for this instant, including daylight saving time. */
function etOffset(ms, tz) {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(new Date(ms)))
        parts[p.type] = p.value;
    return (
        Date.UTC(
            +parts.year,
            +parts.month - 1,
            +parts.day,
            +parts.hour % 24,
            +parts.minute,
            +parts.second
        ) -
        Math.floor(ms / 1000) * 1000
    );
}

/** Convert local event date/time to an epoch using the date-specific timezone offset. */
function etToEpoch(date, time, tz) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
    if (!d || !t || !etValidTz(tz)) return null;
    const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
    let ms = guess - etOffset(guess, tz);
    ms = guess - etOffset(ms, tz); // second pass settles DST edges
    return ms;
}

Object.assign(exports, { etValidTz, etToEpoch, etOffset });
