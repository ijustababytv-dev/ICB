'use strict';
const COLUMNS = [
    'messages',
    'active_windows',
    'sub_events',
    'sub_months',
    'gifted_subs',
    'bits',
    'follows',
    'raids',
    'raid_viewers',
    'ticket_delta',
    'unknown_award_events'
];

/** Map events to independent counters; gifts never imply a personal subscription. */
function deltas(record) {
    const result = Object.fromEntries(COLUMNS.map((column) => [column, 0]));
    if (record.type === 'chat_count') result.messages = record.message_delta;
    if (record.type === 'chat_window') result.active_windows = 1;
    if (record.type === 'sub') {
        result.sub_events = 1;
        result.sub_months = record.months;
    }
    if (record.type === 'gifts') result.gifted_subs = record.quantity;
    if (record.type === 'bits') result.bits = record.bits;
    if (record.type === 'follow') result.follows = 1;
    if (record.type === 'raid') {
        result.raids = 1;
        result.raid_viewers = record.raid_size;
    }
    result.ticket_delta = record.ticket_delta || 0;
    result.unknown_award_events = record.ticket_delta === null ? 1 : 0;
    return result;
}

module.exports = { deltas, COLUMNS };
