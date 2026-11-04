'use strict';
/** Static feature options, shared without changing runtime state. */
const SASHI_BUILTIN_IGNORE = [
    'here',
    'checkin',
    'signin',
    'leave',
    'party',
    'show',
    'team',
    'vote',
    'unvote',
    'lurk',
    'unlurk',
    'discord',
    'socials',
    'so',
    'shoutout',
    'hug',
    'commands',
    'uptime',
    'followage',
    'raid',
    'giveaway',
    'enter',
    'join',
    'help',
    'points',
    'unicorns',
    'jar',
    'sashimi',
    'sr',
    'song',
    'time',
    'signup',
    'need',
    'dex',
    'event',
    'hide',
    'burger',
    'burgers',
    'beanburger',
    'flow',
    'flowtree',
    'flowtrees'
];

const SASHI_RESERVED = new Set([
    'leave',
    'here',
    'checkin',
    'signin',
    'party',
    'show',
    'team',
    'vote',
    'unvote',
    'signup',
    'need',
    'dex',
    'event',
    'hide',
    'burger',
    'burgers',
    'beanburger',
    'flow',
    'flowtree',
    'flowtrees'
]);

const SASHI_ZONE_PRESETS = [
    { label: 'Hawaii', tz: 'Pacific/Honolulu' },
    { label: 'Alaska', tz: 'America/Anchorage' },
    { label: 'Pacific', tz: 'America/Los_Angeles' },
    { label: 'Arizona', tz: 'America/Phoenix' },
    { label: 'Mountain', tz: 'America/Denver' },
    { label: 'Central', tz: 'America/Chicago' },
    { label: 'Eastern', tz: 'America/New_York' },
    { label: 'Brazil', tz: 'America/Sao_Paulo' },
    { label: 'UK', tz: 'Europe/London' },
    { label: 'Central Europe', tz: 'Europe/Berlin' },
    { label: 'Eastern Europe', tz: 'Europe/Athens' },
    { label: 'India', tz: 'Asia/Kolkata' },
    { label: 'Philippines', tz: 'Asia/Manila' },
    { label: 'Japan', tz: 'Asia/Tokyo' },
    { label: 'Sydney', tz: 'Australia/Sydney' },
    { label: 'New Zealand', tz: 'Pacific/Auckland' }
];

const SASHI_ZONE_DEFAULT_ON = [
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'Europe/London',
    'Europe/Berlin',
    'Australia/Sydney'
];
module.exports = {
    SASHI_BUILTIN_IGNORE,
    SASHI_RESERVED,
    SASHI_ZONE_PRESETS,
    SASHI_ZONE_DEFAULT_ON
};
