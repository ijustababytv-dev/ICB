'use strict';
/** Apply sprite commands using transaction-scoped state and local-asset references. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const fs = context.files;
    const path = require('node:path');
    const sprites = context.use('sprites');
    const mSpriteJar = context.use('sprite-jar');
    const mConfig = context.config;
    const mStorage = context.storage;
    const mHttpBody = context.body;
    const mHttpResponse = context.response;
    const mDomainValidation = require('../../../domain/validation');
    /** Coordinate sprite edits and jar animations without circular feature imports. */
    async function handleSpritesApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/sprites/jar' || pathname.startsWith('/api/sprites/jar/'))
                return await mSpriteJar.handleSpriteJarApi(req, res, pathname, method);
            if (pathname === '/api/sprites' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, sprites.sprPublic());
            if (pathname === '/api/sprites/admin' && method === 'GET') {
                const ap = mSpriteJar.sjArtPublic(),
                    art = ap.urls;
                return mHttpResponse.sendJson(res, 200, {
                    ...sprites.sprPublic(),
                    needArt: ap.need,
                    sprites: sprites.spr.sprites.map((s) => ({
                        ...s,
                        img: sprites.sprImg(s),
                        art: art[s.id] || {}
                    })),
                    caught: sprites.spr.caught,
                    rarities: sprites.SPR_RARITIES,
                    popupSec: sprites.spr.popupSec
                });
            }
            if (pathname === '/api/sprites' && method === 'POST') {
                const b = await mHttpBody.readBody(req);
                if (b.catch && b.catch.id) {
                    const had =
                        !!sprites.spr.caught[
                            sprites.sprKey(b.catch.id, sprites.sprCleanVar(b.catch.variant))
                        ];
                    sprites.sprSet(
                        b.catch.id,
                        sprites.sprCleanVar(b.catch.variant),
                        b.catch.on !== false
                    );
                    const s0 = sprites.sprFind(b.catch.id); // jar overlay: play the float-into-the-book when she ticks it here (her switch)
                    if (s0 && b.catch.on !== false && !had && mSpriteJar.sjCfg().dashPlays)
                        mSpriteJar.sjPush(s0, sprites.sprCleanVar(b.catch.variant), {
                            kind: 'catch'
                        });
                }
                if (b.catchAll && b.catchAll.id) {
                    const s = sprites.sprFind(b.catchAll.id);
                    if (s)
                        for (const v of s.variants)
                            sprites.sprSet(s.id, v, b.catchAll.on !== false);
                }
                if (typeof b.season === 'string' && mDomainValidation.cleanString(b.season))
                    sprites.spr.season = mDomainValidation.cleanString(b.season).slice(0, 60);
                if (b.popupSec !== undefined)
                    sprites.spr.popupSec = Math.max(
                        2,
                        Math.min(60, Math.round(Number(b.popupSec)) || 8)
                    );
                if (b.saveSprite) {
                    const old = b.saveSprite.id ? sprites.sprFind(b.saveSprite.id) : null;
                    const s = sprites.sprClean(b.saveSprite, old ? old.id : null);
                    if (!s.name)
                        return mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'A sprite needs a name.'
                        });
                    if (old) {
                        s.image = old.image;
                        for (const v of old.variants)
                            if (!s.variants.includes(v))
                                delete sprites.spr.caught[sprites.sprKey(old.id, v)];
                        Object.assign(old, s);
                    } else {
                        let id = s.id || 'sprite',
                            n = 2;
                        while (sprites.sprFind(id)) id = `${s.id}-${n++}`;
                        s.id = id;
                        sprites.spr.sprites.push(s);
                    }
                }
                if (b.removeSprite) {
                    const s = sprites.sprFind(b.removeSprite);
                    if (s) {
                        for (const v of s.variants)
                            delete sprites.spr.caught[sprites.sprKey(s.id, v)];
                        sprites.spr.sprites = sprites.spr.sprites.filter((x) => x !== s);
                        sprites.spr.recent = sprites.spr.recent.filter((r) => r.id !== s.id);
                    }
                }
                if (b.move && b.move.id) {
                    const i = sprites.spr.sprites.findIndex((s) => s.id === b.move.id),
                        j = i + (Number(b.move.dir) < 0 ? -1 : 1);
                    if (i >= 0 && j >= 0 && j < sprites.spr.sprites.length) {
                        const t = sprites.spr.sprites[i];
                        sprites.spr.sprites[i] = sprites.spr.sprites[j];
                        sprites.spr.sprites[j] = t;
                    }
                }
                if (b.addVariantAll) {
                    const v = sprites.sprCleanVar(b.addVariantAll);
                    if (v)
                        for (const s of sprites.spr.sprites)
                            if (s.variants.length > 1 && !s.variants.includes(v))
                                s.variants.push(v);
                }
                // New season: save this season to its own file, then start fresh (keep sprites? her choice).
                if (b.newSeason) {
                    const name = mDomainValidation.cleanString(b.newSeason).slice(0, 60);
                    mStorage.writeJson(
                        path.join(
                            mConfig.DATA_DIR,
                            `sprites-${
                                sprites.sprSlug(sprites.spr.season) || 'old'
                            }-${Date.now()}.json`
                        ),
                        sprites.spr
                    );
                    sprites.spr = {
                        season: name || 'New season',
                        sprites: b.keepSprites ? sprites.spr.sprites : [],
                        caught: {},
                        recent: [],
                        popupSec: sprites.spr.popupSec,
                        jar: sprites.spr.jar
                    };
                }
                if (b.resetCatches === 'yes') {
                    sprites.spr.caught = {};
                    sprites.spr.recent = [];
                }
                sprites.sprSave();
                return mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (pathname === '/api/sprites/image' && method === 'POST') {
                const b = await mHttpBody.readBody(req);
                const s = sprites.sprFind(b.id);
                if (!s)
                    return mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'No sprite with that id.'
                    });
                if (s.image) {
                    try {
                        fs.unlinkSync(path.join(sprites.SPR_ART_DIR, s.image));
                    } catch (_e) {}
                }
                if (b.remove) {
                    s.image = '';
                    sprites.sprSave();
                    return mHttpResponse.sendJson(res, 200, { ok: true });
                }
                const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
                    String(b.dataUrl || '')
                );
                if (!m)
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Picture must be a PNG, JPG, WEBP, or GIF.'
                    });
                const buf = Buffer.from(m[2], 'base64');
                if (buf.length > 9 * 1024 * 1024)
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Picture is too large.'
                    });
                s.image = `${s.id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
                fs.writeFileSync(path.join(sprites.SPR_ART_DIR, s.image), buf);
                sprites.sprSave();
                return mHttpResponse.sendJson(res, 200, { ok: true, img: sprites.sprImg(s) });
            }
            if (pathname === '/api/sprites/export' && method === 'GET') {
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="sprites-backup.json"'
                });
                return res.end(JSON.stringify(sprites.spr, null, 2));
            }
            return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown sprites route.' });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Sprites request failed.'
            });
        }
    }

    Object.assign(exports, { handleSpritesApi });
};
