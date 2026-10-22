'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const mConfig = require('./config');
const mSprites = require('./sprites');
const mDomainValidation = require('./domain/validation');
const mParty = require('./party');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');

// ---------------------------------------------------------------------------
// SPRITE JAR + STICKER BOOK (Baby, 2026-10-18). Stream overlay for catching sprites:
// a glass jar holds every sprite this season; when she (or a mod on her list) types
// "!jonesy gold" the sticker book pops open and that sprite floats out of the jar into
// its sticker spot. Catches are the same as ticking the circle on the sprites dashboard.
//   - Overlay /sprite-jar.html (full-screen Meld layer), dashboard /sprite-jar-control.html.
//   - Settings live in data/sprites.json under "jar". Jar art: the unicorn jar pair in assets/resources
//     (JAR_BACK.png behind the sprites, JAR_FRONT.png over them); an uploaded picture in assets/sprite-jar/ replaces it.
//   - Meld doesn't tell ICB who is a mod, so she lists who may catch (default: her).
// ---------------------------------------------------------------------------
const SJ_DIR = path.join(mConfig.APP_DIR, 'assets', 'sprite-jar');
try {
    fs.mkdirSync(SJ_DIR, { recursive: true });
} catch (_error) {}
/** Create independent initial sprite jar settings for first-run or missing saved fields. */
function sjDefaults() {
    return {
        listen: true,
        visible: true,
        allowed: 'IJustABabyTv',
        needPrefix: false,
        dashPlays: false,
        removeComplete: false,
        jarHolds: 'stickers',
        leaveCaught: false,
        mode: 'floor',
        floorL: 2,
        floorR: 98,
        floorH: 16,
        floorB: 1,
        toySize: 100,
        bookStyle: 'propped',
        bookTheme: 'spooky',
        pbX: 1,
        pbW: 33,
        pbB: 1.5,
        pbTilt: -3,
        pbLean: 10,
        pbAuto: 0,
        baseBook: 170,
        baseToy: 140,
        baseCelebrate: true,
        bookOpen: false,
        catchOpens: true,
        avoidBook: false,
        mixSeed: 0,
        jarX: 3,
        jarY: 38,
        jarW: 17,
        bookX: 50,
        bookY: 50,
        bookW: 46,
        bookSec: 9,
        title: 'Sprite Sticker Book',
        jarImage: '',
        inL: 10,
        inT: 22,
        inW: 80,
        inH: 64,
        spriteSize: 100,
        epoch: 1
    };
}

/** Merge stored jar preferences with defaults without losing new settings. */
function sjCfg() {
    mSprites.spr.jar = { ...sjDefaults(), ...(mSprites.spr.jar || {}) };
    return mSprites.spr.jar;
}

let sjEvents = [],
    sjSeq = 1,
    sjLastChat = [];
const sjLev = (a, b) => {
    const m = a.length,
        n = b.length;
    if (Math.abs(m - n) > 2) return 9;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++) {
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // swapped letters (jonsey)
        }
    return d[m][n];
};

// "jonesy gold", "one wish willow cheat", "jonsey" (typo ok), "crash bandicoot loot hacker"
function sjParse(words) {
    const flat = (w) =>
        w
            .join('')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');

    for (let k = Math.min(words.length, 4); k >= 1; k--) {
        const c = flat(words.slice(0, k));
        if (!c) continue;
        let s = mSprites.spr.sprites.find((x) => flat([x.id]) === c || flat([x.name]) === c);
        if (!s && c.length >= 5)
            s = mSprites.spr.sprites.find(
                (x) => sjLev(flat([x.name]), c) <= (c.length >= 8 ? 2 : 1)
            );
        if (!s) continue;
        const rest = words.slice(k).join(' ').toLowerCase().trim();
        if (!rest) return { s, v: s.variants[0] };
        const v =
            s.variants.find((x) => x.toLowerCase() === rest) ||
            s.variants.find((x) => x.toLowerCase().split(' ').includes(rest.split(' ')[0])) ||
            s.variants.find((x) => x.toLowerCase().startsWith(rest.split(' ')[0]));
        return v ? { s, v } : { s, v: null, bad: rest };
    }
    return null;
}

