'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');

/** Back up all catalogued feature sources and transport checkpoints, never an incomplete four-file subset. */
function backupState(project = root) {
    const catalog = JSON.parse(
        fs.readFileSync(path.join(project, 'database/feature-catalog.json'), 'utf8')
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = path.join(project, 'backups', 'state-' + stamp);
    fs.mkdirSync(directory, { recursive: true });
    const names = new Set(catalog.map((entry) => entry.file));
    for (const name of [
        'activity-outbox.json',
        'palia-cursor.json',
        'actions.jsonl',
        'legacy-palia-snapshot-20260814.json'
    ])
        names.add(name);
    const files = [];
    for (const name of names) {
        const source = path.join(project, 'data', name);
        if (!fs.existsSync(source)) continue;
        const bytes = fs.readFileSync(source);
        fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
        files.push({
            file: name,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes: bytes.length
        });
    }
    for (const name of [
        'tracker-skin-standard.json',
        'resource-trackers.json',
        'tradeup-game.json'
    ])
        fs.copyFileSync(
            path.join(project, 'local-server/config', name),
            path.join(
                directory,
                name === 'resource-trackers.json' ? 'resource-definitions.json' : name
            )
        );
    fs.writeFileSync(
        path.join(directory, 'backup-manifest.json'),
        JSON.stringify({ created_at: new Date().toISOString(), files }, null, 2)
    );
    return directory;
}

if (require.main === module) console.info('ICB state backup created: ' + backupState());
module.exports = { backupState };
