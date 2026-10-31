'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { sendJson } = require('../http/response');

/** Explicitly import the fixed local catch file, then archive it only after the cloud command commits. */
async function handleSpriteImport(req, res) {
    const source = path.join(config.DATA_DIR, 'sprites-import.json');
    if (!fs.existsSync(source))
        return sendJson(res, 404, { ok: false, error: 'No local sprite catch file is waiting.' });
    if (fs.statSync(source).size > 200000)
        return sendJson(res, 413, { ok: false, error: 'Sprite import is too large.' });
    const input = fs.readFileSync(source, 'utf8');
    const facts = JSON.parse(input);
    if (Object.keys(facts).some((key) => !['caught', 'rarity'].includes(key)))
        throw new Error('Unsupported sprite import fields.');
    const result = await require('../cloud/features').command(
        'sprites',
        { path: '/api/sprites', method: 'POST', values: { importFacts: facts } },
        'request',
        require('../cloud/browser-revisions').expectedRevision(req, 'sprites')
    );
    if (fs.readFileSync(source, 'utf8') !== input)
        throw new Error('Catch file changed during import; it remains available for review.');
    const backup = path.join(config.APP_DIR, 'backups', 'sprite-imports');
    fs.mkdirSync(backup, { recursive: true });
    fs.renameSync(source, path.join(backup, 'sprites-imported-' + Date.now() + '.json'));
    return sendJson(res, result.status, result.payload);
}

module.exports = { handleSpriteImport };
