'use strict';

/** Return detached JSON-compatible state; domain code has no filesystem dependency. */
function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

/** Merge supported defaults without sharing mutable state between account transactions. */
function mergeDefaults(defaults, value) {
    const result = clone(defaults);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
        result[key] =
            item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            result[key] &&
            typeof result[key] === 'object'
                ? mergeDefaults(result[key], item)
                : clone(item);
    }
    return result;
}

module.exports = { clone, mergeDefaults };
