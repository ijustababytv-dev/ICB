'use strict';
const { randomUUID } = require('node:crypto');
const { reportingDay } = require('./reporting-day');
const PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'fourthwall', 'meld', 'unknown'];

/** Persist identity only; chat text and presentation/provider metadata never enter this DTO. */
function identity(body) {
    const platform = PLATFORMS.includes(body.platform) ? body.platform : 'twitch';
    const name =
        typeof body.username === 'string'
            ? body.username.trim().replace(/^@/, '').slice(0, 80)
            : '';
    if (!name || body.anonymous) return null;
    const source =
        typeof body.platform_user_id === 'string' ? body.platform_user_id.slice(0, 160) : null;
    return {
        platform,
        platform_user_id: source || null,
        username: name.toLowerCase(),
        display_name: name
    };
}

/** Build the common minimal envelope using trusted collection time rather than incoming chat text. */
function envelope(type, body, timezone = 'America/Chicago', at = new Date().toISOString()) {
    const viewer = identity(body);
    return {
        id: randomUUID(),
        type,
        at,
        day: reportingDay(at, timezone),
        timezone,
        viewer,
        platform:
            viewer?.platform || (PLATFORMS.includes(body.platform) ? body.platform : 'twitch'),
        source_id:
            typeof body.source_id === 'string' && body.source_id.length <= 160
                ? body.source_id
                : null
    };
}

module.exports = { identity, envelope };
