'use strict';
(function () {
    var memory = {};
    var failedWrites = {};
    var prefix = 'icb.recent-pages.v1.';
    var maximum = 1000;
    var excluded = ['/', '/hub.html', '/cloud.html', '/all-pages.html', '/recent-pages.html'];

    /** Retain only local page paths; query strings and fragments are never persisted. */
    function pagePath(value) {
        var path;
        try {
            path = decodeURIComponent(String(value || '').split(/[?#]/)[0]);
        } catch (_error) {
            return null;
        }
        if (
            !/^\/(?!\/).+\.html$/i.test(path) ||
            /[\\\x00-\x1f]/.test(path) ||
            path.length > 500 ||
            excluded.indexOf(path) >= 0
        )
            return null;
        return path;
    }

    /** Namespace UI history by cloud owner; this contains no credentials or feature state. */
    function key(owner) {
        return /^[a-z0-9-]{1,80}$/i.test(owner || '') ? prefix + owner : null;
    }

    /** Ignore corrupt records and collapse repeat visits to the last-opened timestamp. */
    function clean(rows, now) {
        var found = {};
        if (!Array.isArray(rows)) return [];
        for (var i = 0; i < Math.min(rows.length, maximum * 2); i++) {
            var row = rows[i],
                url = row && pagePath(row.url),
                stamp = row && row.openedAt;
            if (
                !url ||
                typeof stamp !== 'number' ||
                !isFinite(stamp) ||
                stamp <= 0 ||
                stamp > now + 60000
            )
                continue;
            if (!found[url] || found[url].openedAt < stamp)
                found[url] = { url: url, openedAt: stamp };
        }
        return Object.keys(found)
            .map(function (url) {
                return found[url];
            })
            .sort(function (a, b) {
                return b.openedAt - a.openedAt || a.url.localeCompare(b.url);
            })
            .slice(0, maximum);
    }

    /** Blocked/full browser storage falls back to this document's RAM without breaking navigation. */
    function read(owner) {
        var name = key(owner);
        if (!name) return [];
        try {
            var stored = JSON.parse(localStorage.getItem(name) || '[]');
            // Quota failures can leave reads working: keep this document's unsaved visits too.
            if (failedWrites[name])
                stored = (Array.isArray(stored) ? stored : []).concat(memory[name] || []);
            return clean(stored, Date.now());
        } catch (_error) {
            return clean(memory[name] || [], Date.now());
        }
    }

    /** Record one real page opening; duplicate polling must never advance its timestamp. */
    function open(owner, value, stamp) {
        var name = key(owner),
            url = pagePath(value);
        if (!name || !url) return false;
        var rows = read(owner);
        rows.unshift({ url: url, openedAt: stamp || Date.now() });
        rows = clean(rows, Date.now());
        memory[name] = rows;
        try {
            localStorage.setItem(name, JSON.stringify(rows));
            failedWrites[name] = false;
        } catch (_error) {
            failedWrites[name] = true;
        }
        var event = document.createEvent('Event');
        event.initEvent('icb-recent', false, false);
        window.dispatchEvent(event);
        return true;
    }

    window.ICBVisits = { read: read, open: open, key: key, clean: clean, pagePath: pagePath };
})();
