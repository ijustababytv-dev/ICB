'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { owned } = require('../src/features/catalog');
const { sanitize } = require('../src/features/contracts');
const { createContext } = require('../src/features/context');
const { canonical } = require('../src/domain/canonical');

/** Read fresh frozen sources; excluded machine state, transcripts and credentials never enter an import payload. */
function featureSources(directory, projectRoot) {
    const defaults = createContext({}).initialize().documents;
    const runtime = require('../../local-server/config/runtime-defaults.json');
    defaults['settings.json'] ||= runtime.DEFAULT_SETTINGS;
    defaults['live.json'] ||= runtime.DEFAULT_LIVE;
    defaults['todos.json'] ||= { daily: [], weekly: [] };
    return owned.map((entry) => {
        const file =
            entry.feature === 'tradeup-config'
                ? fs.existsSync(path.join(directory, 'tradeup-game.json'))
                    ? path.join(directory, 'tradeup-game.json')
                    : path.join(projectRoot, 'local-server/config/tradeup-game.json')
                : path.join(directory, entry.file);
        const exists = fs.existsSync(file);
        const source = exists
            ? fs.readFileSync(file)
            : Buffer.from(JSON.stringify(defaults[entry.file] || {}));
        const parsed = JSON.parse(source.toString('utf8').replace(/^\uFEFF/, ''));
        if (parsed.cloudAuditPending?.length)
            throw new Error('Reconcile legacy applied-award markers before cutover.');
        const payload = sanitize(parsed);
        const allowed = new Set([
            ...entry.fields,
            ...entry.progress,
            'runtime',
            'seq',
            'epoch',
            'rseq',
            'updatedAt',
            'recent',
            'liveId'
        ]);
        const unsupported = Object.keys(payload).filter((key) => !allowed.has(key));
        if (unsupported.length)
            throw new Error(
                'Unmapped feature fields: ' + entry.file + ': ' + unsupported.join(',')
            );
        return {
            entry,
            file,
            exists,
            source,
            payload,
            sha256: createHash('sha256').update(source).digest('hex')
        };
    });
}

/** Compare every supported frozen field, allowing only documented additive defaults from typed hydration. */
function supportedProjection(template, value) {
    if (Array.isArray(template)) {
        if (!Array.isArray(value) || template.length !== value.length)
            throw new Error('Imported array length differs.');
        return template.map((item, index) => supportedProjection(item, value[index]));
    }
    if (template && typeof template === 'object')
        return Object.fromEntries(
            Object.entries(template).map(([key, item]) => [
                key,
                supportedProjection(item, value?.[key])
            ])
        );
    return value;
}

/** A canonical digest verifies content without putting user state into terminal output. */
function projectedHash(template, value) {
    return createHash('sha256')
        .update(canonical(supportedProjection(template, value)))
        .digest('hex');
}

module.exports = { featureSources, supportedProjection, projectedHash };
