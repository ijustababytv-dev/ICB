// ICB Chat Unicorns (Baby, 2026-09-29). Meld layer: http://127.0.0.1:8790/walkers.html
// Plain ES5 (Meld rule). Polls /api/walkers/state every second.
//
// Each unicorn hops back and forth along the bottom. Walking right, the
// picture faces right; walking left it is mirrored (scaleX(-1)) - ONLY the
// picture, never the name or the speech bubble, so text is always readable.
// Reaching either edge it turns around. It also does random little things
// (stop and look around, a big hop, a happy spin, a quick trot, turn around,
// sparkles). Each behaviour is one entry in ACTIONS below, so new ones can be
// added later. After afkMinutes without chatting it gets sleepy ("Zzz"),
// turns to the nearest edge and walks off; chatting again brings it back.
(function () {
    // Live accessors preserve shared state across the feature files.
    // Static drawing settings are initialized before feature factories.
    var W = 1920,
        H = 1080;
    var MIN_X = 50,
        MAX_X = 1870;
    var MAX_ON_SCREEN = 40;
    var sharedState = {
        get nameLift() {
            return nameLift;
        },

        W: W,

        get stage() {
            return stage;
        },

        get settings() {
            return settings;
        },

        get walkers() {
            return walkers;
        },

        rand: rand,

        now: now,

        get RAINBOW() {
            return RAINBOW;
        },

        get lookKey() {
            return lookKey;
        },

        set lookKey(value) {
            lookKey = value;
        },

        get lookStyle() {
            return lookStyle;
        },

        MIN_X: MIN_X,

        MAX_X: MAX_X,

        get GROUND_BELOW() {
            return GROUND_BELOW;
        },

        get GROUND_ABOVE() {
            return GROUND_ABOVE;
        },

        get lastReminder() {
            return lastReminder;
        },

        set lastReminder(value) {
            lastReminder = value;
        },

        removeWalker: removeWalker,

        get say() {
            return say;
        },

        get hideBubble() {
            return hideBubble;
        },

        get sparkle() {
            return sparkle;
        },

        get hearts() {
            return hearts;
        },

        get trailDot() {
            return trailDot;
        },

        get MOVES() {
            return MOVES;
        },

        get ACTIONS() {
            return ACTIONS;
        },

        get layoutBubbles() {
            return layoutBubbles;
        },

        get lastT() {
            return lastT;
        },

        set lastT(value) {
            lastT = value;
        }
    };

    var ICBWalkerAppearance = window.ICBWalkerAppearance(sharedState);
    var say = ICBWalkerAppearance.say;
    var hideBubble = ICBWalkerAppearance.hideBubble;
    var sparkle = ICBWalkerAppearance.sparkle;
    var hearts = ICBWalkerAppearance.hearts;
    var trailDot = ICBWalkerAppearance.trailDot;
    var outline = ICBWalkerAppearance.outline;
    var applyLook = ICBWalkerAppearance.applyLook;
    var layoutBubbles = ICBWalkerAppearance.layoutBubbles;

    var ICBWalkerAnimation = window.ICBWalkerAnimation(sharedState);
    var animOn = ICBWalkerAnimation.animOn;
    var animOften = ICBWalkerAnimation.animOften;
    var pickStyle = ICBWalkerAnimation.pickStyle;
    var actionById = ICBWalkerAnimation.actionById;
    var pickAction = ICBWalkerAnimation.pickAction;
    var startAction = ICBWalkerAnimation.startAction;
    var nextGap = ICBWalkerAnimation.nextGap;
    var startEntrance = ICBWalkerAnimation.startEntrance;
    var startExit = ICBWalkerAnimation.startExit;
    var nameLift = ICBWalkerAnimation.nameLift;
    var frame = ICBWalkerAnimation.frame;

    // walking bounds (centre of unicorn)
    var GROUND_BELOW = H - 48,
        GROUND_ABOVE = H - 14; // feet line (room for a name under them, or not)

    var stage = document.getElementById('stage');
    function fit() {
        var sx = window.innerWidth / W,
            sy = window.innerHeight / H;
        stage.style.transform = 'scale(' + Math.min(sx, sy) + ')';
    }

    window.addEventListener('resize', fit);
    fit();

    var settings = {
        enabled: true,
        size: 140,
        speed: 1,
        afkMinutes: 10,
        bubbleSeconds: 7,
        reminderEveryMinutes: 4,
        reminders: [],
        anims: {},
        trickGap: 8,
        entrance: 'drop',
        exitStyle: 'walk'
    };
    var lastTryAt = -1;
    var art = [],
        pick = {};
    var walkers = {}; // lowercase name -> walker
    var lastSeq = -1,
        lastClear = 0,
        lastReminder = Date.now();
    var SUPPORTS = {};

    // Ghosts float instead of hopping: any picture with "ghost" (or "float")
    // in its file name (Baby, 2026-09-29).
    function isFloaty(src) {
        return /ghost|float/i.test(
            decodeURIComponent(
                String(src || '')
                    .split('/')
                    .pop()
            )
        );
    }

    function hash(s) {
        var h = 0;
        for (var i = 0; i < s.length; i++) {
            h = (h * 31 + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }

    function artFor(key) {
        return pick[key] || (art.length ? art[hash(key) % art.length] : '');
    }

    function rand(a, b) {
        return a + Math.random() * (b - a);
    }

    function now() {
        return new Date().getTime();
    }

    // Placeholder unicorn (only until Baby adds art to assets/decor/unicorn).
    var PLACEHOLDER =
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">' +
                '<ellipse cx="55" cy="60" rx="38" ry="24" fill="#ffd6f2" stroke="#b0579a" stroke-width="3"/>' +
                '<circle cx="92" cy="40" r="16" fill="#ffd6f2" stroke="#b0579a" stroke-width="3"/>' +
                '<polygon points="96,26 104,4 106,28" fill="#ffe27a" stroke="#c9a200" stroke-width="2"/>' +
                '<circle cx="97" cy="38" r="2.6" fill="#3a1446"/>' +
                '<path d="M22 50 Q8 40 14 64" stroke="#c77dff" stroke-width="7" fill="none" stroke-linecap="round"/>' +
                '<rect x="30" y="78" width="7" height="18" rx="3" fill="#ffd6f2" stroke="#b0579a" stroke-width="2"/>' +
                '<rect x="70" y="78" width="7" height="18" rx="3" fill="#ffd6f2" stroke="#b0579a" stroke-width="2"/></svg>'
        );

    function makeWalker(name) {
        var key = name.toLowerCase();
        var el = document.createElement('div');
        el.className = 'walker';
        var body = document.createElement('div');
        body.className = 'body';
        var img = document.createElement('img');
        img.src = artFor(key) || PLACEHOLDER;
        img.onerror = function () {
            img.onerror = null;
            img.src = PLACEHOLDER;
        };

        body.appendChild(img);
        var plate = document.createElement('div');
        plate.className = 'name';
        plate.appendChild(document.createTextNode(name));
        var zzz = document.createElement('div');
        zzz.className = 'zzz';
        zzz.appendChild(document.createTextNode('Zzz...'));
        el.appendChild(body);
        el.appendChild(zzz);
        el.appendChild(plate);
        stage.appendChild(el);
        // Pop in at the emptiest spot along the bottom (so their first message
        // is readable straight away), dropping in with a little hop.
        var best = rand(MIN_X + 100, MAX_X - 100),
            bestGap = -1;
        for (var c = 0; c < 24; c++) {
            var cx = rand(MIN_X + 100, MAX_X - 100),
                gap = 99999;
            for (var k in walkers)
                if (walkers.hasOwnProperty(k)) gap = Math.min(gap, Math.abs(walkers[k].x - cx));
            if (gap > bestGap) {
                bestGap = gap;
                best = cx;
            }
        }
        var w = {
            key: key,
            name: name,
            el: el,
            body: body,
            img: img,
            plate: plate,
            zzz: zzz,
            bubble: null,
            bubbleUntil: 0,
            x: best,
            dir: Math.random() < 0.5 ? 1 : -1,
            speed: rand(0.8, 1.25),
            dropStart: now(),
            phase: rand(0, 6.28),
            hop: 0,
            spin: 0,
            lastMsg: now(),
            leaving: false,
            entering: false,
            action: null,
            actionUntil: 0,
            nextActionAt: now() + rand(3000, 9000),
            artSrc: img.src,
            floaty: isFloaty(img.src),
            style: pickStyle(null),
            nextStyleAt: now() + rand(8000, 20000),
            enterStyle: settings.entrance || 'drop'
        };
        walkers[key] = w;
        startEntrance(w, w.enterStyle);
        return w;
    }

    function removeWalker(w) {
        if (w.el.parentNode) w.el.parentNode.removeChild(w.el);
        delete walkers[w.key];
    }

    // ---- speech bubbles --------------------------------------------------

    var RAINBOW = window.ICBWalkerOptions.RAINBOW;

    // ---- animation switches from the dashboard (settings.anims) ------------

    var MOVES = window.ICBWalkerOptions.MOVES;
    // How it gets around: a weighted pick from the movement styles that are on.

    // ---- random tricks (add new ones here + a branch in frame()) ----------
    var ACTIONS = window.ICBWalkerOptions.ACTIONS;

    // ---- arriving and leaving ----------------------------------------------

    // Height taken up by a name shown ABOVE the head (bubbles and Zzz sit above it).

    // Name + chat look from the dashboard: font, size, colour, outline,
    // optional background pill, above/below/hidden, chat text size.
    var lookKey = '';
    var lookStyle = document.createElement('style');
    document.head.appendChild(lookStyle);

    // Keep bubbles on screen and stop neighbours' bubbles covering each other:
    // shift in from the screen edges, then stack any that overlap.

    // ---- main loop ---------------------------------------------------------
    var lastT = 0;

    requestAnimationFrame(frame);

    function onChat(ev) {
        if (!settings.enabled) return;
        var key = ev.name.toLowerCase();
        var w = walkers[key];
        if (w && w.leaving) {
            // was walking off: wake up and come back
            w.leaving = false;
            w.zzz.className = 'zzz';
            w.entering = w.x < MIN_X || w.x > MAX_X;
            w.dir = w.x < W / 2 ? 1 : -1;
        }
        if (!w) {
            var count = 0;
            for (var k in walkers) if (walkers.hasOwnProperty(k)) count++;
            if (count >= MAX_ON_SCREEN) {
                // crowded: the quietest one leaves
                var quiet = null;
                for (var k2 in walkers)
                    if (
                        walkers.hasOwnProperty(k2) &&
                        !walkers[k2].leaving &&
                        (!quiet || walkers[k2].lastMsg < quiet.lastMsg)
                    )
                        quiet = walkers[k2];
                if (quiet) quiet.lastMsg = 0;
            }
            w = makeWalker(ev.name);
        }
        w.lastMsg = now();
        if (settings.showChat !== false) say(w, ev.parts || [], false);
    }

    // "▶ Try" on the dashboard: every unicorn on screen does it right now.
    function tryAnim(id) {
        var t = now();
        for (var k in walkers) {
            if (!walkers.hasOwnProperty(k)) continue;
            var w = walkers[k];
            if (w.leaving) continue;
            if (MOVES.indexOf(id) >= 0) {
                if (!w.floaty) {
                    w.style = id;
                    w.nextStyleAt = t + 15000;
                }
            } else if (id.indexOf('enter:') === 0) {
                w.x = Math.max(MIN_X + 100, Math.min(MAX_X - 100, w.x));
                w.entering = false;
                startEntrance(w, id.slice(6));
            } else if (id.indexOf('exit:') === 0) {
                (function (w2, style) {
                    var keep = settings.exitStyle;
                    settings.exitStyle = style;
                    startExit(w2);
                    settings.exitStyle = keep;
                    setTimeout(function () {
                        if (walkers[w2.key] !== w2) {
                            /* gone: bring it back */ var nw = makeWalker(w2.name);
                            nw.lastMsg = now();
                        } else {
                            w2.leaving = false;
                            w2.zzz.className = 'zzz';
                            w2.el.style.opacity = '';
                            w2.lastMsg = now();
                            w2.entering = w2.x < MIN_X || w2.x > MAX_X;
                            w2.dir = w2.x < W / 2 ? 1 : -1;
                        }
                    }, 4500);
                })(w, id.slice(5));
            } else {
                var a = actionById(id);
                if (a) {
                    w.action = null;
                    startAction(w, t, a);
                }
            }
        }
    }

    function applyArt() {
        for (var key in walkers) {
            if (!walkers.hasOwnProperty(key)) continue;
            var src = artFor(key);
            if (src && walkers[key].artSrc !== src) {
                walkers[key].img.src = src;
                walkers[key].artSrc = src;
                walkers[key].floaty = isFloaty(src);
            }
        }
    }

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/walkers/state?since=' + Math.max(0, lastSeq) + '&_=' + now(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (!d || !d.ok) return;
                settings = d.settings;
                art = d.art || [];
                pick = d.pick || {};
                applyLook();
                applyArt();
                if (d.tryAnim) {
                    if (lastTryAt < 0)
                        lastTryAt = d.tryAnim.at || 0; // don't replay an old preview on load
                    else if (d.tryAnim.at && d.tryAnim.at !== lastTryAt) {
                        lastTryAt = d.tryAnim.at;
                        tryAnim(d.tryAnim.id);
                    }
                }
                if (lastSeq < 0) {
                    lastSeq = d.seq;
                    lastClear = d.clearAt;
                    return;
                } // don't replay old chat on load
                if (d.clearAt !== lastClear) {
                    lastClear = d.clearAt;
                    for (var k in walkers) if (walkers.hasOwnProperty(k)) walkers[k].lastMsg = 0;
                }
                if (!settings.enabled) {
                    for (var k3 in walkers) if (walkers.hasOwnProperty(k3)) walkers[k3].lastMsg = 0;
                }
                for (var i = 0; i < d.events.length; i++) {
                    if (d.events[i].seq > lastSeq) {
                        lastSeq = d.events[i].seq;
                        onChat(d.events[i]);
                    }
                }
            } catch (e) {}
        };

        x.send();
    }

    poll();
    setInterval(poll, 1000);

    window.__walkers = {
        state: function () {
            var o = [];
            for (var k in walkers)
                if (walkers.hasOwnProperty(k)) {
                    var w = walkers[k];
                    o.push({
                        name: w.name,
                        x: Math.round(w.x),
                        dir: w.dir,
                        leaving: w.leaving,
                        action: w.action,
                        style: w.floaty ? 'float' : w.style,
                        floaty: !!w.floaty,
                        bubble: !!w.bubble,
                        flip: w.body.style.transform
                    });
                }
            return o;
        }
    };
})();
