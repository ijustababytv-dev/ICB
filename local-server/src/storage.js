'use strict';

const fs = require('node:fs');

/** Return a detached JSON-compatible copy so views cannot mutate saved state. */
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/** Read persisted JSON, falling back to an independent default when absent or unreadable. */
function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_error) {
        return clone(fallback);
    }
}

/** Replace a JSON file atomically so interrupted saves do not leave partial state. */
function writeJson(file, value) {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
    require('./activity/state-sync').mark(file);
}

/** Retain saved fields while supplying new defaults; never mutate the default object. */
function mergeDefaults(defaults, value) {
    const output = clone(defaults);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
    for (const [key, item] of Object.entries(value)) {
        if (
            item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            output[key] &&
            typeof output[key] === 'object'
        ) {
            output[key] = mergeDefaults(output[key], item);
        } else {
            output[key] = item;
        }
    }
    return output;
}

Object.assign(exports, { readJson, mergeDefaults, writeJson, clone });
