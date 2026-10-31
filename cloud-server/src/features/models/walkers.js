'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const {
        WALKERS_DEFAULT_SETTINGS,
        WALKERS_LIMITS,
        WALKERS_ANIMS,
        WALKERS_ENTRANCES,
        WALKERS_EXITS,
        WALKERS_FONTS,
        WALKERS_COLOR
    } = require('./walkers-options');
    const fs = context.files;
    const path = require('node:path');
    const mConfig = context.config;
    const mStorage = context.storage;
    const mDomainValidation = require('../../domain/validation');
    const mGiveawayState = context.use('giveaway/state');
    const mHttpResponse = context.response;
    const mHttpBody = context.body;
    const mTradeup = context.use('tradeup');

    // ---------------------------------------------------------------------------
    // CHAT UNICORNS (Baby, 2026-09-29) - allowed chatters get their own unicorn
    // that hops back and forth along the bottom of the stream, says their chat
    // messages in a speech bubble, pops the occasional reminder, and walks off
    // after 10 minutes of quiet.
    //   - Overlay:   /walkers.html (Meld layer, full screen)
    //   - Dashboard: /walkers-control.html
    //   - Chat comes from the Meld listener's raw relay (/api/activity/raw,
    //     kind "chat"), which already carries the text and emote pictures.
    //   - Who gets one: subscribers automatically (sub months recorded in the
    //     giveaway - live subs or hand-added "already subbed"), plus anyone Baby
    //     ticks on the dashboard; she can also untick a sub. Names on the giveaway
    //     block list (bots, herself) never get one.
    //   - Art: assets/decor/unicorn/ (served at /decor-art/unicorn/<file>). Each
    //     person keeps the same picture (random unless Baby picks one).
    // Saved in data/walkers.json.
    // ---------------------------------------------------------------------------
    const WALKERS_FILE = path.join(mConfig.DATA_DIR, 'walkers.json');
    const WALKERS_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor', 'unicorn');
    // Subscriber-only pictures (Baby, 2026-10-01): never in the random pool;
    // only subscribers can have them. Person art "subs:<file>" points here.
    const WALKERS_SUB_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor', 'unicorn-subs');
    try {
        fs.mkdirSync(WALKERS_SUB_ART_DIR, { recursive: true });
    } catch (_error) {}
    // Personal pictures (Baby, 2026-10-03): one person's own picture of their
    // choice, uploaded from their row on the dashboard. Never used for anyone
    // else, never random. Person art "personal:<file>"; person.personal remembers it.
    const WALKERS_PERSONAL_DIR = path.join(mConfig.APP_DIR, 'assets', 'decor', 'unicorn-personal');
    try {
        fs.mkdirSync(WALKERS_PERSONAL_DIR, { recursive: true });
    } catch (_error) {}

    // Animations (Baby, 2026-10-01): every movement style and trick can be
    // switched on/off and given a "how often" (1-10) on the dashboard.
    // kind 'move' = how they get around (each unicorn switches between the ones
    // that are on every so often); kind 'trick' = random things they do.

    /** Normalize incoming walkers values to the supported fields and limits. */
    function walkerCleanAnims(src, prev) {
        const out = {};
        for (const a of WALKERS_ANIMS) {
            const old = (prev && prev[a.id]) || { on: a.on, often: a.often };
            const inc = (src && src[a.id]) || {};
            const often = Number(inc.often);
            out[a.id] = {
                on: typeof inc.on === 'boolean' ? inc.on : old.on !== false,
                often: Number.isFinite(often)
                    ? Math.min(10, Math.max(1, Math.round(often)))
                    : Math.min(10, Math.max(1, Number(old.often) || a.often))
            };
        }
        return out;
    }

    let walkerTry = { id: null, at: 0 }; // "▶ Try" on the dashboard: every unicorn does it now

    // Checks the look settings (shared by load + the settings route).
    function walkerCleanLook(s, src) {
        if (['above', 'below', 'hidden'].includes(src.namePosition))
            s.namePosition = src.namePosition;
        if (WALKERS_FONTS.includes(src.nameFont)) s.nameFont = src.nameFont;
        for (const k of ['nameColor', 'nameOutlineColor', 'nameBgColor'])
            if (WALKERS_COLOR.test(String(src[k] || ''))) s[k] = String(src[k]).toLowerCase();
        for (const k of ['nameBold', 'nameBackground', 'showChat', 'subsAuto'])
            if (typeof src[k] === 'boolean') s[k] = src[k];
        if (['everyone', 'subs'].includes(src.whoGets)) s.whoGets = src.whoGets;
        return s;
    }

    /** Restore walkers state from disk and supply defaults for missing fields. */
    function loadWalkers() {
        const raw = mStorage.readJson(WALKERS_FILE, {}) || {};
        const s = { ...WALKERS_DEFAULT_SETTINGS, ...(raw.settings || {}) };
        s.enabled = s.enabled !== false;
        s.artFacesLeft = s.artFacesLeft === true;
        const look = walkerCleanLook({ ...WALKERS_DEFAULT_SETTINGS }, s);
        for (const k of [
            'namePosition',
            'nameFont',
            'nameColor',
            'nameOutlineColor',
            'nameBgColor',
            'nameBold',
            'nameBackground',
            'showChat',
            'subsAuto',
            'whoGets'
        ])
            s[k] = look[k];
        for (const [k, [lo, hi]] of Object.entries(WALKERS_LIMITS)) {
            const n = Number(s[k]);
            s[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : WALKERS_DEFAULT_SETTINGS[k];
        }
        s.reminders = (Array.isArray(s.reminders) ? s.reminders : [])
            .map((r) => mDomainValidation.cleanString(r).slice(0, 140))
            .filter(Boolean)
            .slice(0, 30);
        s.anims = walkerCleanAnims(s.anims, null);
        if (!WALKERS_ENTRANCES[s.entrance]) s.entrance = 'drop';
        if (!WALKERS_EXITS[s.exitStyle]) s.exitStyle = 'walk';
        const people = {};
        for (const [key, p] of Object.entries(raw.people || {})) {
            if (!p || !p.name) continue;
            people[key.toLowerCase()] = {
                name: mDomainValidation.cleanString(p.name).slice(0, 40),
                allowed: p.allowed === true ? true : p.allowed === false ? false : null, // null = automatic (subs)
                art: walkerCleanArtRef(p.art),
                lastSeen: p.lastSeen || null,
                personal:
                    p.personal &&
                    mDomainValidation.DECOR_IMAGE_EXT.test(path.basename(String(p.personal)))
                        ? path.basename(String(p.personal))
                        : null
            };
        }
        return { settings: s, people };
    }

    let walkers = loadWalkers();
    let walkerEvents = []; // recent chat for the overlay: { seq, name, parts, at }
    let walkerSeq = 0;
    try {
        fs.mkdirSync(WALKERS_ART_DIR, { recursive: true });
    } catch (_error) {}

    /** Persist operator changes to the walkers state file. */
    function saveWalkers() {
        mStorage.writeJson(WALKERS_FILE, { settings: walkers.settings, people: walkers.people });
    }

    /** Resolve local walkers artwork to the URL used by its display. */
    function walkerArt() {
        try {
            return fs
                .readdirSync(WALKERS_ART_DIR)
                .filter((f) => mDomainValidation.DECOR_IMAGE_EXT.test(f))
                .sort((a, b) => a.localeCompare(b));
        } catch (_error) {
            return [];
        }
    }

    /** Resolve local walkers artwork to the URL used by its display. */
    function walkerSubArt() {
        try {
            return fs
                .readdirSync(WALKERS_SUB_ART_DIR)
                .filter((f) => mDomainValidation.DECOR_IMAGE_EXT.test(f))
                .sort((a, b) => a.localeCompare(b));
        } catch (_error) {
            return [];
        }
    }

    // A person's picked picture: "file.png" (everyone's pool) or "subs:file.png" (subscriber-only).
    function walkerCleanArtRef(ref) {
        if (!ref) return null;
        const str = String(ref);
        if (str.startsWith('subs:')) {
            const f = path.basename(str.slice(5));
            return mDomainValidation.DECOR_IMAGE_EXT.test(f) ? `subs:${f}` : null;
        }
        if (str.startsWith('personal:')) {
            const f = path.basename(str.slice(9));
            return mDomainValidation.DECOR_IMAGE_EXT.test(f) ? `personal:${f}` : null;
        }
        const f = path.basename(str);
        return mDomainValidation.DECOR_IMAGE_EXT.test(f) ? f : null;
    }

    /** Resolve local walkers artwork to the URL used by its display. */
    function walkerArtUrl(ref) {
        if (ref.startsWith('personal:'))
            return `/decor-art/unicorn-personal/${encodeURIComponent(ref.slice(9))}`;
        return ref.startsWith('subs:')
            ? `/decor-art/unicorn-subs/${encodeURIComponent(ref.slice(5))}`
            : `/decor-art/unicorn/${encodeURIComponent(ref)}`;
    }

    /** Derive a stable numeric seed so a viewer keeps a consistent default avatar. */
    function walkerHash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
        return Math.abs(h);
    }

    /** Check the saved subscriber eligibility used for subscriber-only artwork. */
    function walkerIsSub(name) {
        const key = mGiveawayState.findEntrantKey(name);
        const e = key ? mGiveawayState.giveaway.entrants[key] : null;
        return !!(e && e.counts && e.counts.subMonths > 0);
    }

    /** Honor the walker allow/block settings before placing a viewer on screen. */
    function walkerAllowed(name) {
        if (!name || mGiveawayState.isBlocked(name)) return false;
        const p = walkers.people[name.toLowerCase()];
        if (p && p.allowed !== null && p.allowed !== undefined) return p.allowed;
        return walkers.settings.whoGets === 'subs' ? walkerIsSub(name) : true;
    }

    // Keep only what the bubble needs: text and emote pictures.
    function walkerParts(data) {
        const parts = [];
        for (const f of (Array.isArray(data && data.fragments) ? data.fragments : []).slice(
            0,
            40
        )) {
            if (!f || typeof f !== 'object') continue;
            if (f.type === 'EMOTE' && /^https:\/\/[^\s"']+$/i.test(String(f.imageLink || '')))
                parts.push({
                    t: 'emote',
                    url: f.imageLink,
                    name: mDomainValidation.cleanString(f.emoteName || f.text).slice(0, 40)
                });
            else if (typeof f.text === 'string' || typeof f.raw === 'string')
                parts.push({ t: 'text', v: String(f.text != null ? f.text : f.raw).slice(0, 300) });
        }
        if (!parts.length && data && typeof data.raw === 'string')
            parts.push({ t: 'text', v: data.raw.slice(0, 300) });
        return parts;
    }

    // Called for every relayed chat message.
    function walkerChat(name, parts, force) {
        name = mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
        if (!name) return false;
        const key = name.toLowerCase();
        const known = walkers.people[key];
        if (!known)
            walkers.people[key] = {
                name,
                allowed: null,
                art: null,
                lastSeen: new Date().toISOString()
            };
        else {
            known.name = name;
            known.lastSeen = new Date().toISOString();
        }
        if (!known) saveWalkers(); // remember new chatters so they show on the dashboard list
        if (!force && !walkerAllowed(name)) return false;
        walkerEvents.push({ seq: ++walkerSeq, name, parts, at: Date.now() });
        if (walkerEvents.length > 200) walkerEvents = walkerEvents.slice(-200);
        return true;
    }

    /** Expose visible walkers and only the chat events newer than the client cursor. */
    function walkerOverlayState(since) {
        const art = walkerArt(),
            subArt = walkerSubArt();
        const pick = {};
        for (const [key, p] of Object.entries(walkers.people)) {
            const ref = p.art;
            if (ref && ref.startsWith('personal:')) {
                if (
                    p.personal === ref.slice(9) &&
                    fs.existsSync(path.join(WALKERS_PERSONAL_DIR, p.personal))
                ) {
                    pick[key] = walkerArtUrl(ref);
                    continue;
                }
            }
            if (
                ref &&
                !ref.startsWith('subs:') &&
                !ref.startsWith('personal:') &&
                art.includes(ref)
            ) {
                pick[key] = walkerArtUrl(ref);
                continue;
            }
            // Subscriber-only pictures go to subscribers only - never the random pool.
            if (!walkerIsSub(p.name)) continue;
            if (ref && ref.startsWith('subs:') && subArt.includes(ref.slice(5)))
                pick[key] = walkerArtUrl(ref);
            else if (!ref && walkers.settings.subsAuto && subArt.length)
                pick[key] = walkerArtUrl(`subs:${subArt[walkerHash(key) % subArt.length]}`);
        }
        return {
            ok: true,
            settings: walkers.settings,
            art: art.map((f) => `/decor-art/unicorn/${encodeURIComponent(f)}`),
            pick, // lowercase name -> chosen art
            seq: walkerSeq,
            events: walkerEvents.filter((e) => e.seq > since),
            clearAt: walkers.clearAt || 0,
            tryAnim: walkerTry
        };
    }

    /** Expose editable walker settings and available artwork for the private dashboard. */
    function walkerAdminState() {
        const art = walkerArt();
        const names = new Map();
        for (const p of Object.values(walkers.people)) names.set(p.name.toLowerCase(), p.name);
        for (const e of Object.values(mGiveawayState.giveaway.entrants || {}))
            if (e && e.username && !names.has(e.username.toLowerCase()))
                names.set(e.username.toLowerCase(), e.username);
        const people = [...names.entries()]
            .filter(([, n]) => !mGiveawayState.isBlocked(n))
            .map(([key, name]) => {
                const p = walkers.people[key] || {};
                return {
                    name,
                    isSub: walkerIsSub(name),
                    override: p.allowed === undefined ? null : p.allowed,
                    allowed: walkerAllowed(name),
                    art: p.art || null,
                    personal: p.personal || null,
                    lastSeen: p.lastSeen || null
                };
            })
            .sort(
                (a, b) =>
                    b.allowed - a.allowed ||
                    String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) ||
                    a.name.localeCompare(b.name)
            );
        return {
            ok: true,
            settings: walkers.settings,
            art,
            subArt: walkerSubArt(),
            people,
            fonts: WALKERS_FONTS,
            anims: WALKERS_ANIMS,
            entrances: WALKERS_ENTRANCES,
            exits: WALKERS_EXITS
        };
    }

    /** Validate and dispatch walkers API requests, returning client errors for invalid input. */

    const createWalkersApi = require('./walkers-api')({
        get WALKERS_LIMITS() {
            return WALKERS_LIMITS;
        },

        get WALKERS_ANIMS() {
            return WALKERS_ANIMS;
        },

        get WALKERS_ENTRANCES() {
            return WALKERS_ENTRANCES;
        },

        get WALKERS_EXITS() {
            return WALKERS_EXITS;
        },

        fs: fs,

        path: path,

        mDomainValidation: mDomainValidation,

        mHttpResponse: mHttpResponse,

        mHttpBody: mHttpBody,

        mTradeup: mTradeup,

        WALKERS_ART_DIR: WALKERS_ART_DIR,

        WALKERS_SUB_ART_DIR: WALKERS_SUB_ART_DIR,

        WALKERS_PERSONAL_DIR: WALKERS_PERSONAL_DIR,

        walkerCleanAnims: walkerCleanAnims,

        get walkerTry() {
            return walkerTry;
        },

        set walkerTry(value) {
            walkerTry = value;
        },

        walkerCleanLook: walkerCleanLook,

        get walkers() {
            return walkers;
        },

        saveWalkers: saveWalkers,

        walkerArt: walkerArt,

        walkerSubArt: walkerSubArt,

        walkerCleanArtRef: walkerCleanArtRef,

        walkerIsSub: walkerIsSub,

        walkerChat: walkerChat,

        walkerOverlayState: walkerOverlayState,

        walkerAdminState: walkerAdminState
    });
    const handleWalkersApi = createWalkersApi.handleWalkersApi;

    Object.assign(exports, { walkerIsSub, walkerChat, walkerParts, handleWalkersApi });

    // Accessors keep replacement state visible to routes and collaborating features.
    Object.defineProperties(exports, {
        walkers: {
            enumerable: true,
            get: () => walkers,

            set: (value) => {
                walkers = value;
            }
        }
    });
    context.runtime.register(
        'walkers',
        () => ({ walkerTry }),
        (value) => {
            walkerTry = value.walkerTry;
        }
    );
};
