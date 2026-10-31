'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const feed = require('../cloud/state-feed');

/** Resolve an existing ordinary artwork file without allowing a junction or filename to escape assets. */
function assetFile(relative) {
    const root = fs.realpathSync(path.join(config.APP_DIR, 'assets'));
    const file = path.resolve(config.APP_DIR, relative);
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile())
        throw new Error('Invalid artwork file.');
    return real;
}

/** Keep replaced/removed originals in a nearby ignored recovery folder instead of deleting them. */
function retire(relative) {
    const file = assetFile(relative);
    const folder = path.join(path.dirname(file), '_removed');
    fs.mkdirSync(folder, { recursive: true });
    if (fs.realpathSync(folder) !== folder) throw new Error('Invalid artwork recovery folder.');
    fs.renameSync(file, path.join(folder, Date.now() + '-' + path.basename(file)));
}

/** Derived sticker thumbnails are machine files; their names bind to the actual source image version. */
function sticker(values, writeImage) {
    const entry = (feed.view('/api/sprites/admin')?.needArt || []).find(
        (item) => item.id === values.id && item.variant === values.variant
    );
    if (!entry) throw new Error('Refresh the sprite artwork list first.');
    const relative = decodeURIComponent(entry.src.replace(/^\//, ''));
    if (!relative.startsWith('assets/sprites/')) throw new Error('Invalid sticker source.');
    const modified = Math.round(fs.statSync(assetFile(relative)).mtimeMs);
    const slug = String(values.variant)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    if (!/^[a-z0-9-]+$/.test(values.id) || !slug) throw new Error('Invalid sticker identity.');
    const desired =
        'assets/sprite-jar/stickers/' + values.id + '__' + slug + '-' + modified + '.webp';
    const written = writeImage('sprite-jar/stickers', values.dataUrl, values.id);
    if (!written.endsWith('.webp')) throw new Error('Sticker thumbnail must be WEBP.');
    const target = path.join(config.APP_DIR, desired);
    if (fs.existsSync(target)) retire(desired);
    fs.copyFileSync(assetFile(written), target, fs.constants.COPYFILE_EXCL);
    values.asset_ref = desired;
    delete values.dataUrl;
}

/** Local file moves return just the new reference; cloud rules preserve people and selected settings. */
function prepareOperation(route, method, values, writeImage) {
    const committed = [];
    if (route === '/api/sprites/jar/sticker' && values.dataUrl) sticker(values, writeImage);
    const decor = /^\/api\/decor\/effects\/([a-z0-9-]+)\/images\/([^/]+)$/.exec(route);
    if (decor && method === 'DELETE') {
        const name = decodeURIComponent(decor[2]);
        if (name !== path.basename(name)) throw new Error('Invalid artwork file.');
        committed.push(() => retire('assets/decor/' + decor[1] + '/' + name));
        values.local_removed = true;
    }
    if (route === '/api/avatars/image' && values.remove) {
        const name = fs
            .readdirSync(path.join(config.APP_DIR, 'assets/avatars'))
            .find((file) => file.replace(/\.[^.]+$/, '') === values.remove);
        if (name) committed.push(() => retire('assets/avatars/' + name));
    }
    if (values.remove && ['/api/aniimo/image', '/api/sprites/image'].includes(route)) {
        const aniimo = route.includes('aniimo');
        const entry = aniimo
            ? feed.view('/api/aniimo/admin')?.roster?.find((item) => item.id === values.id)
            : feed.document('sprites.json')?.sprites?.find((item) => item.id === values.id);
        const name = values.variant ? entry?.formImages?.[values.variant] : entry?.image;
        const url = aniimo && !values.variant && !name ? entry?.img : null;
        const relative = name
            ? 'assets/' + (aniimo ? 'aniimo/' : 'sprites/') + name
            : url
            ? decodeURIComponent(url.split('?')[0].replace(/^\//, ''))
            : null;
        if (relative) committed.push(() => retire(relative));
    }
    if (route === '/api/sprites/jar' && values.removeJar) {
        const name = feed.document('sprites.json')?.jar?.jarImage;
        if (name) committed.push(() => retire('assets/sprite-jar/' + name));
    }
    if (route === '/api/walkers/art/move') {
        const name = String(values.file || '');
        if (!name || name !== path.basename(name)) throw new Error('Invalid artwork file.');
        const to = values.to === 'subs' ? 'unicorn-subs' : 'unicorn';
        const from = to === 'unicorn' ? 'unicorn-subs' : 'unicorn';
        const original = assetFile('assets/decor/' + from + '/' + name);
        const folder = path.join(config.APP_DIR, 'assets/decor', to);
        fs.mkdirSync(folder, { recursive: true });
        if (fs.realpathSync(folder) !== folder) throw new Error('Invalid artwork folder.');
        let target = name;
        for (let n = 2; fs.existsSync(path.join(folder, target)); n++)
            target = path.parse(name).name + '-' + n + path.extname(name);
        fs.copyFileSync(original, path.join(folder, target), fs.constants.COPYFILE_EXCL);
        committed.push(() => retire('assets/decor/' + from + '/' + name));
        values.asset_ref = 'assets/decor/' + to + '/' + target;
    }
    return committed;
}

module.exports = { assetFile, retire, prepareOperation };
