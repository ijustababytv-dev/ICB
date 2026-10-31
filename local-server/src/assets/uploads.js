'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const config = require('../config');

/** Store artwork only on this PC with a bounded image format and immutable, collision-safe filename. */
function writeImage(folder, data, displayName) {
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
        String(data || '')
    );
    if (!match) throw new Error('Picture must be a PNG, JPG, WEBP, or GIF.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 9 * 1024 * 1024)
        throw new Error('Picture is too large (max 9MB).');
    const ext = /^jpe?g$/.test(match[1]) ? 'jpg' : match[1];
    const signatures = {
        png: bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
        jpg: bytes[0] === 255 && bytes[1] === 216,
        gif: /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6)),
        webp: bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    };
    if (!signatures[ext]) throw new Error('Picture contents do not match its format.');
    const base =
        String(displayName || 'image')
            .replace(/\.[a-z0-9]+$/i, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 40) || 'image';
    const name =
        base + '-' + createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '.' + ext;
    const root = path.join(config.APP_DIR, 'assets');
    const target = path.resolve(root, folder);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid artwork folder.');
    fs.mkdirSync(target, { recursive: true });
    if (!fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep))
        throw new Error('Invalid artwork folder.');
    try {
        fs.writeFileSync(path.join(target, name), bytes, { flag: 'wx' });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    return 'assets/' + folder.replaceAll('\\', '/') + '/' + name;
}

/** Replace upload transport with a small asset reference before any cloud command or outbox sees it. */
async function prepareUpload(route, values, method) {
    const committed = require('./operations').prepareOperation(route, method, values, writeImage);
    let folder;
    if (route === '/api/aniimo/image') folder = 'aniimo';
    else if (route === '/api/sprites/image') folder = 'sprites';
    else if (route === '/api/sprites/jar/image') folder = 'sprite-jar';
    else if (route === '/api/poll/image') folder = 'poll';
    else if (route === '/api/party/image') folder = 'party';
    else if (route === '/api/decor/library') folder = 'decor/misc';
    else if (/^\/api\/decor\/effects\/[a-z0-9-]+\/images$/.test(route))
        folder = 'decor/' + route.split('/')[4];
    else if (route === '/api/avatars/image') folder = 'avatars';
    else if (route === '/api/walkers/person-art') folder = 'decor/unicorn-personal';
    else if (route === '/api/walkers/art')
        folder = values.pool === 'subs' ? 'decor/unicorn-subs' : 'decor/unicorn';
    if (folder && values.dataUrl) {
        values.asset_ref = writeImage(folder, values.dataUrl, values.name || values.id);
        delete values.dataUrl;
    }
    if (route === '/api/turnline' && values.upload) {
        values.upload = {
            asset_ref: writeImage('turn-line', values.upload.data, values.upload.name)
        };
    }
    if (route.startsWith('/api/tradeup/items') && values.imageDataUrl) {
        values.image_ref = writeImage('tradeup', values.imageDataUrl, values.name);
        delete values.imageDataUrl;
    }
    if (route === '/api/oceanfish' && values.addFish?.image) {
        values.addFish.asset_ref = writeImage(
            'ocean-fish',
            values.addFish.image,
            values.addFish.name
        );
        delete values.addFish.image;
    }
    if (values.asset_ref || values.image_ref || values.upload || values.addFish?.asset_ref)
        await require('./references').syncAssets();
    return {
        values,
        afterCommit: async () => {
            for (const operation of committed) operation();
            if (committed.length) await require('./references').syncAssets();
        }
    };
}

module.exports = { writeImage, prepareUpload };
