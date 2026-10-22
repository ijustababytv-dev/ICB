'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mParty = require('./party');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mNews = require('./news');

// ---------------------------------------------------------------------------
// ANIIMO DEX (Baby, 2026-10-14). Built on a catch & variant checklist a friend's Claude made
// ("Aniimo Tracker.html", kept untouched in the ICB folder). Now lives in ICB:
//   - Roster (Aniimo + their forms/specials) seeded once from config/aniimo-roster.json, then
//     owned by data/aniimo-dex.json - Baby adds / edits / removes on the dashboard.
//   - Checks saved on the server (not in a browser), with the time each was checked.
//   - Overlay /aniimo.html: progress + "new catch" pop-up + chat look-ups.
//   - Chat: "!need <Aniimo>" shows what she still needs for it; "!dex" shows overall progress
//     (on the overlay - ICB doesn't post into Twitch chat). Per-person + global cooldown.
//   - Quick checker /aniimo-quick.html (for a clickable Desktop Widget over the game).
//   - Dashboard /aniimo-control.html. Import accepts the friend tracker's backup .json too.
// ---------------------------------------------------------------------------
const DEX_FILE = path.join(mConfig.DATA_DIR, 'aniimo-dex.json');
const DEX_SEED = path.join(mConfig.APP_DIR, 'config', 'aniimo-roster.json');
const DEX_ELEMENTS = ['Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Rock', 'Wind', 'Dark', 'Holy'];
/** Create independent initial aniimo settings for first-run or missing saved fields. */
function dexDefaults() {
    return {
        visible: true,
        title: '✨ Aniimo Dex',
        chat: true,
        popupSec: 8,
        lookupSec: 14,
        showElements: true,
        accent: '#7dd3fc',
        panelColor: '#101522',
        panelOpacity: 88,
        roster: [],
        checked: {},
        recent: [],
        seq: 1
    };
}

const dexCleanVariant = (v) =>
    mDomainValidation
        .cleanString(v)
        .replace(/Prismana Form Form/g, 'Prismana Form')
        .replace(/[<>|]/g, '')
        .slice(0, 50);

/** Normalize incoming aniimo values to the supported fields and limits. */
function dexCleanAniimo(a, id) {
    const variants = [];
    for (const v of Array.isArray(a.variants)
        ? a.variants
        : String(a.variants || '').split(/\r?\n|,/)) {
        const c = dexCleanVariant(v);
        if (c && !variants.includes(c)) variants.push(c);
    }
    return {
        id:
            id ||
            String(a.id || a.number || '')
                .replace(/[^0-9a-z_-]/gi, '')
                .slice(0, 20),
        number: mDomainValidation.cleanString(a.number).slice(0, 10),
        name: mDomainValidation.cleanString(a.name).replace(/[<>]/g, '').slice(0, 40),
        element: mDomainValidation.cleanString(a.element).slice(0, 40),
        variants: variants.slice(0, 40),
        image:
            a.image && mDomainValidation.DECOR_IMAGE_EXT.test(String(a.image))
                ? path.basename(String(a.image))
                : '',
        // Photos of individual forms she caught / hatched (2026-10-14): { "Highland Form": "001__highlandform.webp" }
        formImages:
            a.formImages && typeof a.formImages === 'object'
                ? Object.fromEntries(
                      Object.entries(a.formImages)
                          .filter(
                              ([v, f]) =>
                                  variants.includes(dexCleanVariant(v)) &&
                                  mDomainValidation.DECOR_IMAGE_EXT.test(String(f))
                          )
                          .map(([v, f]) => [dexCleanVariant(v), path.basename(String(f))])
                  )
                : {}
    };
}

/** Restore aniimo state from disk and supply defaults for missing fields. */
function dexLoad() {
    const raw = mStorage.readJson(DEX_FILE, null);
    const d = { ...dexDefaults(), ...(raw || {}) };
    if (!raw || !Array.isArray(raw.roster) || !raw.roster.length) {
        const seed = mStorage.readJson(DEX_SEED, null);
        d.roster = (seed && Array.isArray(seed.roster) ? seed.roster : [])
            .map((a) => dexCleanAniimo(a))
            .filter((a) => a.id && a.name);
    }
    d.checked = d.checked && typeof d.checked === 'object' ? d.checked : {};
    d.recent = Array.isArray(d.recent) ? d.recent.slice(0, 30) : [];
    return d;
}

let dex = dexLoad();
let dexPopup = null,
    dexLookup = null; // what the overlay shows right now
const dexChatSeen = new Map();
let dexChatLast = 0;
const dexKey = (id, v) => `${id}|${v}`;

const dexFind = (id) => dex.roster.find((a) => a.id === String(id));

// Pictures (2026-10-14): assets/aniimo/. A picture she uploads is remembered on the Aniimo (a.image);
// otherwise a file named after the number or name is matched automatically (001.png, 1.png, Emberpup.png...).
const DEX_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'aniimo');
try {
    fs.mkdirSync(DEX_ART_DIR, { recursive: true });
} catch (_error) {}
let dexArtList = null,
    dexArtAt = 0;
