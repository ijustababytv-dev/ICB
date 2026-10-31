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
    const mDomainTurnLine = require('../../domain/turn-line');

    // ---------------------------------------------------------------------------
    // TURN LINE (Baby, 2026-10-29) - viewers sign up to take turns starting the same dish
    // (each person starts it about 10 times). The first person in line is green; when she clicks
    // Done they turn red and the next person turns green. The 10 starts are not counted by ICB,
    // the Done button is the only thing that moves the line. Rules in domain/turn-line.js.
    //   - Overlay:   /turn-line.html (ES5, polls /api/turnline every 2 s), its own Meld layer
    //   - Dashboard: /turn-line-control.html
    //   - Chat: "!turn" joins, "!leave" leaves (words from the Meld listener chat relay)
    //   - Saved in data/turnline.json
    // ---------------------------------------------------------------------------
    const FILE = path.join(mConfig.DATA_DIR, 'turnline.json');
    const ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'turn-line'); // backgrounds (local only, never on GitHub)
    const MAX_PICTURE_BYTES = 8 * 1024 * 1024;

    /** Picture file names Baby has put in assets/turn-line (by dropping them in or uploading). */
    function listImages() {
        try {
            return fs
                .readdirSync(ART_DIR)
                .filter((f) => mDomainTurnLine.isImageFile(f))
                .sort();
        } catch (_error) {
            return [];
        }
    }

    /** Save an uploaded data URL as a real file in assets/turn-line and return its name. */
    function writePicture(dataUrl, name) {
        const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
            String(dataUrl || '')
        );
        if (!match) throw new Error('Picture must be a PNG, JPG, WEBP, or GIF.');
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > MAX_PICTURE_BYTES) throw new Error('Picture is too large (max 8MB).');
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const base =
            String(name || '')
                .replace(/\.[a-z0-9]+$/i, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40) || 'background';
        fs.mkdirSync(ART_DIR, { recursive: true });
        let file = `${base}.${ext}`;
        // Never overwrite an existing picture; number the new one instead.
        for (let n = 2; fs.existsSync(path.join(ART_DIR, file)); n += 1)
            file = `${base}-${n}.${ext}`;
        fs.writeFileSync(path.join(ART_DIR, file), buffer);
        return file;
    }

    /** Restore the saved line and settings, filling in anything new with its default. */
    function load() {
        const raw = mStorage.readJson(FILE, null) || {};
        const state = { ...mDomainTurnLine.turnLineDefaults(), ...raw };
        state.people = (Array.isArray(raw.people) ? raw.people : [])
            .filter(
                (p) => p && typeof p.name === 'string' && ['wait', 'go', 'done'].includes(p.state)
            )
            .slice(0, mDomainTurnLine.MAX_PEOPLE);
        state.seq = Math.max(Number(state.seq) || 0, ...state.people.map((p) => Number(p.id) || 0));
        return mDomainTurnLine.settle(state);
    }

    let line = load();
    let changedAt = Date.now();

    /** What the overlay and dashboard read. */
    function publicState() {
        const images = listImages();
        return {
            ok: true,
            ...line,
            bgImage: images.includes(line.bgImage) ? line.bgImage : '',
            bgUrl: images.includes(line.bgImage)
                ? `/assets/turn-line/${encodeURIComponent(line.bgImage)}`
                : '',
            images,
            changedAt,
            now: Date.now()
        };
    }

    /** Persist and tell open dashboards. */
    function save() {
        changedAt = Date.now();
        mStorage.writeJson(FILE, line);
        mEvents.broadcast('turnline', { ok: true, changedAt });
    }

    /**
     * Called for every relayed chat message. Returns true when the message was the join word,
     * so the other sign-up boards (which would read "!turn" as a name) skip it. Never throws.
     */
    function turnLineChat(sender, parts) {
        try {
            const text = (Array.isArray(parts) ? parts : [])
                .filter((x) => x.t === 'text')
                .map((x) => x.v)
                .join(' ')
                .replace(/\s+/g, ' ');
            const cmd = mDomainTurnLine.chatCommand(line, text);
            if (!cmd) return false;
            if (cmd === 'join') {
                if (line.open && mDomainTurnLine.addPerson(line, sender)) save();
                return true;
            }
            if (mDomainTurnLine.removeByName(line, sender)) save();
            return false; // other boards also use !leave for their own lists
        } catch (_error) {
            return false;
        }
    }

    /** Dashboard buttons that change the line. Returns true when something changed. */
    function dashboardActions(body) {
        const D = mDomainTurnLine;
        let changed = false;
        if (typeof body.add === 'string') changed = D.addPerson(line, body.add) || changed;
        if (body.remove !== undefined) changed = D.removePerson(line, body.remove) || changed;
        if (body.move && body.move.id !== undefined)
            changed = D.movePerson(line, body.move.id, Number(body.move.dir)) || changed;
        if (body.done) changed = D.finishCurrent(line) || changed;
        if (body.undo) changed = D.undoDone(line) || changed;
        if (body.skip) changed = D.skipCurrent(line) || changed;
        if (body.newRound) {
            D.newRound(line);
            changed = true;
        }
        if (body.clear) {
            line.people = [];
            changed = true;
        }
        return changed;
    }

    /** Handle GET/POST /api/turnline. */
    async function handleTurnLineApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/turnline' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, publicState());
            if (pathname === '/api/turnline' && method === 'POST') {
                const body = await mHttpBody.readBody(req);
                mDomainTurnLine.applySettings(line, body);
                if (body.upload && typeof body.upload === 'object') {
                    line.bgImage = writePicture(body.upload.data, body.upload.name);
                    line.bgMode = 'image';
                }
                dashboardActions(body);
                save();
                return mHttpResponse.sendJson(res, 200, publicState());
            }
            return mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown turn line route.'
            });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Turn line request failed.'
            });
        }
    }

    Object.assign(exports, { handleTurnLineApi, turnLineChat, publicState });
    context.runtime.register(
        'turnline',
        () => ({ changedAt }),
        (value) => {
            changedAt = value.changedAt;
        }
    );
};
