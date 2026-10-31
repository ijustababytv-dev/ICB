'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const fs = context.files;
    const path = require('node:path');
    const mConfig = context.config;
    const mStorage = context.storage;
    const mEvents = context.events;
    const mHttpResponse = context.response;
    const mHttpBody = context.body;
    const mDomainOceanFish = require('../../domain/ocean-fish');

    // ---------------------------------------------------------------------------
    // OCEAN FISH (Baby, 2026-10-24) - ocean waves along the bottom of the stream with
    // fish that jump out now and then. No chat commands (Baby's choice).
    //   - Overlay:   /ocean-fish.html (ES5, polls /api/oceanfish every 2 s)
    //   - Dashboard: /ocean-fish-control.html
    //   - Saved in data/oceanfish.json; rules in domain/ocean-fish.js
    //   - Fish pictures: assets/ocean-fish/ (local only, never on GitHub). Each jump picks one of
    //     the ticked fish (random or in order); the built-in fish can be in the mix.
    // ---------------------------------------------------------------------------
    const OFISH_FILE = path.join(mConfig.DATA_DIR, 'oceanfish.json');
    const OFISH_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'ocean-fish');
    const MAX_PICTURE_BYTES = 8 * 1024 * 1024;

    /** Save an uploaded data URL as a real file in assets/ocean-fish and return its name. */
    function writeFishPicture(dataUrl, name) {
        const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
            String(dataUrl || '')
        );
        if (!match) throw new Error('Picture must be a PNG, JPG, WEBP, or GIF.');
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > MAX_PICTURE_BYTES) throw new Error('Picture is too large (max 8MB).');
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const base =
            mDomainOceanFish
                .cleanFishName(name)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'fish';
        fs.mkdirSync(OFISH_ART_DIR, { recursive: true });
        let file = `${base}.${ext}`;
        // Never overwrite an existing picture; number the new one instead.
        for (let n = 2; fs.existsSync(path.join(OFISH_ART_DIR, file)); n += 1)
            file = `${base}-${n}.${ext}`;
        fs.writeFileSync(path.join(OFISH_ART_DIR, file), buffer);
        return file;
    }

    /**
     * Restore saved settings. Early test builds kept one picture inline as `fishImage` with a
     * global `facesLeft`; that picture moves into the fish list once, then the file is rewritten.
     */
    function ofishLoad() {
        const raw = mStorage.readJson(OFISH_FILE, null) || {};
        const state = {
            ...mDomainOceanFish.oceanFishDefaults(),
            ...raw,
            fish: Array.isArray(raw.fish) ? raw.fish : []
        };
        if (raw.fishImage) {
            try {
                mDomainOceanFish.addFish(
                    state,
                    'My fish',
                    writeFishPicture(raw.fishImage, 'my-fish'),
                    raw.facesLeft
                );
                state.useDefault = false; // the old picture used to replace the built-in fish
            } catch (_error) {
                // An unreadable old picture is dropped rather than blocking startup.
            }
        }
        const migrate = raw.fishImage !== undefined || raw.facesLeft !== undefined;
        delete state.fishImage;
        delete state.facesLeft;
        if (migrate) mStorage.writeJson(OFISH_FILE, state);
        return state;
    }

    let ofish = ofishLoad();
    const commands = { seq: 0, list: [] }; // in memory only; see queueCommands

    /** Build the response the dashboard and overlay read, including picture URLs and commands. */
    function ofishPublic() {
        return {
            ok: true,
            ...ofish,
            fish: ofish.fish.map((f) => ({
                ...f,
                url: `/assets/ocean-fish/${encodeURIComponent(f.file)}`
            })),
            commands: { seq: commands.seq, list: commands.list }
        };
    }

    /** Persist settings and tell open dashboards. */
    function ofishSave() {
        mStorage.writeJson(OFISH_FILE, ofish);
        mEvents.broadcast('oceanfish', ofishPublic());
    }

    /** Handle GET/POST /api/oceanfish. */
    async function handleOceanFishApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/oceanfish' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, ofishPublic());
            if (pathname === '/api/oceanfish' && method === 'POST') {
                const body = await mHttpBody.readBody(req);
                mDomainOceanFish.applySettings(ofish, body);
                if (body.addFish) {
                    // Check the limit before saving a picture so a full list leaves no stray file.
                    if (ofish.fish.length >= mDomainOceanFish.MAX_FISH)
                        throw new Error(`That's the most fish (${mDomainOceanFish.MAX_FISH}).`);
                    const file = writeFishPicture(body.addFish.image, body.addFish.name);
                    mDomainOceanFish.addFish(
                        ofish,
                        body.addFish.name,
                        file,
                        body.addFish.facesLeft
                    );
                }
                mDomainOceanFish.applyFishEdits(ofish, body);
                mDomainOceanFish.queueCommands(commands, body);
                ofishSave();
                return mHttpResponse.sendJson(res, 200, { ok: true });
            }
            return mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown ocean fish route.'
            });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Ocean fish request failed.'
            });
        }
    }

    Object.assign(exports, { handleOceanFishApi, ofishPublic });
};