/** Locate supported local aniimo artwork while tolerating missing files. */
function dexArtFiles() {
    if (!dexArtList || Date.now() - dexArtAt > 5000) {
        dexArtAt = Date.now();
        dexArtList = new Map();
        try {
            for (const f of fs.readdirSync(DEX_ART_DIR))
                if (mDomainValidation.DECOR_IMAGE_EXT.test(f))
                    dexArtList.set(
                        f
                            .replace(/\.[a-z0-9]+$/i, '')
                            .toLowerCase()
                            .replace(/[^a-z0-9]/g, ''),
                        f
                    );
        } catch (_e) {}
    }
    return dexArtList;
}

const dexSlug = (v) =>
    String(v || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

/** Resolve local aniimo artwork to the URL used by its display. */
function dexArtUrl(f) {
    let v = 0;
    try {
        v = Math.round(fs.statSync(path.join(DEX_ART_DIR, f)).mtimeMs);
    } catch (_e) {
        return null;
    }
    return `/assets/aniimo/${encodeURIComponent(f)}?v=${v}`;
}

/** Resolve local aniimo artwork to the URL used by its display. */
function dexFormImg(a, v) {
    return a && a.formImages && a.formImages[v] ? dexArtUrl(a.formImages[v]) : null;
}

/** Resolve local aniimo artwork to the URL used by its display. */
function dexFormImgs(a) {
    const o = {};
    if (a && a.formImages)
        for (const v of Object.keys(a.formImages)) {
            const u = dexFormImg(a, v);
            if (u) o[v] = u;
        }
    return o;
}

/** Resolve local aniimo artwork to the URL used by its display. */
function dexImg(a) {
    if (!a) return null;
    const files = dexArtFiles();
    const url = (f) => {
        let v = 0;
        try {
            v = Math.round(fs.statSync(path.join(DEX_ART_DIR, f)).mtimeMs);
        } catch (_e) {
            return null;
        }
        return `/assets/aniimo/${encodeURIComponent(f)}?v=${v}`;
    };

    if (a.image) {
        const u = url(a.image);
        if (u) return u;
    }
    const tries = [
        a.number,
        String(a.number).replace(/^0+/, ''),
        a.name,
        String(a.name).split('/')[0],
        a.id
    ]
        .map(dexSlug)
        .filter(Boolean);
    for (const t of tries) {
        const f = files.get(t);
        if (f) return url(f);
    }
    return null;
}

/** Derive collection completion from checked variants and the current roster. */
function dexStats() {
    let total = 0,
        done = 0,
        full = 0;
    const el = {};
    for (const a of dex.roster) {
        let n = 0;
        for (const v of a.variants) {
            total++;
            if (dex.checked[dexKey(a.id, v)]) {
                done++;
                n++;
            }
        }
        if (a.variants.length && n === a.variants.length) full++;
        for (const e of String(a.element)
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean)) {
            const o = el[e] || (el[e] = { done: 0, total: 0 });
            o.done += n;
            o.total += a.variants.length;
        }
    }
    const basic = dex.roster.filter((a) => dex.checked[dexKey(a.id, 'Basic Form')]).length;
    return {
        total,
        done,
        pct: total ? Math.round((done / total) * 1000) / 10 : 0,
        species: dex.roster.length,
        full,
        basic,
        elements: el
    };
}

/** Build the aniimo response consumed by dashboards and overlays. */
function dexPublic() {
    const now = Date.now();
    return {
        ok: true,
        visible: dex.visible,
        title: dex.title,
        chat: dex.chat,
        showElements: dex.showElements,
        accent: dex.accent,
        panelColor: dex.panelColor,
        panelOpacity: dex.panelOpacity,
        stats: dexStats(),
        recent: dex.recent.slice(0, 8).map((r) => {
            const a = dexFind(r.id);
            return { ...r, img: dexFormImg(a, r.variant) || dexImg(a) };
        }),
        popup: dexPopup && dexPopup.until > now ? dexPopup : null,
        lookup: dexLookup && dexLookup.until > now ? dexLookup : null,
        now
    };
}

/** Persist operator changes to the aniimo state file. */
function dexSave() {
    mStorage.writeJson(DEX_FILE, dex);
    mEvents.broadcast('aniimo', dexPublic());
}

