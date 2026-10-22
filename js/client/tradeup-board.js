(function () {
    // Live accessors preserve shared state across the feature files.
    // Static drawing settings are initialized before feature factories.
    var JAR_IMG_W = 1024,
        JAR_IMG_H = 1536;
    var FRONT_FALLBACK_ALPHA = 0.55;
    var R = 30;
    var MAX_BODIES = 200;
    var TIP_MS = 1300,
        MIX_MS = 4200,
        UPRIGHT_MS = 1300,
        RISE_MS = 1000,
        BANNER_MS = 99999999;
    var DEFAULT_FILTER_MASK = 0xffffffff;
    var FONT = '"Baloo 2","Comic Sans MS","Trebuchet MS",sans-serif';
    var FRONT_SHEEN_ALPHA = 0.3;
    var sharedState = {
        get Body() {
            return Body;
        },

        get Sleeping() {
            return Sleeping;
        },

        get W() {
            return W;
        },

        get H() {
            return H;
        },

        R: R,

        TIP_MS: TIP_MS,

        MIX_MS: MIX_MS,

        UPRIGHT_MS: UPRIGHT_MS,

        RISE_MS: RISE_MS,

        DEFAULT_FILTER_MASK: DEFAULT_FILTER_MASK,

        get engine() {
            return engine;
        },

        get jar() {
            return jar;
        },

        get J() {
            return J;
        },

        get bodies() {
            return bodies;
        },

        get phase() {
            return phase;
        },

        set phase(value) {
            phase = value;
        },

        get phaseStart() {
            return phaseStart;
        },

        set phaseStart(value) {
            phaseStart = value;
        },

        get winnerBody() {
            return winnerBody;
        },

        set winnerBody(value) {
            winnerBody = value;
        },

        get flights() {
            return flights;
        },

        set flights(value) {
            flights = value;
        },

        isInJar: isInJar,

        get pendingReveal() {
            return pendingReveal;
        },

        set pendingReveal(value) {
            pendingReveal = value;
        },

        get winnerBanner() {
            return winnerBanner;
        },

        set winnerBanner(value) {
            winnerBanner = value;
        },

        get ctx() {
            return ctx;
        },

        JAR_IMG_W: JAR_IMG_W,

        JAR_IMG_H: JAR_IMG_H,

        FRONT_FALLBACK_ALPHA: FRONT_FALLBACK_ALPHA,

        get JAR_BACK() {
            return JAR_BACK;
        },

        get JAR_FRONT() {
            return JAR_FRONT;
        },

        get frontUsable() {
            return frontUsable;
        },

        FONT: FONT,

        getImg: getImg,

        FRONT_SHEEN_ALPHA: FRONT_SHEEN_ALPHA
    };

    var ICBTradeupDraw = window.ICBTradeupDraw(sharedState);
    var wakeAll = ICBTradeupDraw.wakeAll;
    var setPhase = ICBTradeupDraw.setPhase;
    var rotateJarToward = ICBTradeupDraw.rotateJarToward;
    var spillJar = ICBTradeupDraw.spillJar;
    var lotteryMix = ICBTradeupDraw.lotteryMix;
    var startFlight = ICBTradeupDraw.startFlight;
    var ease = ICBTradeupDraw.ease;
    var updateFlights = ICBTradeupDraw.updateFlights;
    var release = ICBTradeupDraw.release;
    var restore = ICBTradeupDraw.restore;
    var abortDraw = ICBTradeupDraw.abortDraw;
    var updateDraw = ICBTradeupDraw.updateDraw;

    var ICBTradeupRendering = window.ICBTradeupRendering(sharedState);
    var roundRect = ICBTradeupRendering.roundRect;
    var jarTransform = ICBTradeupRendering.jarTransform;
    var drawJarImage = ICBTradeupRendering.drawJarImage;
    var drawJarBack = ICBTradeupRendering.drawJarBack;
    var drawJarFront = ICBTradeupRendering.drawJarFront;
    var drawItem = ICBTradeupRendering.drawItem;
    var drawBanner = ICBTradeupRendering.drawBanner;
    var render = ICBTradeupRendering.render;

    // Full-screen Meld overlay. Every plushie in the catalog (config/tradeup-
    // game.json, the same 30-slot "board" the old marquee page used) sits in a
    // physics jar. Pressing "Spin" on tradeup-control.html tips the jar over,
    // the plushies roll and bounce around like lottery balls, then the one the
    // server already picked (tradeup.revealed) rises up center-screen with its
    // name. "Shuffle" swaps in a fresh 30 from the catalog.
    //
    // IMPORTANT: the server (tradeupSpin() in server.js) already decided the
    // winner the moment Spin was pressed - this page only animates the result.
    // Kept the same filename/route (tradeup-board.html, /api/tradeup/state) as
    // the original marquee board (Baby, 2026-09-26: "restyle it as a jar") so
    // an already-added Meld browser source URL keeps working unchanged.
    //
    // Plain ES5 + XHR polling, same rules as every other Meld overlay here.
    // Physics: Matter.js 0.20.0 (MIT), served locally as matter.min.js.

    var M = Matter,
        Engine = M.Engine,
        Bodies = M.Bodies,
        Body = M.Body,
        Composite = M.Composite,
        Sleeping = M.Sleeping;

    var canvas = document.getElementById('c');
    var ctx = canvas.getContext('2d');
    var W = window.innerWidth || 1920,
        H = window.innerHeight || 1080;
    canvas.width = W;
    canvas.height = H;

    // Same jar art as unicorn-jar.html - it's just a glass jar, reusable for
    // any prize. Both files are served from the ICB root, so the same
    // relative path works here too.

    var JAR_BACK = new Image(),
        JAR_FRONT = new Image();
    var frontUsable = false;
    JAR_BACK.src = 'assets/resources/JAR_BACK.png';
    JAR_FRONT.onload = function () {
        try {
            var probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            var pc = probe.getContext('2d');
            pc.drawImage(JAR_FRONT, 4, 4, 1, 1, 0, 0, 1, 1);
            frontUsable = pc.getImageData(0, 0, 1, 1).data[3] < 20;
        } catch (e) {
            frontUsable = false;
        }
    };

    JAR_FRONT.src = 'assets/resources/JAR_FRONT.png';

    // item body radius - bigger than a unicorn's since these carry a photo
    // the catalog board is only ever 30 - this is just a safety cap

    var engine = null,
        world = null,
        jar = null;
    var J = {};
    var bodies = []; // bodies[i] always matches board[i] - see applyBoard()
    var board = [];
    var lastBoardKey = null;
    var phase = 'idle',
        phaseStart = 0;
    var winnerBody = null,
        winnerAt = 0;
    var lastSpinSeq = -1;
    var flights = [];
    var imageCache = {};

    function getImg(url) {
        if (!url) return null;
        if (!imageCache[url]) {
            var im = new Image();
            im.src = url;
            imageCache[url] = im;
        }
        return imageCache[url];
    }

    // ------------------------------------------------------------------ setup
    function init() {
        engine = Engine.create({ enableSleeping: true });
        engine.gravity.y = 1;
        engine.positionIterations = 8;
        engine.velocityIterations = 6;
        world = engine.world;

        var wallOpts = { isStatic: true, friction: 0.2, restitution: 0.2 };
        Composite.add(world, [
            Bodies.rectangle(W / 2, H + 100, W * 3, 200, wallOpts),
            Bodies.rectangle(-100, H / 2, 200, H * 4, wallOpts),
            Bodies.rectangle(W + 100, H / 2, 200, H * 4, wallOpts),
            Bodies.rectangle(W / 2, -R * 8 - 100, W * 3, 200, wallOpts)
        ]);

        // Same math as unicorn-jar.html's init(), just always centered - this
        // page is its own dedicated Meld layer, so Baby positions/sizes the
        // whole layer in Meld rather than picking a side here.
        var js = Math.min((H * 0.7) / JAR_IMG_H, (W * 0.4) / JAR_IMG_W);
        var jarW = JAR_IMG_W * js;
        var t = Math.max(10, 30 * js);
        var cx = W / 2;
        var ox = cx - jarW / 2,
            oy = H - 1460 * js;
        function P(x, y) {
            return { x: ox + x * js, y: oy + y * js };
        }

        J = {
            s: js,
            ox: ox,
            oy: oy,
            cx: cx,
            w: jarW,
            h: JAR_IMG_H * js,
            t: t,
            left: P(13, 0).x,
            right: P(1011, 0).x,
            top: P(0, 13).y,
            bottom: H,
            innerLeft: P(80, 0).x,
            innerRight: P(944, 0).x,
            bodyTop: P(0, 430).y,
            innerBottom: P(0, 1322).y,
            mouthLeft: P(190, 0).x,
            mouthRight: P(834, 0).x,
            innerTop: P(0, 40).y,
            angle: 0
        };
        J.cols = Math.max(1, Math.floor((J.innerRight - J.innerLeft) / (2 * R)));
        J.rows = Math.max(1, Math.floor((J.innerBottom - J.bodyTop) / (2 * R)));
        J.capacity = J.cols * J.rows;
        J.tipDir = -1;
        J.pivot = P(60, 1460);
        J.tipAngle = 1.68 * J.tipDir;

        var jarOpts = { isStatic: true, friction: 0.05, restitution: 0.3 };
        function seg(x1, y1, x2, y2) {
            var a = P(x1, y1),
                b = P(x2, y2);
            var dx = b.x - a.x,
                dy = b.y - a.y,
                len = Math.sqrt(dx * dx + dy * dy);
            return Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + t, t, {
                isStatic: true,
                angle: Math.atan2(dy, dx),
                friction: 0.05,
                restitution: 0.3
            });
        }

        var parts = [
            seg(80, 1337, 944, 1337),
            seg(64, 1330, 64, 430),
            seg(64, 430, 170, 228),
            seg(170, 228, 170, 40),
            seg(960, 1330, 960, 430),
            seg(960, 430, 854, 228),
            seg(854, 228, 854, 40)
        ];
        jar = Body.create({ parts: parts, isStatic: true });
        Composite.add(world, jar);
    }

    // -------------------------------------------------------------- item bodies
    function makeItemBody(boxEntry, x, y) {
        var b = Bodies.circle(x, y, R, {
            restitution: 0.45,
            friction: 0.03,
            frictionStatic: 0.3,
            frictionAir: 0.012,
            density: 0.0015,
            sleepThreshold: 45
        });
        Body.setAngle(b, (Math.random() - 0.5) * 0.6); // items keep mostly upright, unlike tumbling unicorns
        b.box = boxEntry;
        b.renderScale = 1;
        Composite.add(world, b);
        return b;
    }

    function clearAll() {
        for (var i = 0; i < bodies.length; i++) if (bodies[i]) Composite.remove(world, bodies[i]);
        bodies = [];
        flights = [];
        winnerBody = null;
    }

    function toJarLocal(p) {
        var a = -J.angle,
            dx = p.x - J.pivot.x,
            dy = p.y - J.pivot.y;
        return {
            x: J.pivot.x + dx * Math.cos(a) - dy * Math.sin(a),
            y: J.pivot.y + dx * Math.sin(a) + dy * Math.cos(a)
        };
    }

    function isInJar(b) {
        var p = toJarLocal(b.position);
        return (
            p.x > J.innerLeft &&
            p.x < J.innerRight &&
            p.y > J.innerTop - R &&
            p.y < J.innerBottom + R
        );
    }

    // Lay all 30 board items into the jar at once and let physics settle them
    // before the first frame - same trick unicorn-jar.html uses on first load.
    function placeInstantly(list) {
        var i, b;
        for (i = 0; i < list.length && i < MAX_BODIES; i++) {
            var col = i % J.cols,
                row = Math.floor(i / J.cols);
            b = makeItemBody(
                list[i],
                J.innerLeft + R + col * 2 * R + (Math.random() - 0.5) * R * 0.6,
                J.innerBottom - R - row * 2.2 * R - Math.random() * R
            );
            bodies.push(b);
        }
        for (i = 0; i < 300; i++) Engine.update(engine, 1000 / 60);
    }

    function boardKeyOf(b) {
        var parts = [];
        for (var i = 0; i < b.length; i++) parts.push(b[i].item ? b[i].item.id : 'empty');
        return parts.join(',');
    }

    // Board changed (fresh deal / Shuffle) - clear the jar and re-place the
    // new 30. bodies[i] is kept in the same order as board[i] the whole time
    // so a later reveal.position can look up its body directly.
    function applyBoard(newBoard) {
        board = newBoard || [];
        var key = boardKeyOf(board);
        if (key === lastBoardKey && bodies.length) return;
        lastBoardKey = key;
        clearAll();
        placeInstantly(board);
        phase = 'idle';
    }

    // ---------------------------------------------------------------- drawing

    // A winner currently in the air/holding position needs its filter mask
    // cleared so the mix doesn't fling it back into the crowd.

    var pendingReveal = null;

    var winnerBanner = null;

    // -------------------------------------------------------------- rendering

    // Baby (2026-09-27): show the actual plushie photo as-is - no circular
    // crop/frame around it, and no name text on or under it. The physics body
    // underneath is still a circle (that's just for the bouncing/rolling), but
    // what's drawn is the real image, uncropped, sized up a bit past the
    // body's diameter so it reads clearly instead of looking shrunk down.

    function frame() {
        var now = Date.now();
        if (engine) {
            updateDraw(now);
            updateFlights(now);
            Engine.update(engine, 1000 / 60);
        }
        render(now);
        requestAnimationFrame(frame);
    }

    // ------------------------------------------------------------------- data
    var hasLoadedOnce = false;
    function onState(state) {
        if (!engine) init();
        applyBoard(state.board);

        if (state.revealed) {
            if (state.spinSeq === lastSpinSeq) return; // already showing/animating this exact spin
            lastSpinSeq = state.spinSeq;
            if (!hasLoadedOnce) {
                // Page just loaded onto an already-resolved spin - show it instantly.
                var b0 = bodies[state.revealed.position];
                if (b0) {
                    winnerBody = b0;
                    release(b0);
                    Body.setStatic(b0, true);
                    Body.setPosition(b0, { x: W / 2, y: H * 0.32 });
                }
                winnerBanner = {
                    item: state.revealed.item,
                    kind: state.revealed.kind,
                    bannerAt: 0
                };
                setPhase('reveal', Date.now());
            } else {
                pendingReveal = state.revealed;
                winnerBody = null;
                winnerBanner = null;
                wakeAll();
                setPhase('tip', Date.now());
            }
        } else {
            if (state.spinSeq === lastSpinSeq) {
                hasLoadedOnce = true;
                return;
            }
            lastSpinSeq = state.spinSeq;
            if (phase !== 'tip' && phase !== 'mix' && phase !== 'settle') abortDraw();
        }
        hasLoadedOnce = true;
    }

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/tradeup/state?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d) onState(d);
            } catch (e) {}
        };

        x.send();
    }

    poll();
    setInterval(poll, 1500);
    requestAnimationFrame(frame);
})();
