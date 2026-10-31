'use strict';
const { byFile } = require('../../../cloud-server/src/features/catalog');
const { routeFor } = require('../../../cloud-server/src/features/executor');

/** Merge an older in-flight feed without undoing newer committed feature commands or skipping its cursor. */
function mergeSnapshot(previous, payload, command) {
    const next = {
        ...previous,
        revision: command ? previous.revision : payload.revision,
        observed_revision: Math.max(previous.observed_revision || 0, payload.revision),
        documents: { ...previous.documents },
        views: { ...previous.views },
        authorities: { ...previous.authorities },
        view_revisions: { ...previous.view_revisions },
        intents:
            payload.revision >= (previous.observed_revision || 0)
                ? payload.intents || previous.intents
                : previous.intents
    };
    const incoming = (feature) => payload.authorities?.[feature]?.revision ?? payload.revision;

    const known = (feature) => previous.authorities?.[feature]?.revision ?? 0;

    for (const [file, value] of Object.entries(payload.documents || {})) {
        const feature = byFile.get(file)?.feature;
        if (incoming(feature) >= known(feature)) next.documents[file] = value;
    }
    for (const [path, value] of Object.entries(payload.views || {})) {
        const feature = routeFor(path).route[0];
        if (
            incoming(feature) >= known(feature) &&
            incoming(feature) >= (previous.view_revisions?.[path] || 0)
        ) {
            next.views[path] = value;
            next.view_revisions[path] = incoming(feature);
        }
    }
    for (const [feature, value] of Object.entries(payload.authorities || {})) {
        const delivered =
            Object.keys(payload.documents || {}).some(
                (file) => byFile.get(file)?.feature === feature
            ) ||
            Object.keys(payload.views || {}).some((path) => routeFor(path).route[0] === feature);
        if (value.revision >= known(feature))
            next.authorities[feature] = {
                ...value,
                revision: delivered ? value.revision : known(feature)
            };
    }
    return next;
}

module.exports = { mergeSnapshot };
