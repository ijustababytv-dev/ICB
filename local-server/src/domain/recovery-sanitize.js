'use strict';
const FORBIDDEN =
    /^(?:__proto__|prototype|constructor|password|api_key|access_token|refresh_token|token|secret|authorization|raw|line|lastEvent|message|lastMessage|parts|fragments|senderInfo|bubble)$/i;

/** Copy allowlisted saved settings/progress, excluding transient chat fields and credentials. */
function sanitize(value, depth = 0) {
    if (depth > 15) throw new Error('state_too_deep');
    if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !FORBIDDEN.test(key))
                .map(([key, child]) => [key, sanitize(child, depth + 1)])
        );
    return value;
}

module.exports = { sanitize };
