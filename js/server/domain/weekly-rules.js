'use strict';

const mDomainLogParser = require('./log-parser');
const { weekStartFor } = require('./week');

/** Count only matching gains/losses; event goals count a line once, item goals count quantities. */
function applyWeeklyEvent(weekly, line) {
    const eventMatch = line.match(mDomainLogParser.EVENT_LINE_PATTERN);
    if (!eventMatch) return false;
    const direction = eventMatch[2].toLowerCase();

    // Pull every token on the line together with whether it carried the (1*)
    // star-quality flag. (1*) is confirmed to be the star marker: only 4.6% of
    // pickups carry it and 65 items appear in the logs both with and without.
    const found = [];
    const TOKEN_WITH_STAR = /(itemtype_[a-z0-9_]+)(\s*\(([0-9]+)\*\))?/gi;
    let m;
    while ((m = TOKEN_WITH_STAR.exec(line)) !== null) {
        found.push({ token: m[1].toLowerCase(), star: Boolean(m[2]) });
    }
    if (!found.length) return false;

    let changed = false;
    for (const item of weekly.items) {
        if (item.type !== 'collect') continue;
        const target = Number(item.target || 1);
        if (item.count >= target) continue;
        if ((item.direction || 'gained') !== direction) continue;

        const pattern = item.tokenPattern ? new RegExp(item.tokenPattern, 'i') : null;
        const exact = new Set((item.tokens || []).map((t) => t.toLowerCase()));
        const matches = found.filter(
            (f) =>
                (item.starOnly ? f.star : true) &&
                ((pattern && pattern.test(f.token)) || exact.has(f.token))
        );
        if (!matches.length) continue;

        if (item.mode === 'events') {
            // One felled tree is ONE line carrying 14-22 wood; one kill is one line
            // carrying meat and a hide. Counting quantities would wildly overcount
            // "chop 10 trees", so a whole line counts once.
            item.count += 1;
            changed = true;
        } else {
            for (const match of matches) {
                const qty = mDomainLogParser.quantityFor(line, match.token);
                if (qty > 0) {
                    item.count += qty;
                    changed = true;
                }
            }
        }
    }
    return changed;
}

/** A new Palia week clears progress once and retains a single undo snapshot. */
function rolloverWeek(weekly, at, cfg) {
    const current = weekStartFor(at, cfg);
    if (current === weekly.weekStart) return false;
    weekly.previous = {
        weekStart: weekly.weekStart,
        progress: weekly.items.map((i) => ({ id: i.id, count: i.count, done: Boolean(i.done) }))
    };
    for (const item of weekly.items) {
        item.count = 0;
        item.done = false;
    }
    weekly.weekStart = current;
    weekly.lastResetAt = new Date(at).toISOString();

    return true;
}

/** Restore known item IDs, ignoring definitions removed since the snapshot. */
function undoWeeklyReset(weekly) {
    const prev = weekly.previous;
    if (!prev) return false;
    for (const saved of prev.progress || []) {
        const item = weekly.items.find((i) => i.id === saved.id);
        if (item) {
            item.count = Number(saved.count) || 0;
            item.done = Boolean(saved.done);
        }
    }
    weekly.weekStart = prev.weekStart;
    weekly.previous = null;

    return true;
}

module.exports = { applyWeeklyEvent, rolloverWeek, undoWeeklyReset };
