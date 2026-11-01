'use strict';
(function () {
    const categories = [
        { id: 'stream', label: 'Stream tools', icon: '◷' },
        { id: 'community', label: 'Community & games', icon: '♧' },
        { id: 'overlays', label: 'Overlays & widgets', icon: '▣' },
        { id: 'decor', label: 'Decor & effects', icon: '✧' },
        { id: 'reports', label: 'Activity reports', icon: '▥' },
        { id: 'connections', label: 'Connections', icon: '↗' }
    ];

    /** Compare names consistently, ignoring case, accents and decorative separators. */
    function normalize(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    /** Resolve safe links without allowing script/data URLs or credentials in navigation. */
    function safeURL(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const url = new URL(value, location.origin);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                return null;
            if (url.origin !== location.origin) return url.href;
            const path = decodeURIComponent(url.pathname);
            if (/[\\\x00-\x1f]/.test(path) || path.startsWith('//')) return null;
            return (path === '/hub.html' ? '/' : path) + url.search + url.hash;
        } catch (_error) {
            return null;
        }
    }

    /** Keep the built-in entry when a custom link points at an existing app page. */
    function catalog(extra = []) {
        const seen = new Set();
        return [...window.ICBPageCatalog, ...extra]
            .filter((page) => {
                if (!page || typeof page.label !== 'string') return false;
                const url = safeURL(page.url);
                if (!url || seen.has(url) || !page.label) return false;
                seen.add(url);
                return true;
            })
            .map((page) => ({ ...page, url: safeURL(page.url) }));
    }

    /** Alphabetize across categories, using the URL as a stable tie breaker. */
    function alphabetical(pages) {
        return [...pages].sort(
            (a, b) =>
                normalize(a.label).localeCompare(normalize(b.label)) || a.url.localeCompare(b.url)
        );
    }

    /** Restricted Damerau-Levenshtein distance accepts a nearby typo or adjacent transposition. */
    function distance(first, second, limit) {
        if (Math.abs(first.length - second.length) > limit) return limit + 1;
        const rows = Array.from({ length: first.length + 1 }, () => []);
        for (let i = 0; i <= first.length; i++) rows[i][0] = i;
        for (let j = 0; j <= second.length; j++) rows[0][j] = j;
        for (let i = 1; i <= first.length; i++) {
            for (let j = 1; j <= second.length; j++) {
                rows[i][j] = Math.min(
                    rows[i - 1][j] + 1,
                    rows[i][j - 1] + 1,
                    rows[i - 1][j - 1] + (first[i - 1] === second[j - 1] ? 0 : 1)
                );
                if (
                    i > 1 &&
                    j > 1 &&
                    first[i - 1] === second[j - 2] &&
                    first[i - 2] === second[j - 1]
                )
                    rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
            }
        }
        return rows[first.length][second.length];
    }

    /** Require every query word to match closely; short queries never get typo expansion. */
    function search(pages, input, limit = 8) {
        const query = normalize(String(input).slice(0, 120));
        if (query.length < 2) return [];
        const words = query.split(' ').slice(0, 12);
        return pages
            .map((page) => {
                const title = normalize(page.label);
                const familiar = {
                    '/recent-pages.html': 'recent history previously opened last visited',
                    '/all-pages.html': 'all pages directory browse alphabetical catalog',
                    '/giveaway-report.html':
                        'nightly twitch activity reports messages chat subs bits donations support csv',
                    '/tradeup-control.html': 'plushie wheel spin jar draw',
                    '/tradeup-board.html': 'plushie wheel spin jar draw',
                    '/poll-control.html': 'poll vote voting badges',
                    '/poll.html': 'poll vote voting badges',
                    '/party-control.html': 'cake party signup attendance roles',
                    '/party.html': 'cake party signup event roles',
                    '/giveaway-control.html': 'giveaway raffle tickets subs bits donations draw',
                    '/giveaway-listener.html': 'meld chat twitch listener integration',
                    '/wk/giveaway-listener.html': 'meld chat twitch alternate listener integration'
                };
                const indexed = normalize(
                    page.label + ' ' + (page.aliases || '') + ' ' + (familiar[page.url] || '')
                ).split(' ');
                let score = title === query ? -100 : title.startsWith(query) ? -40 : 0;
                if (query.length >= 4 && title.replace(/ /g, '').includes(query.replace(/ /g, '')))
                    score -= 15;
                for (const word of words) {
                    let best = Infinity;
                    for (const candidate of indexed) {
                        if (candidate === word) best = Math.min(best, 0);
                        else if (word.length >= 2 && candidate.startsWith(word))
                            best = Math.min(best, 2);
                        else if (word.length >= 4) {
                            const tolerance = word.length >= 9 ? 2 : 1;
                            const delta = distance(word, candidate, tolerance);
                            if (delta <= tolerance) best = Math.min(best, 5 + delta);
                        }
                    }
                    // Joined names such as "pokebowl" are exact matches, not loose fuzzy guesses.
                    if (
                        !Number.isFinite(best) &&
                        words.length === 1 &&
                        title.replace(/ /g, '').includes(word)
                    )
                        best = 3;
                    if (!Number.isFinite(best)) return null;
                    score += best;
                }
                return { page, score };
            })
            .filter(Boolean)
            .sort((a, b) => a.score - b.score || a.page.label.localeCompare(b.page.label))
            .slice(0, limit)
            .map((entry) => entry.page);
    }

    window.ICBNavModel = { categories, normalize, safeURL, catalog, alphabetical, search };
})();
