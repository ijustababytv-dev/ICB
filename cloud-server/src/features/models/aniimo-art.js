'use strict';

/** Resolve collection artwork from the normalized asset reference inventory. */
module.exports = function aniimoArt({ fs, path, mConfig, mDomainValidation, Date }) {
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

    return {
        DEX_ART_DIR,
        dexSlug,
        dexArtFiles,
        dexArtUrl,
        dexFormImg,
        dexFormImgs,
        dexImg,
        get cache() {
            return dexArtList;
        },

        set cache(value) {
            dexArtList = value;
        }
    };
};
