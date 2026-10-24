'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');

// ---------------------------------------------------------------------------
// FORTNITE SPRITES (Baby, 2026-10-18). Collection tracker for the season's sprites and their
// variants (Base, Gold, Quack, Cheat Master, Loot Hacker, Bounty Hunter, Trick or Treat...).
//   - Roster seeded once from config/sprites-c7s4.json (27 sprites / 162 variants), then owned by
//     data/sprites.json - she adds / edits / removes on the dashboard. Pictures in assets/sprites/.
//   - Dashboard /sprites-control.html: one panel per sprite with a circle per variant (like the game).
//   - "New season" archives the season to data/sprites-<season>.json and starts an empty list.
//   - GET /api/sprites gives stats + recent + the latest catch (for a stream overlay, still to design).
// ---------------------------------------------------------------------------
const SPR_FILE = path.join(mConfig.DATA_DIR, 'sprites.json');
const SPR_SEED = path.join(mConfig.APP_DIR, 'config', 'sprites-c7s4.json');
const SPR_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'sprites');
try {
    fs.mkdirSync(SPR_ART_DIR, { recursive: true });
} catch (_error) {}
const SPR_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Exotic'];
const sprSlug = (v) =>
    String(v || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);

const sprCleanVar = (v) => mDomainValidation.cleanString(v).replace(/[<>|]/g, '').slice(0, 40);

/** Normalize incoming sprites values to the supported fields and limits. */
function sprClean(s, id) {
    const variants = [];
    for (const v of Array.isArray(s.variants)
        ? s.variants
        : String(s.variants || '').split(/\r?\n|,/)) {
        const c = sprCleanVar(v);
        if (c && !variants.includes(c)) variants.push(c);
    }
    return {
        id: id || sprSlug(s.id || s.name),
        name: mDomainValidation.cleanString(s.name).replace(/[<>]/g, '').slice(0, 40),
        rarity: SPR_RARITIES.includes(s.rarity) ? s.rarity : 'Rare',
        variants: variants.length ? variants.slice(0, 20) : ['Base'],
        image:
            s.image && mDomainValidation.DECOR_IMAGE_EXT.test(String(s.image))
                ? path.basename(String(s.image))
                : ''
    };
}

/** Restore sprites state from disk and supply defaults for missing fields. */
function sprLoad() {
    const raw = mStorage.readJson(SPR_FILE, null);
    const d = {
        season: 'Chapter 7 Season 4',
        sprites: [],
        caught: {},
        recent: [],
        popupSec: 8,
        ...(raw || {})
    };
    if (!raw) {
        const seed = mStorage.readJson(SPR_SEED, null);
        if (seed) {
            d.season = seed.season || d.season;
            d.sprites = (seed.sprites || []).map((s) => sprClean(s)).filter((s) => s.id && s.name);
        }
    }
    d.caught = d.caught && typeof d.caught === 'object' ? d.caught : {};
    d.recent = Array.isArray(d.recent) ? d.recent.slice(0, 30) : [];
    return d;
}

let spr = sprLoad();
let sprPopup = null;
const saveListeners = new Set();

/** Subscribe collaborators to saved collection changes without importing those features here. */
function onSave(listener) {
    saveListeners.add(listener);
    return () => saveListeners.delete(listener);
}

const sprKey = (id, v) => `${id}|${v}`;

const sprFind = (id) => spr.sprites.find((s) => s.id === String(id));

/** Resolve local sprites artwork to the URL used by its display. */
function sprImg(s) {
    if (!s) return null;
    // Her uploaded picture, else a file named after the sprite id (e.g. assets/sprites/jonesy.png).
    const names = (s.image ? [s.image] : []).concat(
        ['png', 'webp', 'jpg', 'jpeg', 'gif'].map((e) => `${s.id}.${e}`)
    );
    for (const f of names) {
        try {
            return `/assets/sprites/${encodeURIComponent(f)}?v=${Math.round(
                fs.statSync(path.join(SPR_ART_DIR, f)).mtimeMs
            )}`;
        } catch (_e) {}
    }
    return null;
}

