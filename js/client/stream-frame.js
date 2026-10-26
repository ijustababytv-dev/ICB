// ICB Stream Frame overlay (Baby, 2026-10-25). Meld layer, full screen, ABOVE the camera
// and game captures: http://127.0.0.1:8790/stream-frame.html
// Plain ES5 (Meld rule). Polls /api/streamframe every 2 s (no EventSource). The picture is a
// normal <img>; every effect is drawn on the canvas on top of it.
(function () {
    var F = window.ICBFrame;

    /** Shorthand for getElementById. */
    function $(id) {
        return document.getElementById(id);
    }

    var S = null;
    var maps = null;
    var paths = [];
    var stage = $('stage');
    var art = $('art');
    var canvas = $('fx');
    var ctx = canvas.getContext('2d');
    var layers = { glow: $('glowLayer'), crisp: $('crispLayer'), unlit: $('unlitLayer') };
    var shown = { glow: -1, crisp: -1, unlit: -1 };
    var LIGHT_SCALE = 0.5; // the running light is worked out at half size (it is soft anyway)
    var light = document.createElement('canvas'); // running-light buffer, masked by the neon
    var lctx = light.getContext('2d');
    var reach = 30;
    var tinted = { color: '', canvas: null };
    var W = 0;
    var H = 0;
    var loadedArt = '';
    var lastCmd = -1;

    // Effect timers (all in seconds of overlay time).
    var clock = 0;
    var glowBoost = { until: 0, amount: 0 };
    var chaserBoost = { until: 0, speed: 1, extra: false };
    var hueSweep = { from: 0, to: 0 };
    var sunFlare = { until: 0 };
    var intro = { from: -10, to: -10 };
    var flicker = { next: 8, until: 0 };
    var chaserHead = 0;
    var sparkles = [];
    var lastHue = null;

    /** Match the canvas to the window and rebuild the light paths for the new size. */
    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        light.width = Math.round(W * LIGHT_SCALE);
        light.height = Math.round(H * LIGHT_SCALE);
        reach = Math.max(6, 22 * (W / 1672)); // wide enough to catch the tube at jogs, not the palms
        buildPaths();
    }

    window.addEventListener('resize', resize);

    /** Turn the camera/game holes found in the picture into running-light paths on screen. */
    function buildPaths() {
        paths = [];
        if (!maps || !S) return;
        var sx = W / maps.w;
        var sy = H / maps.h;
        for (var i = 0; i < maps.holes.length; i++) {
            var h = maps.holes[i];
            var hole = { x0: h.x0 * sx, y0: h.y0 * sy, x1: h.x1 * sx, y1: h.y1 * sy };
            paths.push(F.framePath(hole, -S.chaserOffset * sx, S.chamfer * sx));
        }
    }

    /** Random number between a and b. */
    function rand(a, b) {
        return a + Math.random() * (b - a);
    }

    /** Load (or swap) the overlay picture, then analyse it and play the power-on intro. */
    function loadArt(url) {
        loadedArt = url;
        art.onload = function () {
            maps = F.analyzeArt(art);
            mountLayers();
            buildPaths();
            if (S && S.introOnLoad) startIntro();
        };

        art.src = url;
    }

    /**
     * Put the glow, crisp and unlit pictures on the page as their own layers. The browser fades
     * them with opacity (cheap, done on the graphics card) instead of the overlay redrawing them
     * full screen every frame.
     */
    function mountLayers() {
        for (var key in layers) {
            if (!layers.hasOwnProperty(key)) continue;
            layers[key].innerHTML = '';
            if (maps) layers[key].appendChild(maps[key]);
            shown[key] = -1;
        }
    }

    /** Set a layer's opacity, only touching the page when the value really changes. */
    function setLayer(key, value) {
        var v = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
        if (v === shown[key]) return;
        shown[key] = v;
        layers[key].style.opacity = v;
    }

    /** Power-on: the neon starts dark, stutters on, then settles with a bright burst. */
    function startIntro() {
        intro.from = clock;
        intro.to = clock + 2.8;
    }

    /** Make the neon glow brighter for a while (bigger requests win). */
    function boostGlow(seconds, amount) {
        if (clock + seconds > glowBoost.until) glowBoost.until = clock + seconds;
        glowBoost.amount = Math.max(glowBoost.amount, amount);
    }

    /** Speed up the running light for a while, optionally with a second light going the other way. */
    function boostChaser(seconds, speed, extra) {
        chaserBoost.until = Math.max(chaserBoost.until, clock + seconds);
        chaserBoost.speed = Math.max(chaserBoost.speed, speed);
        chaserBoost.extra = chaserBoost.extra || extra;
    }

    /** Add one sparkle; capped so a huge bits cheer cannot slow the overlay down. */
    function addSparkle(x, y, r, life, vx, vy, color) {
        if (sparkles.length > 400) return;
        sparkles.push({ x: x, y: y, r: r, age: 0, life: life, vx: vx, vy: vy, color: color });
    }

    /** Burst sparkles out from random points along the frames. */
    function burst(count) {
        if (!paths.length) return;
        for (var i = 0; i < count; i++) {
            var p = F.pointAt(paths[i % paths.length], Math.random());
            addSparkle(
                p[0],
                p[1],
                rand(6, 16) * (W / 1920),
                rand(0.8, 1.8),
                rand(-60, 60),
                rand(-90, 20)
            );
        }
    }

    /** Sparkles falling from the top of the screen (bits). */
    function shower(count) {
        for (var i = 0; i < count; i++)
            addSparkle(
                rand(0, W),
                rand(-H * 0.3, 0),
                rand(5, 13) * (W / 1920),
                rand(2.5, 4.5),
                rand(-15, 15),
                rand(140, 320),
                Math.random() < 0.4 ? '#ffe9a8' : '#ffc4f2'
            );
    }

    /**
     * React to a stream event. Bigger events (more gifted subs, more bits, bigger raids) give
     * bigger reactions, all scaled by the dashboard's "Reaction size".
     */
    function react(cmd) {
        var k = S ? S.reactionStrength : 1;
        var n = Math.min(cmd.size || 1, 20);
        if (cmd.action === 'intro') startIntro();
        if (cmd.action === 'follow') {
            boostGlow(1.5, 0.6 * k);
            boostChaser(2, 3, false);
            burst(Math.round(12 * k));
        }
        if (cmd.action === 'sub') {
            boostGlow(3, k);
            boostChaser(3, 2.5, true);
            burst(Math.round(35 * k));
        }
        if (cmd.action === 'gifts') {
            boostGlow(3 + n * 0.25, k);
            boostChaser(4, 3, true);
            burst(Math.round((20 + n * 6) * k));
        }
        if (cmd.action === 'bits') {
            boostGlow(2, 0.5 * k);
            shower(Math.round(Math.min(160, 12 + (cmd.size || 1) / 15) * k));
        }
        if (cmd.action === 'raid') {
            hueSweep.from = clock;
            hueSweep.to = clock + 4.5;
            sunFlare.until = clock + 4;
            boostGlow(5, 1.2 * k);
            boostChaser(6, 4, true);
            burst(Math.round(60 * k));
        }
    }

    /** How dark the neon is right now (1 = switched off) from the intro and random flickers. */
    function unlitAmount() {
        if (clock < intro.to) {
            var p = (clock - intro.from) / (intro.to - intro.from);
            if (p < 0.15) return 1;
            if (p < 0.8) return Math.random() < 0.55 - p * 0.5 ? 1 : 0.15;
            return Math.max(0, 1 - (p - 0.8) * 5) * 0.5;
        }
        if (S.flicker && S.flickerRate > 0) {
            if (clock > flicker.next) {
                flicker.until = clock + rand(0.2, 0.5);
                flicker.next = clock + rand(0.4, 1.6) * (60 / S.flickerRate);
            }
            if (clock < flicker.until) return Math.sin(clock * 90) > 0.2 ? 0.7 : 0;
        }
        return 0;
    }

    /** Neon glow, flicker and the dark "unlit" look (fades the page layers). */
    function drawNeon(dark) {
        var level = 0;
        if (S.glow) {
            var pulse = 0.55 + 0.45 * Math.sin(clock * S.glowSpeed * 2.1);
            level = (S.glowStrength / 100) * pulse;
        }
        if (clock < glowBoost.until)
            level += glowBoost.amount * Math.min(1, (glowBoost.until - clock) / 1.2);
        else glowBoost.amount = 0;
        if (clock < intro.to && clock > intro.to - 0.6) level += 0.8;
        level *= 1 - dark;
        setLayer('glow', level);
        setLayer('crisp', level * 0.35);
        setLayer('unlit', dark);
    }

    /**
     * The neon tubes brightened and tinted the running-light colour, made once per colour so
     * each frame only has to cut out the part the light is passing over.
     */
    function tintedTubes(color) {
        var key = color + '@' + W + 'x' + H;
        if (tinted.color === key && tinted.canvas) return tinted.canvas;
        // Built at the light buffer's size so each frame copies pixels 1:1 (no resizing per frame).
        var c = document.createElement('canvas');
        c.width = light.width;
        c.height = light.height;
        var g = c.getContext('2d');
        g.drawImage(maps.crisp, 0, 0, c.width, c.height);
        g.globalCompositeOperation = 'lighter';
        g.drawImage(maps.crisp, 0, 0, c.width, c.height);
        // Mostly the chosen colour with a white-hot middle, so it shows on bright orange tubes.
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = 0.85;
        g.fillStyle = color;
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.35;
        g.drawImage(c, 0, 0);
        tinted.color = key;
        tinted.canvas = c;
        return c;
    }

    /**
     * The running light(s) round each frame. Trails are painted into the light buffer, the
     * buffer keeps only the (tinted) neon-tube pixels, and that is added on top so the tubes
     * themselves seem to light up as the light passes.
     */
    function drawChasers(dt, dark) {
        var boosted = clock < chaserBoost.until;
        if (!boosted) {
            chaserBoost.speed = 1;
            chaserBoost.extra = false;
        }
        if ((!S.chaser && !boosted) || !paths.length) return;
        chaserHead += (dt / 7) * S.chaserSpeed * (boosted ? chaserBoost.speed : 1);
        var len = S.chaserLength / 100;
        var two = S.chaserCount > 1 || (boosted && chaserBoost.extra);
        var heads = [];
        var i;
        for (i = 0; i < paths.length; i++) {
            heads.push([paths[i], chaserHead + i * 0.37, 1]);
            if (two) heads.push([paths[i], 0.5 - chaserHead + i * 0.37, -1]);
        }
        // Each light is worked on only inside the small box around its trail, so the cost stays
        // tiny compared with redrawing the whole screen.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - dark;
        // All trails are painted first, then the buffer is cut down to the tube pixels and added
        // to the screen once, only inside the box around the trails. Each canvas-to-canvas copy
        // is costly in browsers, so this keeps it to one cut and one copy per frame.
        var tubes = tintedTubes(S.chaserColor);
        var k = LIGHT_SCALE;
        var u = null;
        lctx.setTransform(k, 0, 0, k, 0, 0); // paint in screen pixels onto the half-size buffer
        for (i = 0; i < heads.length; i++) {
            var box = F.stampChaser(lctx, heads[i][0], heads[i][1], heads[i][2], len, reach, W, H);
            if (!box) continue;
            if (!u) u = { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h };
            u.x0 = Math.min(u.x0, box.x);
            u.y0 = Math.min(u.y0, box.y);
            u.x1 = Math.max(u.x1, box.x + box.w);
            u.y1 = Math.max(u.y1, box.y + box.h);
        }
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        if (u) {
            var bx = Math.floor(u.x0 * k);
            var by = Math.floor(u.y0 * k);
            var bw = Math.min(light.width - bx, Math.ceil((u.x1 - u.x0) * k) + 1);
            var bh = Math.min(light.height - by, Math.ceil((u.y1 - u.y0) * k) + 1);
            lctx.save();
            lctx.beginPath();
            lctx.rect(bx, by, bw, bh);
            lctx.clip();
            lctx.globalCompositeOperation = 'source-in';
            lctx.drawImage(tubes, 0, 0);
            lctx.restore();
            ctx.drawImage(light, bx, by, bw, bh, bx / k, by / k, bw / k, bh / k);
            ctx.drawImage(light, bx, by, bw, bh, bx / k, by / k, bw / k, bh / k);
            lctx.clearRect(bx, by, bw, bh);
        }
        ctx.restore();
        for (i = 0; i < heads.length; i++) {
            var p = F.pointAt(heads[i][0], heads[i][1]);
            F.drawHalo(ctx, p[0], p[1], 40 * (W / 1672), S.chaserColor, 0.6 * (1 - dark));
        }
    }

    /** Twinkle the sky stars, keep the ambient sparkles topped up, and move every sparkle. */
    function drawSparkles(dt) {
        var sx = W / maps.w;
        var sy = H / maps.h;
        var i;
        if (S.stars)
            for (i = 0; i < maps.stars.length; i++) {
                var st = maps.stars[i];
                var a =
                    (S.starTwinkle / 100) * (0.5 + 0.5 * Math.sin(clock * st.speed * 2 + st.phase));
                F.drawSparkle(ctx, st.x * sx, st.y * sy, st.size * sx * 1.8, a);
            }
        var ambient = Math.round((S.sparkles / 100) * 40);
        var live = 0;
        for (i = 0; i < sparkles.length; i++) if (sparkles[i].ambient) live++;
        for (var tries = 0; live < ambient && tries < 12; tries++) {
            var x = rand(0, maps.w);
            var y = rand(0, maps.h);
            if (!F.isSolid(maps, x, y)) continue;
            addSparkle(x * sx, y * sy, rand(4, 11) * (W / 1920), rand(1.2, 2.4), 0, 0);
            sparkles[sparkles.length - 1].ambient = true;
            live++;
        }
        for (i = sparkles.length - 1; i >= 0; i--) {
            var s = sparkles[i];
            s.age += dt;
            if (s.age >= s.life) {
                sparkles.splice(i, 1);
                continue;
            }
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            F.drawSparkle(ctx, s.x, s.y, s.r, Math.sin((Math.PI * s.age) / s.life), s.color);
        }
    }

    /** Colour shift: one fixed shift, a slow cycle, plus the rainbow sweep for raids. */
    function applyHue() {
        var deg = 0;
        if (S.colorMode === 'fixed') deg = S.hueShift;
        if (S.colorMode === 'cycle') deg = S.hueShift + ((clock / S.cycleSpeed) % 1) * 360;
        if (clock < hueSweep.to)
            deg += ((clock - hueSweep.from) / (hueSweep.to - hueSweep.from)) * 360;
        deg = Math.round(deg) % 360;
        if (deg === lastHue) return;
        lastHue = deg;
        var f = deg ? 'hue-rotate(' + deg + 'deg)' : 'none';
        stage.style.filter = f;
        stage.style.webkitFilter = f;
    }

    var last = performance.now();

    /** One animation frame. */
    function render(now) {
        var dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        clock += dt;
        ctx.clearRect(0, 0, W, H);
        if (S && S.visible && maps) {
            var dark = unlitAmount();
            drawNeon(dark);
            if (S.sun)
                F.drawSun(
                    ctx,
                    (S.sunX / 100) * W,
                    (S.sunY / 100) * H,
                    (S.sunR / 100) * W,
                    clock,
                    S.sunShimmer,
                    clock < sunFlare.until ? 0.8 : 0
                );
            drawChasers(dt, dark);
            drawSparkles(dt);
            applyHue();
        }
        requestAnimationFrame(render);
    }

    /** Run the commands (reactions, intro) that are newer than the last one seen. */
    function runCommands(c) {
        if (!c) return;
        if (lastCmd < 0) {
            lastCmd = c.seq; // first poll: do not replay old reactions
            return;
        }
        if (c.seq < lastCmd) lastCmd = 0; // ICB restarted, numbering began again
        for (var i = 0; i < (c.list || []).length; i++) if (c.list[i].n > lastCmd) react(c.list[i]);
        lastCmd = c.seq;
    }

    /** Take the latest settings from ICB. */
    function apply(d) {
        S = d;
        stage.style.display = d.visible ? 'block' : 'none';
        if (d.artUrl !== loadedArt) loadArt(d.artUrl);
        buildPaths();
        runCommands(d.commands);
    }

    /** Ask ICB for settings every two seconds (Meld-safe XHR). */
    function poll() {
        var r = new XMLHttpRequest();
        r.open('GET', '/api/streamframe?_=' + new Date().getTime(), true);
        r.onreadystatechange = function () {
            if (r.readyState !== 4 || r.status !== 200) return;
            try {
                var d = JSON.parse(r.responseText);
                if (d && d.ok) apply(d);
            } catch (e) {}
        };

        r.send();
    }

    resize();
    requestAnimationFrame(render);
    poll();
    setInterval(poll, 2000);
})();
