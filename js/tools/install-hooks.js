'use strict';
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const existing = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: root,
    encoding: 'utf8'
});
if (existing.status !== 0 && existing.status !== 1)
    throw new Error('Cannot inspect Git hook configuration.');
if (existing.stdout.trim() && existing.stdout.trim() !== '.githooks')
    throw new Error(
        'Custom Git hooks are configured. Integrate the ICB guard into them instead of overwriting them.'
    );
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: root });
console.info('ICB pre-commit source policy enabled for this checkout.');
