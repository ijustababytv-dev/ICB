'use strict';
/** createSpriteJarArt keeps related operations together and reads shared state at call time. */
module.exports = function createSpriteJarArt(context) {
    function sjArtScan() {
        const out = {};
        let dirs = [];
        try {
            dirs = context.fs
                .readdirSync(context.mSprites.SPR_ART_DIR, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
        } catch (_e) {}
        let thumbs = [];
        try {
            thumbs = context.fs.readdirSync(context.SJ_STK_DIR);
        } catch (_e) {}
        for (const sp of context.mSprites.spr.sprites) {
            const dir = dirs.find(
                (d) =>
                    context.sjFlat(d) === context.sjFlat(sp.name) ||
                    context.sjFlat(d) === context.sjFlat(sp.id)
            );
            if (!dir) continue;
            let files = [];
            try {
                files = context.fs
                    .readdirSync(context.path.join(context.mSprites.SPR_ART_DIR, dir))
                    .filter((f) => /\.(png|webp|jpe?g|gif)$/i.test(f));
            } catch (_e) {}
            for (const f of files) {
                const stem = f.replace(/\.[a-z0-9]+$/i, ''),
                    us = stem.indexOf('_');
                let v = null;
                let score = 3;
                if (us < 0) v = sp.variants[0];
                else {
                    const raw = stem.slice(us + 1),
                        suf = context.sjFlat(raw);
                    v = sp.variants.find((x) => context.sjFlat(x) === suf);
                    score = 3;
                    if (!v) {
                        v = sp.variants.find(
                            (x) =>
                                context.sjFlat(x).startsWith(suf) ||
                                suf.startsWith(context.sjFlat(x))
                        );
                        score = 2;
                    }
                    if (!v && suf === 'base') {
                        v = sp.variants[0];
                        score = 3;
                    }
                    if (!v) {
                        // near-miss names like "Klombo_Loot_Master": go by the first word (Loot -> Loot Hacker) when only one variant starts with it
                        const w0 = context.sjFlat(raw.split(/[_\s-]+/)[0]),
                            hits = sp.variants.filter(
                                (x) => w0 && context.sjFlat(x.split(/\s+/)[0]) === w0
                            );
                        if (hits.length === 1) {
                            v = hits[0];
                            score = 1;
                        }
                    }
                }
                if (!v) continue;
                let st = null;
                try {
                    st = context.fs.statSync(
                        context.path.join(context.mSprites.SPR_ART_DIR, dir, f)
                    );
                } catch (_e) {
                    continue;
                }
                const mt = Math.round(st.mtimeMs),
                    isWebp = /\.webp$/i.test(f),
                    had = (out[sp.id] || {})[v];
                if (had && had.score > score) continue; // an exact name beats a near-miss
                if (had && had.score === score && had.webp && !isWebp) continue; // her small .webp copy wins over the big .png (2026-10-19)
                const key = `${sp.id}__${context.mSprites.sprSlug(v)}`,
                    thumb = `${key}-${mt}.webp`;
                const src = `/assets/sprites/${encodeURIComponent(dir)}/${encodeURIComponent(f)}`;
                const direct = isWebp && st.size <= 700 * 1024; // small webp: use it as-is, no copy needed
                (out[sp.id] || (out[sp.id] = {}))[v] = {
                    src,
                    key,
                    thumb,
                    webp: isWebp,
                    score,
                    direct: direct ? `${src}?v=${mt}` : null,
                    ready: direct || thumbs.includes(thumb)
                };
            }
        }
        return out;
    }

    function sjArtPublic() {
        const art = sjArtScan(),
            urls = {},
            need = [];
        for (const [id, vs] of Object.entries(art))
            for (const [v, a] of Object.entries(vs)) {
                if (a.direct) (urls[id] || (urls[id] = {}))[v] = a.direct;
                else if (a.ready)
                    (urls[id] || (urls[id] = {}))[
                        v
                    ] = `/assets/sprite-jar/stickers/${encodeURIComponent(a.thumb)}`;
                else need.push({ id, variant: v, src: a.src });
            }
        return { urls, need };
    }

    function sjCut(s) {
        for (const e of ['png', 'webp', 'gif']) {
            const f = `${s.id}.${e}`;
            try {
                return `/assets/avatars/${f}?v=${Math.round(
                    context.fs.statSync(
                        context.path.join(context.mConfig.APP_DIR, 'assets', 'avatars', f)
                    ).mtimeMs
                )}`;
            } catch (_e) {}
        }
        return null;
    }

    return { sjArtScan: sjArtScan, sjArtPublic: sjArtPublic, sjCut: sjCut };
};
