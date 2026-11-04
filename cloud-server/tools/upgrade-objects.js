'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../database');

/** Pin administrative object installs separately from the current fresh-schema definitions. */
function upgradeDefinition(version, root = ROOT) {
    const file = path.join(root, 'upgrades', version.replace(/\.sql$/, '.json'));
    if (!fs.existsSync(file)) return null;
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (definition.version !== version || !Array.isArray(definition.objects))
        throw new Error('Invalid object upgrade.');
    const seen = new Set();
    for (const item of definition.objects) {
        if (
            !/^(tables|indexes|views|functions)\/[a-z0-9_-]+\.sql$/.test(item.file) ||
            !/^[a-f0-9]{64}$/.test(item.sha256) ||
            seen.has(item.file)
        )
            throw new Error('Invalid upgrade object.');
        seen.add(item.file);
    }
    return { definition, bytes: fs.readFileSync(file) };
}

/** Preserve old SQL-only migration hashes; new object manifests become part of the version checksum. */
function migrationHash(version, sql, root = ROOT) {
    const manifest = upgradeDefinition(version, root);
    const hash = createHash('sha256').update(sql);
    if (manifest) hash.update('\0').update(manifest.bytes);
    return hash.digest('hex');
}

/** Resolve exactly the pinned SQL, falling back to a retained administrative release bundle. */
function objectSource(version, item, root = ROOT) {
    const candidates = [
        path.join(root, item.file),
        path.resolve(root, '../dist/database-upgrades', version, item.file)
    ];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const bytes = fs.readFileSync(file);
        if (createHash('sha256').update(bytes).digest('hex') === item.sha256)
            return bytes.toString('utf8');
    }
    throw new Error(
        'Pinned object source unavailable; restore its administrative upgrade bundle: ' + version
    );
}

/** Install new objects on the existing migration transaction without putting CREATE TABLE in migrations. */
async function installUpgradeObjects(client, version, root = ROOT) {
    const manifest = upgradeDefinition(version, root);
    if (!manifest) return;
    for (const item of manifest.definition.objects)
        await client.query(objectSource(version, item, root));
}

module.exports = { upgradeDefinition, migrationHash, objectSource, installUpgradeObjects };