/** Update one valid Aniimo variant without disturbing other collection entries. */
function dexSet(id, variant, on) {
    const a = dexFind(id);
    if (!a || !a.variants.includes(variant)) return false;
    const k = dexKey(a.id, variant);
    if (on && !dex.checked[k]) {
        dex.checked[k] = Date.now();
        dex.recent = [{ id: a.id, name: a.name, variant, at: Date.now() }]
            .concat(dex.recent.filter((r) => !(r.id === a.id && r.variant === variant)))
            .slice(0, 30);
        const n = a.variants.filter((v) => dex.checked[dexKey(a.id, v)]).length;
        dexPopup = {
            id: a.id,
            name: a.name,
            number: a.number,
            element: a.element,
            img: dexImg(a),
            formImg: dexFormImg(a, variant),
            variant,
            have: n,
            of: a.variants.length,
            complete: n === a.variants.length,
            until: Date.now() + dex.popupSec * 1000,
            at: Date.now()
        };
    } else if (!on && dex.checked[k]) {
        delete dex.checked[k];
        dex.recent = dex.recent.filter((r) => !(r.id === a.id && r.variant === variant));
    }
    return true;
}

// Find an Aniimo by what someone typed: number, exact name, start of name, then anywhere in name.
function dexSearch(q) {
    q = String(q || '')
        .toLowerCase()
        .replace(/^#/, '')
        .trim();
    if (!q) return null;
    const R = dex.roster;
    return (
        R.find((a) => a.number === q || a.number.replace(/^0+/, '') === q.replace(/^0+/, '')) ||
        R.find((a) => a.name.toLowerCase() === q) ||
        R.find((a) =>
            a.name
                .toLowerCase()
                .split(/\s*\/\s*/)
                .some((n) => n === q)
        ) ||
        R.find((a) => a.name.toLowerCase().startsWith(q)) ||
        (q.length >= 3 ? R.find((a) => a.name.toLowerCase().includes(q)) : null)
    );
}

/** Interpret supported aniimo chat commands while preserving unrelated messages. */
function dexChat(sender, parts) {
    if (!dex.chat) return '';
    const name = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
    if (!name) return '';
    const text = mParty
        .partyDecode(
            (parts || [])
                .filter((x) => x.t === 'text')
                .map((x) => x.v)
                .join(' ')
        )
        .trim()
        .replace(/\s+/g, ' ');
    const m = /^!(need|dex)\b ?(.*)$/i.exec(text);
    if (!m) return '';
    const now = Date.now(),
        key = name.toLowerCase();
    if (now - (dexChatSeen.get(key) || 0) < 20000 || now - dexChatLast < 4000) return ''; // 20 s per person, 4 s overall
    dexChatSeen.set(key, now);
    dexChatLast = now;
    const sec = dex.lookupSec * 1000;
    if (m[1].toLowerCase() === 'dex' || !m[2]) {
        dexLookup = { kind: 'dex', by: name, until: now + sec, at: now };
        mEvents.broadcast('aniimo', dexPublic());
        return 'dex';
    }
    const a = dexSearch(m[2]);
    if (!a) {
        dexLookup = {
            kind: 'notfound',
            by: name,
            q: m[2].slice(0, 30),
            until: now + 6000,
            at: now
        };
        mEvents.broadcast('aniimo', dexPublic());
        return 'not found';
    }
    const have = a.variants.filter((v) => dex.checked[dexKey(a.id, v)]),
        need = a.variants.filter((v) => !dex.checked[dexKey(a.id, v)]);
    dexLookup = {
        kind: 'need',
        by: name,
        id: a.id,
        name: a.name,
        number: a.number,
        element: a.element,
        img: dexImg(a),
        formImgs: dexFormImgs(a),
        have,
        need,
        until: now + sec,
        at: now
    };
    mEvents.broadcast('aniimo', dexPublic());
    return `${a.name}: needs ${need.length}`;
}

/** Validate and dispatch aniimo API requests, returning client errors for invalid input. */

const createAniimoApi = require('./aniimo-api')({
    fs: fs,

    path: path,

    mDomainValidation: mDomainValidation,

    mHttpResponse: mHttpResponse,

    mHttpBody: mHttpBody,

    mNews: mNews,

    DEX_ELEMENTS: DEX_ELEMENTS,

    dexCleanVariant: dexCleanVariant,

    dexCleanAniimo: dexCleanAniimo,

    get dex() {
        return dex;
    },

    get dexPopup() {
        return dexPopup;
    },

    set dexPopup(value) {
        dexPopup = value;
    },

    get dexLookup() {
        return dexLookup;
    },

    set dexLookup(value) {
        dexLookup = value;
    },

    dexChatSeen: dexChatSeen,

    get dexChatLast() {
        return dexChatLast;
    },

    set dexChatLast(value) {
        dexChatLast = value;
    },

    dexKey: dexKey,

    dexFind: dexFind,

    DEX_ART_DIR: DEX_ART_DIR,

    get dexArtList() {
        return dexArtList;
    },

    set dexArtList(value) {
        dexArtList = value;
    },

    dexSlug: dexSlug,

    dexFormImg: dexFormImg,

    dexFormImgs: dexFormImgs,

    dexImg: dexImg,

    dexPublic: dexPublic,

    dexSave: dexSave,

    dexSet: dexSet,

    dexSearch: dexSearch,

    dexChat: dexChat
});
const handleDexApi = createAniimoApi.handleDexApi;

Object.assign(exports, { dexChat, handleDexApi });