/** Queue a bounded jar animation event for the requested sprite/variant. */
function sjPush(s, v, extra) {
    const n = s.variants.filter((x) => mSprites.spr.caught[mSprites.sprKey(s.id, x)]).length;
    const ev = {
        id: sjSeq++,
        sprite: s.id,
        name: s.name,
        rarity: s.rarity,
        variant: v,
        img: sjCut(s) || mSprites.sprImg(s),
        have: n,
        of: s.variants.length,
        complete: n === s.variants.length,
        stats: mSprites.sprStats(),
        at: Date.now(),
        ...(extra || {})
    };
    sjEvents.push(ev);
    if (sjEvents.length > 100) sjEvents = sjEvents.slice(-100);
    return ev;
}

/** Record a sprite catch and queue its corresponding jar animation. */
function sjCatch(s, v, who) {
    const already = !!mSprites.spr.caught[mSprites.sprKey(s.id, v)];
    if (!already) {
        mSprites.sprSet(s.id, v, true);
        mSprites.sprSave();
        sjLastChat.push({ id: s.id, v });
        if (sjLastChat.length > 20) sjLastChat.shift();
    }
    sjPush(s, v, { kind: already ? 'already' : 'catch', who: who || '' });
    return already ? 'already' : 'caught';
}

// Page turning (2026-10-19): { kind: 'turn', dir: 1 | -1 } or { kind: 'turn', sprite: id }.
function sjTurn(dirOrId) {
    const ev = { id: sjSeq++, kind: 'turn', at: Date.now() };
    if (typeof dirOrId === 'number') ev.dir = dirOrId < 0 ? -1 : 1;
    else ev.sprite = String(dirOrId);
    sjEvents.push(ev);
    if (sjEvents.length > 100) sjEvents = sjEvents.slice(-100);
    return 'turn';
}

// Mix up the toys: a new layout seed (saved, so it sticks) + an event so the overlay animates the move.
function sjMix() {
    const c = sjCfg();
    c.mixSeed = ((Number(c.mixSeed) || 0) + 1) % 100000;
    sjEvents.push({ id: sjSeq++, kind: 'shuffle', at: Date.now() });
    if (sjEvents.length > 100) sjEvents = sjEvents.slice(-100);
    mSprites.sprSave();
    return 'mixed';
}

