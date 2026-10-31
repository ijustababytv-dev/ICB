(function () {
    // Live accessors preserve shared state across the feature files.
    var sharedState = {
        get spriteOf() {
            return spriteOf;
        },

        get drawLeft() {
            return drawLeft;
        },

        get slotEl() {
            return slotEl;
        },

        get drawRight() {
            return drawRight;
        },

        get caption() {
            return caption;
        },

        get propped() {
            return propped;
        },

        get shownOpen() {
            return shownOpen;
        },

        get openBook() {
            return openBook;
        },

        get closeLater() {
            return closeLater;
        },

        get turnTo() {
            return turnTo;
        },

        get stepId() {
            return stepId;
        },

        get isFloor() {
            return isFloor;
        },

        get fit() {
            return fit;
        },

        get syncFloor() {
            return syncFloor;
        },

        get toyAnim() {
            return toyAnim;
        },

        get syncJar() {
            return syncJar;
        },

        get shake() {
            return shake;
        },

        vinfo: vinfo,
        $: $,
        esc: esc,
        get jar() {
            return jar;
        },

        get inner() {
            return inner;
        },

        get book() {
            return book;
        },

        get fly() {
            return fly;
        },

        get S() {
            return S;
        },

        get stats() {
            return stats;
        },

        set stats(value) {
            stats = value;
        },

        get bodies() {
            return bodies;
        },

        get queue() {
            return queue;
        },

        get busy() {
            return busy;
        },

        set busy(value) {
            busy = value;
        },

        get jarKey() {
            return jarKey;
        },

        set jarKey(value) {
            jarKey = value;
        },

        get floorEl() {
            return floorEl;
        },

        get toys() {
            return toys;
        },

        get floorKey() {
            return floorKey;
        },

        set floorKey(value) {
            floorKey = value;
        },

        get pinned() {
            return pinned;
        },

        artOf: artOf,
        get curId() {
            return curId;
        },

        set curId(value) {
            curId = value;
        },

        get tempOpen() {
            return tempOpen;
        },

        set tempOpen(value) {
            tempOpen = value;
        },

        get RAR() {
            return RAR;
        },

        get recentId() {
            return recentId;
        },

        get roster() {
            return roster;
        },

        get season() {
            return season;
        },

        get closeT() {
            return closeT;
        },

        set closeT(value) {
            closeT = value;
        },

        get isOpen() {
            return isOpen;
        },

        set isOpen(value) {
            isOpen = value;
        },

        get alive() {
            return alive;
        },

        set alive(value) {
            alive = value;
        },

        get pageKey() {
            return pageKey;
        },

        set pageKey(value) {
            pageKey = value;
        },

        get next() {
            return next;
        },

        get stage() {
            return stage;
        },

        get bookClass() {
            return bookClass;
        },

        get placeShut() {
            return placeShut;
        },

        get making() {
            return making;
        },

        set making(value) {
            making = value;
        }
    };
    var ICBSpriteJarStickers = window.ICBSpriteJarStickers(sharedState);
    var makeStickers = ICBSpriteJarStickers.makeStickers;

    var ICBSpriteJarAnimation = window.ICBSpriteJarAnimation(sharedState);
    var sparkle = ICBSpriteJarAnimation.sparkle;
    var rectOf = ICBSpriteJarAnimation.rectOf;
    var next = ICBSpriteJarAnimation.next;
    var play = ICBSpriteJarAnimation.play;
    var play2 = ICBSpriteJarAnimation.play2;
    var flyIn = ICBSpriteJarAnimation.flyIn;

    var ICBSpriteJarBook = window.ICBSpriteJarBook(sharedState);
    var spriteOf = ICBSpriteJarBook.spriteOf;
    var drawLeft = ICBSpriteJarBook.drawLeft;
    var slotEl = ICBSpriteJarBook.slotEl;
    var drawRight = ICBSpriteJarBook.drawRight;
    var caption = ICBSpriteJarBook.caption;
    var propped = ICBSpriteJarBook.propped;
    var shownOpen = ICBSpriteJarBook.shownOpen;
    var bookClass = ICBSpriteJarBook.bookClass;
    var placeShut = ICBSpriteJarBook.placeShut;
    var openBook = ICBSpriteJarBook.openBook;
    var closeLater = ICBSpriteJarBook.closeLater;
    var idlePage = ICBSpriteJarBook.idlePage;
    var pageNo = ICBSpriteJarBook.pageNo;
    var turnTo = ICBSpriteJarBook.turnTo;
    var stepId = ICBSpriteJarBook.stepId;

    var ICBSpriteJarPhysics = window.ICBSpriteJarPhysics(sharedState);
    var isFloor = ICBSpriteJarPhysics.isFloor;
    var fit = ICBSpriteJarPhysics.fit;
    var hash = ICBSpriteJarPhysics.hash;
    var syncFloor = ICBSpriteJarPhysics.syncFloor;
    var mixUp = ICBSpriteJarPhysics.mixUp;
    var toyAnim = ICBSpriteJarPhysics.toyAnim;
    var inJar = ICBSpriteJarPhysics.inJar;
    var radius = ICBSpriteJarPhysics.radius;
    var sizeBodies = ICBSpriteJarPhysics.sizeBodies;
    var syncJar = ICBSpriteJarPhysics.syncJar;
    var shake = ICBSpriteJarPhysics.shake;
    var physics = ICBSpriteJarPhysics.physics;

    var VAR = {
        'Base': ['BASE', '#9a9ea8'],
        'Gold': ['GOLD', '#f5a33a'],
        'Cheat Master': ['CHEAT', '#4fb52a'],
        'Loot Hacker': ['HACKER', '#6b6dff'],
        'Bounty Hunter': ['HUNTER', '#e384ea'],
        'Trick or Treat': ['TRICK', '#ff7a2e'],
        'Quack': ['QUACK', '#a46bff']
    };
    var RAR = {
        Common: '#8e949e',
        Uncommon: '#3fae4a',
        Rare: '#3b8df0',
        Epic: '#a052e6',
        Legendary: '#ee8a1c',
        Mythic: '#e6b422',
        Exotic: '#2ad1c9'
    };
    function vinfo(v) {
        return (
            VAR[v] || [
                String(v || '')
                    .toUpperCase()
                    .slice(0, 8),
                '#b77cff'
            ]
        );
    }

    function $(id) {
        return document.getElementById(id);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    var stage = $('stage'),
        jar = $('jar'),
        inner = $('inner'),
        book = $('book'),
        fly = $('fly');
    var recentId = null;
    var S = null,
        roster = [],
        stats = null,
        season = '',
        last = 0,
        started = false,
        epoch = null;
    var bodies = {},
        queue = [],
        busy = false,
        closeT = null,
        jarKey = '';
    var floorEl = document.getElementById('floor'),
        toys = {},
        floorKey = '';

    // ---------- layout ----------

    window.onresize = fit;

    // ---------- floor mode: toys lying around the bottom of the stream ----------
    // Each toy gets a spot from a hash of its name (so they don't reshuffle every time), then a few
    // rounds of nudging so they don't all pile on top of each other. Lower on screen = in front.

    // "Mix up the toys" (dashboard button or !mix): every toy hops and bounces over to a new spot (her request 2026-10-19).

    setInterval(function () {
        // now and then a toy wiggles
        if (!isFloor() || !S.visible) return;
        var ks = [];
        for (var k in toys) if (toys.hasOwnProperty(k) && !toys[k].hidden) ks.push(k);
        if (ks.length) toyAnim(toys[ks[Math.floor(Math.random() * ks.length)]], 'wiggle', 850);
    }, 2600);

    // ---------- sprites in the jar (little physics pile) ----------
    // What's in the jar: one item per sticker that has art (Jonesy_Gold.png...), or one per sprite.
    // pinned = stickers mid-flight, kept until they land even if "caught stickers leave the jar" is on.
    var pinned = {};
    function artOf(s, v) {
        return (s.art && s.art[v]) || null;
    }

    // ---------- book pages ----------

    // Left page: the sprite's name and its big Base sticker. Right page: "My collection" count + bar, then
    // that sprite's variant stickers (her layout, 2026-10-19 - no more grid of every Base on the right).

    var isOpen = false,
        alive = false,
        curId = null,
        pageKey = '',
        autoT = 0;

    var tempOpen = false;

    // The closed book: same spot as the open one, half as wide. It swings open on its spine.

    // The page that shows when nothing is happening (propped book): the sprite she last turned to / caught.

    // Turn the page (with a page-flip), then call done. Same page = no flip.

    setInterval(function () {
        // optional: flip through the pages by itself when nothing is happening
        if (!S || !propped() || !S.pbAuto || busy || queue.length) {
            autoT = 0;
            return;
        }
        autoT += 1;
        if (autoT >= S.pbAuto) {
            autoT = 0;
            turnTo(stepId(1));
        }
    }, 1000);

    // ---------- sparkles ----------

    // ---------- the show ----------

    // ---------- sticker art: shrink her big PNGs to 256 px copies (once per file) ----------
    var making = false;

    // ---------- data ----------
    function poll() {
        var x = new XMLHttpRequest();
        x.open(
            'GET',
            '/api/sprites/jar' + (started ? '?since=' + last : '?first=1') + '&t=' + Date.now(),
            true
        );
        x.timeout = 5000;
        x.onreadystatechange = function () {
            if (x.readyState !== 4) return;
            if (x.status === 200) {
                try {
                    var d = JSON.parse(x.responseText);
                    S = d.settings;
                    roster = d.sprites || [];
                    season = d.season || '';
                    recentId = d.recent;
                    if (!busy) stats = d.stats;
                    if (epoch !== null && S.epoch !== epoch) {
                        queue = [];
                        isOpen = false;
                        alive = false;
                    }
                    epoch = S.epoch;
                    if (!started) {
                        last = d.last || 0;
                        started = true;
                    } else if (d.last < last) last = d.last;
                    var evs = d.events || [];
                    for (var i = 0; i < evs.length; i++)
                        if (evs[i].id > last) {
                            last = evs[i].id;
                            if (evs[i].kind === 'shuffle') {
                                mixUp();
                                continue;
                            }
                            queue.push(evs[i]);
                            if (evs[i].kind === 'catch') {
                                pinned[evs[i].sprite + '|' + evs[i].variant] = 1;
                                pinned[evs[i].sprite] = 1;
                            }
                        }
                    fit();
                    if (isFloor()) syncFloor();
                    else syncJar();
                    makeStickers(d.needArt || []);
                    if (!busy && queue.length) next();
                    if (propped()) idlePage();
                    else if (!busy) pageKey = '';
                } catch (e) {}
            }
            setTimeout(poll, 800);
        };

        x.send();
    }

    $('jarBack').onload = fit;
    var prev = 0;
    function frame(ts) {
        var dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0.016;
        prev = ts;
        if (S && S.visible && !isFloor() && inner.clientWidth > 0) physics(dt);
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    poll();
})();
