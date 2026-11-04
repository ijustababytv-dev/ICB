'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.LAMBDA_TASK_ROOT || path.resolve(__dirname, '../../..');
const catalog = JSON.parse(
    fs.readFileSync(path.join(root, 'database/feature-catalog.json'), 'utf8')
);
const owned = catalog.filter((item) => item.scope === 'owner');
const byFile = new Map(owned.map((item) => [item.file, item]));
const byFeature = new Map(owned.map((item) => [item.feature, item]));

/** Distinguish machine-owned files from feature state and reject arbitrary input paths. */
function descriptor(feature) {
    const item = byFeature.get(feature);
    if (!item)
        throw Object.assign(new Error('unknown_feature'), { status: 404, code: 'unknown_feature' });
    return item;
}

module.exports = { catalog, owned, byFile, byFeature, descriptor };