// Drop-file import (2026-10-18): data/sprites-import.json = { caught: { "jonesy": ["Base","Gold"] } }
// is merged in (adds catches only) and renamed to sprites-import.imported-<ms>.json. Checked at
// start-up and every 3 s, so catches read from her screenshots can be added while ICB runs.
const SPR_IMPORT = path.join(mConfig.DATA_DIR, 'sprites-import.json');
/** Apply a pending local sprite import and persist the resulting collection. */
function sprImportCheck() {
    if (!fs.existsSync(SPR_IMPORT)) return;
    try {
        const d = mStorage.readJson(SPR_IMPORT, null) || {};
        let n = 0;
        for (const [id, vars] of Object.entries(d.caught || {})) {
            const s =
                sprFind(id) ||
                spr.sprites.find((x) => x.name.toLowerCase() === String(id).toLowerCase());
            if (!s) continue;
            for (const v of Array.isArray(vars) ? vars : []) {
                const vv = s.variants.find(
                    (x) =>
                        x.toLowerCase() === String(v).toLowerCase() ||
                        x.split(' ')[0].toLowerCase() === String(v).toLowerCase()
                );
                if (vv && !spr.caught[sprKey(s.id, vv)]) {
                    spr.caught[sprKey(s.id, vv)] = Date.now();
                    n++;
                }
            }
        }
        // Optional rarity fixes: { rarity: { "overshield": "Rare" } } (read from the game's card colours).
        for (const [id, r] of Object.entries(d.rarity || {})) {
            const s = sprFind(id);
            if (s && SPR_RARITIES.includes(r) && s.rarity !== r) {
                s.rarity = r;
                n++;
            }
        }
        fs.renameSync(
            SPR_IMPORT,
            path.join(mConfig.DATA_DIR, `sprites-import.imported-${Date.now()}.json`)
        );
        sprSave();
        console.log(`[sprites] imported ${n} catches`);
    } catch (error) {
        console.log('[sprites] import failed:', error.message);
    }
}

/** Count caught variants and completed sprites for the active season. */
function sprStats() {
    let total = 0,
        done = 0,
        full = 0,
        base = 0;
    const byVar = {},
        byRarity = {};
    for (const s of spr.sprites) {
        let n = 0;
        for (const v of s.variants) {
            total++;
            const has = !!spr.caught[sprKey(s.id, v)];
            if (has) {
                done++;
                n++;
            }
            const o = byVar[v] || (byVar[v] = { done: 0, total: 0 });
            o.total++;
            if (has) o.done++;
        }
        if (n === s.variants.length) full++;
        if (spr.caught[sprKey(s.id, s.variants[0])]) base++;
        const r = byRarity[s.rarity] || (byRarity[s.rarity] = { done: 0, total: 0 });
        r.total += s.variants.length;
        r.done += n;
    }
    return {
        total,
        done,
        pct: total ? Math.round((done / total) * 1000) / 10 : 0,
        sprites: spr.sprites.length,
        full,
        base,
        byVar,
        byRarity
    };
}

/** Build the sprites response consumed by dashboards and overlays. */
function sprPublic() {
    const now = Date.now();
    return {
        ok: true,
        season: spr.season,
        stats: sprStats(),
        recent: spr.recent.slice(0, 8).map((r) => ({ ...r, img: sprImg(sprFind(r.id)) })),
        popup: sprPopup && sprPopup.until > now ? sprPopup : null,
        now
    };
}

/** Persist operator changes to the sprites state file. */
function sprSave() {
    mStorage.writeJson(SPR_FILE, spr);
    mEvents.broadcast('sprites', sprPublic());
    for (const listener of saveListeners) listener();
}

/** Add or remove one valid sprite variant while maintaining recent catches and popup state. */
function sprSet(id, v, on) {
    const s = sprFind(id);
    if (!s || !s.variants.includes(v)) return false;
    const k = sprKey(s.id, v);
    if (on && !spr.caught[k]) {
        spr.caught[k] = Date.now();
        spr.recent = [{ id: s.id, name: s.name, variant: v, at: Date.now() }]
            .concat(spr.recent.filter((r) => !(r.id === s.id && r.variant === v)))
            .slice(0, 30);
        const n = s.variants.filter((x) => spr.caught[sprKey(s.id, x)]).length;
        sprPopup = {
            id: s.id,
            name: s.name,
            rarity: s.rarity,
            variant: v,
            img: sprImg(s),
            have: n,
            of: s.variants.length,
            complete: n === s.variants.length,
            at: Date.now(),
            until: Date.now() + (spr.popupSec || 8) * 1000
        };
    } else if (!on && spr.caught[k]) {
        delete spr.caught[k];
        spr.recent = spr.recent.filter((r) => !(r.id === s.id && r.variant === v));
    }
    return true;
}

Object.assign(exports, {
    sprKey,
    onSave,
    sprImg,
    sprStats,
    sprSet,
    sprSave,
    sprFind,
    SPR_ART_DIR,
    sprSlug
});

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    spr: {
        enumerable: true,
        get: () => spr,

        set: (value) => {
            spr = value;
        }
    }
});

Object.assign(exports, { sprCleanVar, sprClean, sprPublic, SPR_RARITIES });

exports.sprImportCheck = sprImportCheck;
