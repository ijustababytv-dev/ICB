'use strict';
const path = require('node:path');
const { fail } = require('../activity/errors');

/** Attach only an indexed relative artwork file from the feature's own local library. */
function assetName(files, folder, reference) {
    const prefix =
        String(folder)
            .replaceAll('\\', '/')
            .replace(/^\/icb\//, '') + '/';
    if (typeof reference !== 'string' || !reference.startsWith(prefix))
        throw fail(400, 'invalid_asset_reference');
    const name = reference.slice(prefix.length);
    if (
        !name ||
        name !== path.posix.basename(name) ||
        !/\.(png|jpe?g|webp|gif)$/i.test(name) ||
        !files.existsSync('/icb/' + reference)
    )
        throw fail(400, 'invalid_asset_reference');
    return name;
}

module.exports = { assetName };
