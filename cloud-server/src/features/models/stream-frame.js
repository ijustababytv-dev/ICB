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
    const mDomainStreamFrame = require('../../domain/stream-frame');

    // ---------------------------------------------------------------------------
    // STREAM FRAME (Baby, 2026-10-25) - her full-screen synthwave overlay picture brought to life:
    // neon glow and flicker, a light running round the camera and game frames, sun shimmer,
    // twinkling stars and sparkles, colour shift, a power-on intro, and reactions to follows,
    // subs, gifted subs, bits and raids (fed from the Meld listener's stream events).
    //   - Overlay:   /stream-frame.html (ES5, polls /api/streamframe every 2 s)
    //   - Dashboard: /stream-frame-control.html
    //   - Saved in data/streamframe.json; rules in domain/stream-frame.js
    //   - Overlay art: assets/stream-frame/ (local only, never on GitHub)
    // ---------------------------------------------------------------------------
    const FRAME_FILE = path.join(mConfig.DATA_DIR, 'streamframe.json');
    const FRAME_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'stream-frame');
    const MAX_ART_BYTES = 15 * 1024 * 1024;

    /** Restore saved settings, filling in anything new with its default. */
    function frameLoad() {
        const raw = mStorage.readJson(FRAME_FILE, null) || {};
        const d = mDomainStreamFrame.streamFrameDefaults();
        return { ...d, ...raw, reactions: { ...d.reactions, ...(raw.reactions || {}) } };
    }

    let frame = frameLoad();
    const commands = { seq: 0, list: [] }; // in memory only; a restarted overlay skips old ones

    /** Save an uploaded overlay picture (data URL) as a real file and return its name. */
    function writeArt(dataUrl, name) {
        const match = /^data:image\/(png|webp);base64,(.+)$/.exec(String(dataUrl || ''));
        if (!match)
            throw new Error('Overlay art must be a PNG or WEBP with a see-through camera hole.');
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > MAX_ART_BYTES) throw new Error('Picture is too large (max 15MB).');
        const base =
            String(name || 'overlay')
                .replace(/\.[a-z0-9]+$/i, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40) || 'overlay';
        fs.mkdirSync(FRAME_ART_DIR, { recursive: true });
        let file = `${base}.${match[1]}`;
        // Never overwrite an existing picture; number the new one instead.
        for (let n = 2; fs.existsSync(path.join(FRAME_ART_DIR, file)); n += 1)
            file = `${base}-${n}.${match[1]}`;
        fs.writeFileSync(path.join(FRAME_ART_DIR, file), buffer);
        return file;
    }

    /** Build the response the dashboard and overlay read: settings, art URL, and commands. */
    function framePublic() {
        return {
            ok: true,
            ...frame,
            artUrl: `/assets/stream-frame/${encodeURIComponent(frame.art)}`,
            artFound: fs.existsSync(path.join(FRAME_ART_DIR, frame.art)),
            commands: { seq: commands.seq, list: commands.list }
        };
    }

    /** Persist settings and tell open dashboards. */
    function frameSave() {
        mStorage.writeJson(FRAME_FILE, frame);
        mEvents.broadcast('streamframe', framePublic());
    }

    /**
     * Called for every non-chat stream event from the Meld listener (follow, sub, gifts, bits,
     * raid). Queues an overlay reaction when that reaction is switched on. Never throws, so a
     * frame problem can never break giveaway counting.
     */
    function frameEvent(type, username, body) {
        try {
            mDomainStreamFrame.eventReaction(frame, commands, type, { ...body, username });
        } catch (_error) {
            // Reactions are decoration only.
        }
    }

    /** Handle GET/POST /api/streamframe. */
    async function handleStreamFrameApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/streamframe' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, framePublic());
            if (pathname === '/api/streamframe' && method === 'POST') {
                const body = await mHttpBody.readBody(req);
                mDomainStreamFrame.applySettings(frame, body);
                if (body.uploadArt) frame.art = writeArt(body.uploadArt.image, body.uploadArt.name);
                mDomainStreamFrame.dashboardCommand(commands, body);
                frameSave();
                return mHttpResponse.sendJson(res, 200, { ok: true, art: frame.art });
            }
            return mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown stream frame route.'
            });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Stream frame request failed.'
            });
        }
    }

    Object.assign(exports, { handleStreamFrameApi, framePublic, frameEvent });
    context.runtime.register(
        'streamframe',
        () => ({ commands }),
        (value) => {
            Object.assign(commands, value.commands);
        }
    );
};