/** Interpret supported sprite jar chat commands while preserving unrelated messages. */
function sjChat(sender, parts) {
    const c = sjCfg();
    if (!c.listen) return '';
    const name = mDomainValidation.cleanString(sender).replace(/^@/, '').toLowerCase();
    const ok = String(c.allowed || '')
        .split(/[\s,]+/)
        .map((x) => x.toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
    if (!name || !ok.includes(name)) return '';
    const text = mParty
        .partyDecode(
            (parts || [])
                .filter((x) => x.t === 'text')
                .map((x) => x.v)
                .join(' ')
        )
        .trim();
    const m = /^!(\S+)\s*(.*)$/.exec(text);
    if (!m) return '';
    let cmd = m[1].toLowerCase(),
        words = m[2].split(/\s+/).filter(Boolean);
    // "!open" / "!close": the propped book lies closed on the floor until she opens it (2026-10-19)
    if (cmd === 'mix' || cmd === 'shuffle') return sjMix();
    if (cmd === 'open' || cmd === 'close') {
        c.bookOpen = cmd === 'open';
        mSprites.sprSave();
        return cmd;
    }
    if (cmd === 'undo' || cmd === 'unsticker') {
        const last = sjLastChat.pop();
        const s = last && mSprites.sprFind(last.id);
        if (!s) return '';
        mSprites.sprSet(s.id, last.v, false);
        mSprites.sprSave();
        sjPush(s, last.v, { kind: 'undo' });
        return 'undone';
    }
    // "!page" next page, "!page back" previous, "!page jonesy" / "!book jonesy" turns to that sprite
    if (cmd === 'page' || ((cmd === 'book' || cmd === 'stickers') && words.length)) {
        const w = words.join(' ').toLowerCase();
        if (!w || ['next', 'forward', '>'].includes(w)) return sjTurn(1);
        if (['back', 'prev', 'previous', '<', 'last'].includes(w)) return sjTurn(-1);
        const r = sjParse(words);
        return r ? sjTurn(r.s.id) : '';
    }
    if (cmd === 'book' || cmd === 'stickers') {
        const s =
            (mSprites.spr.recent[0] && mSprites.sprFind(mSprites.spr.recent[0].id)) ||
            mSprites.spr.sprites[0];
        if (s) sjPush(s, '', { kind: 'peek' });
        return 'peek';
    }
    if (['catch', 'sticker', 'sprite', 'caught'].includes(cmd)) {
        /* "!catch jonesy gold" */
    } else if (c.needPrefix) return '';
    else words = [m[1]].concat(words);
    const r = sjParse(words);
    if (!r) return '';
    if (!r.v) {
        sjPush(r.s, '', { kind: 'unknown', bad: r.bad });
        return 'no-variant';
    }
    return sjCatch(r.s, r.v, sender);
}

// Sticker art (2026-10-19): assets/sprites/<Sprite Name>/<Name>_<Variant>.png, e.g. Jonesy/Jonesy_Gold.png,
// Jonesy/Jonesy.png = Base. Folder and file names are matched loosely (case, spaces, "Adventrue" typo).
// Her art is ~1250 px, so the browser (dashboard or overlay) makes 256 px copies in
// assets/sprite-jar/stickers/<id>__<variant>-<source mtime>.webp; a newer source file makes a new copy.
const SJ_STK_DIR = path.join(SJ_DIR, 'stickers');
try {
    fs.mkdirSync(SJ_STK_DIR, { recursive: true });
} catch (_error) {}
const sjFlat = (v) =>
    String(v || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

/** Match local sticker art to configured sprites and report missing variants. */

const createSpriteJarArt = require('./sprite-jar-art')({
    fs: fs,

    path: path,

    mConfig: mConfig,

    mSprites: mSprites,

    SJ_STK_DIR: SJ_STK_DIR,

    sjFlat: sjFlat
});
const sjArtScan = createSpriteJarArt.sjArtScan;
const sjArtPublic = createSpriteJarArt.sjArtPublic;
const sjCut = createSpriteJarArt.sjCut;

/** Expose discovered sticker URLs and missing-art requirements to the dashboard. */

// The jar uses the see-through cut-out (same picture as the chat avatar, assets/avatars/<id>.png) when there is one.

/** Build the sprite jar response consumed by dashboards and overlays. */
function sjPublic() {
    const c = sjCfg(),
        art = sjArtPublic();
    return {
        ok: true,
        season: mSprites.spr.season,
        settings: {
            ...c,
            jarBack: '/resource-art/JAR_BACK.png',
            jarFront: '/resource-art/JAR_FRONT.png',
            jarUrl: c.jarImage
                ? `/assets/sprite-jar/${encodeURIComponent(c.jarImage)}?v=${(() => {
                      try {
                          return Math.round(fs.statSync(path.join(SJ_DIR, c.jarImage)).mtimeMs);
                      } catch (_e) {
                          return 0;
                      }
                  })()}`
                : ''
        },
        sprites: mSprites.spr.sprites.map((s) => ({
            id: s.id,
            name: s.name,
            rarity: s.rarity,
            img: sjCut(s) || mSprites.sprImg(s),
            variants: s.variants,
            caught: s.variants.filter((v) => mSprites.spr.caught[mSprites.sprKey(s.id, v)]),
            art: art.urls[s.id] || {}
        })),
        needArt: art.need,
        stats: mSprites.sprStats(),
        recent: mSprites.spr.recent[0] ? mSprites.spr.recent[0].id : null,
        last: sjSeq - 1
    };
}

/** Validate and dispatch sprite jar API requests, returning client errors for invalid input. */
async function handleSpriteJarApi(req, res, pathname, method) {
    if (pathname === '/api/sprites/jar' && method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams,
            since = Number(q.get('since')) || 0;
        return mHttpResponse.sendJson(res, 200, {
            ...sjPublic(),
            events: q.get('first') ? [] : sjEvents.filter((e) => e.id > since)
        });
    }
    if (pathname === '/api/sprites/jar' && method === 'POST') {
        const b = await mHttpBody.readBody(req),
            c = sjCfg();
        for (const k of [
            'listen',
            'visible',
            'needPrefix',
            'dashPlays',
            'removeComplete',
            'leaveCaught',
            'baseCelebrate',
            'bookOpen',
            'catchOpens',
            'avoidBook'
        ])
            if (typeof b[k] === 'boolean') c[k] = b[k];
        if (['stickers', 'sprites'].includes(b.jarHolds)) c.jarHolds = b.jarHolds;
        if (['jar', 'floor'].includes(b.mode)) c.mode = b.mode;
        if (['propped', 'pop'].includes(b.bookStyle)) c.bookStyle = b.bookStyle; // propped = always on screen, leaning on the floor (2026-10-19)
        if (['spooky', 'cute'].includes(b.bookTheme)) c.bookTheme = b.bookTheme; // floor = toys scattered along the bottom of the stream (2026-10-19)
        const nums = {
            jarX: [0, 95],
            jarY: [0, 95],
            jarW: [4, 60],
            bookX: [10, 90],
            bookY: [10, 90],
            bookW: [20, 90],
            bookSec: [3, 60],
            inL: [0, 90],
            inT: [0, 90],
            inW: [10, 100],
            inH: [10, 100],
            spriteSize: [30, 250],
            floorL: [0, 90],
            floorR: [10, 100],
            floorH: [3, 60],
            floorB: [0, 60],
            toySize: [30, 300],
            pbX: [0, 80],
            pbW: [10, 60],
            pbB: [0, 60],
            pbTilt: [-20, 20],
            pbLean: [0, 40],
            pbAuto: [0, 300],
            baseBook: [100, 230],
            baseToy: [60, 250]
        };
        for (const [k, [lo, hi]] of Object.entries(nums))
            if (b[k] !== undefined && Number.isFinite(Number(b[k])))
                c[k] = Math.max(lo, Math.min(hi, Number(b[k])));
        for (const k of ['allowed', 'title'])
            if (typeof b[k] === 'string') c[k] = mDomainValidation.cleanString(b[k]).slice(0, 400);
        if (b.play && b.play.id) {
            const s = mSprites.sprFind(b.play.id);
            const v = s && (s.variants.includes(b.play.variant) ? b.play.variant : s.variants[0]);
            if (s) sjPush(s, v, { kind: 'catch', test: true });
        }
        if (b.catchCmd) {
            const r = sjParse(String(b.catchCmd).replace(/^!/, '').split(/\s+/).filter(Boolean));
            if (!r || !r.v)
                return mHttpResponse.sendJson(res, 400, {
                    ok: false,
                    error: 'No sprite/variant matches that.'
                });
            sjCatch(r.s, r.v, 'dashboard');
        }
        if (b.showBook) {
            const s =
                (mSprites.spr.recent[0] && mSprites.sprFind(mSprites.spr.recent[0].id)) ||
                mSprites.spr.sprites[0];
            if (s) sjPush(s, '', { kind: 'peek' });
        }
        if (b.shuffle) sjMix();
        if (b.turn) sjTurn(b.turn.sprite ? String(b.turn.sprite) : Number(b.turn.dir) || 1);
        if (b.removeJar) {
            if (c.jarImage) {
                try {
                    fs.unlinkSync(path.join(SJ_DIR, c.jarImage));
                } catch (_e) {}
            }
            c.jarImage = '';
        }
        if (b.reset) c.epoch++;
        mSprites.sprSave();
        return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/sprites/jar/sticker' && method === 'POST') {
        const b = await mHttpBody.readBody(req),
            a = (sjArtScan()[String(b.id)] || {})[String(b.variant)];
        if (!a)
            return mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'No sticker art for that.'
            });
        const m = /^data:image\/(webp|png);base64,(.+)$/.exec(String(b.dataUrl || ''));
        if (!m) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Bad picture.' });
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 3 * 1024 * 1024)
            return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Too large.' });
        for (const f of fs.readdirSync(SJ_STK_DIR))
            if (f.startsWith(a.key + '-')) {
                try {
                    fs.unlinkSync(path.join(SJ_STK_DIR, f));
                } catch (_e) {}
            }
        fs.writeFileSync(path.join(SJ_STK_DIR, a.thumb), buf);
        return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/sprites/jar/image' && method === 'POST') {
        const b = await mHttpBody.readBody(req),
            c = sjCfg();
        const m = /^data:image\/(png|webp|gif|jpeg|jpg);base64,(.+)$/.exec(String(b.dataUrl || ''));
        if (!m)
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: 'Picture must be a PNG, WEBP, GIF, or JPG.'
            });
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 12 * 1024 * 1024)
            return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Picture is too large.' });
        if (c.jarImage) {
            try {
                fs.unlinkSync(path.join(SJ_DIR, c.jarImage));
            } catch (_e) {}
        }
        c.jarImage = `jar-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
        fs.writeFileSync(path.join(SJ_DIR, c.jarImage), buf);
        mSprites.sprSave();
        return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown sprite jar route.' });
}

Object.assign(exports, { handleSpriteJarApi, sjArtPublic, sjCfg, sjPush, sjChat });
