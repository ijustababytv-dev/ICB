'use strict';
const path = require('node:path');
const { DATA_DIR } = require('./config');
const { readJson, writeJson } = require('./storage');
const { readBody } = require('./http/body');
const { sendJson } = require('./http/response');
const { broadcast } = require('./events');
const sprites = require('./sprites');
const jar = require('./sprite-jar');
const rules = require('./domain/sprite-tv');
const file = path.join(DATA_DIR, 'sprite-tv.json');
let settings = { ...rules.defaults(), ...(readJson(file, null) || {}) };

/** Resolve live sprite state on every request so season changes do not leave stale references. */
function publicState() {
    return {
        ok: true,
        settings,
        display: rules.displaySprite(
            settings,
            sprites.spr,
            jar.sjArtPublic().urls || {},
            sprites.sprImg
        ),
        now: Date.now()
    };
}

/** Connect cross-feature updates at startup without introducing circular feature imports. */
function connectSpriteUpdates() {
    return sprites.onSave(() => broadcast('spritetv', publicState()));
}

/** Dispatch TV reads and settings writes while keeping persistence outside the business rules. */
async function handleSpriteTvApi(req, res, pathname, method) {
    try {
        if (pathname === '/api/sprite-tv' && method === 'GET')
            return sendJson(res, 200, publicState());
        if (pathname === '/api/sprite-tv/slideshow' && method === 'GET')
            return sendJson(res, 200, {
                ok: true,
                sprites: rules.slideshowSprites(
                    settings,
                    sprites.spr,
                    jar.sjArtPublic().urls || {},
                    sprites.sprImg
                )
            });
        if (pathname === '/api/sprite-tv' && method === 'POST') {
            const body = await readBody(req);
            settings = rules.updateSettings(settings, body.set || {});
            writeJson(file, settings);
            broadcast('spritetv', publicState());
            return sendJson(res, 200, publicState());
        }
        return sendJson(res, 404, { ok: false, error: 'Unknown sprite-tv route.' });
    } catch (error) {
        return sendJson(res, 400, {
            ok: false,
            error: error.message || 'Sprite TV request failed.'
        });
    }
}

module.exports = { publicState, connectSpriteUpdates, handleSpriteTvApi };
