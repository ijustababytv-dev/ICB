'use strict';
const { byFeature } = require('../catalog');
const { clone } = require('../../domain/json');

/** Persist explicitly registered deadlines/cursors instead of relying on a warm Lambda process. */
function runtimeState(documents, storage) {
    const bindings = [];
    return {
        /** Factories expose only their bounded, non-chat operational fields. */
        register(feature, read, restore) {
            const file = byFeature.get(feature)?.file;
            if (!file) throw new Error('unknown_runtime_feature');
            const saved = documents[file]?.runtime;
            if (saved) restore(clone(saved));
            bindings.push({ file, read, before: JSON.stringify(read()) });
        },

        /** Publish runtime changes through the same document/revision transaction as business rows. */
        checkpoint() {
            for (const binding of bindings) {
                const value = binding.read();
                if (JSON.stringify(value) === binding.before) continue;
                storage.writeJson('/icb/data/' + binding.file, {
                    ...documents[binding.file],
                    runtime: { ...documents[binding.file]?.runtime, ...value }
                });
            }
        }
    };
}

module.exports = { runtimeState };
