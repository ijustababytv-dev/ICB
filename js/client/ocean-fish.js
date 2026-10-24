// ICB Ocean Fish overlay (Baby, 2026-10-24; several fish pictures added same day). Meld layer:
//   http://127.0.0.1:8790/ocean-fish.html
// Plain ES5 (Meld rule). Polls /api/oceanfish every 2 s (no EventSource); animation runs every frame.
(function () {
    /** Shorthand for getElementById. */
    var $ = function (id) {
        return document.getElementById(id);
    };

    var S = null;
    var canvas = $('waveCanvas');
    var ctx = canvas.getContext('2d');
    var width = (canvas.width = window.innerWidth);
    var height = (canvas.height = window.innerHeight);
    var time = 0;
    var bgColors = ['#050811', '#061325', '#00ff00', null];

    window.addEventListener('resize', function () {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        rebuildSparkles();
    });

    var waves = window.ICBOceanFish.createWaves(ctx, {
        width: function () {
            return width;
        },

        height: function () {
            return height;
        },

        state: function () {
            return S;
        }
    });
    var layers = waves.layers;
    var getWaveY = waves.getWaveY;
    var drawLayer = waves.drawLayer;
    var drawSparkle = waves.drawSparkle;

    var sparkles = [];

    /** Scatter the sparkles over the lower third; called on start, resize, and sparkle-count changes. */
    function rebuildSparkles() {
        var count = S ? S.sparkles : 60;
        sparkles = [];
        for (var i = 0; i < count; i++) {
            sparkles.push({
                x: Math.random() * width,
                y: Math.random() * (height * 0.35) + height * 0.65,
                size: Math.random() * 3.5 + 1.5,
                alpha: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.03 + 0.01
            });
        }
    }

    rebuildSparkles();

    /** The water line fish jump from and splash into (the third wave layer). */
    var surfaceY = function (x) {
        return getWaveY(x, layers[2], time);
    };

    var DEFAULT_FISH = window.ICBOceanFish.makeDefaultFish();

    var defaultImg = new Image();
    defaultImg.src = DEFAULT_FISH;
    var imgCache = {},
        orderIdx = 0,
        lastPick = '';

    /** Load each fish picture once and reuse it. */
    function getImg(url) {
        if (!imgCache[url]) {
            imgCache[url] = new Image();
            imgCache[url].src = url;
        }
        return imgCache[url];
    }

    // Pick the picture for the next jump: a named fish, or the next/random ticked one.
    function pickFish(id) {
        var list = [],
            i;
        var mine = (S && S.fish) || [];
        for (i = 0; i < mine.length; i++) if (mine[i].on || mine[i].id === id) list.push(mine[i]);
        var builtIn = { id: 'default', img: defaultImg, scale: 1, facesLeft: false };
        var choices = [];
        if (!S || S.useDefault !== false || !list.length) choices.push(builtIn);
        for (i = 0; i < list.length; i++)
            choices.push({
                id: list[i].id,
                img: getImg(list[i].url),
                scale: list[i].scale || 1,
                facesLeft: !!list[i].facesLeft
            });
        if (id) for (i = 0; i < choices.length; i++) if (choices[i].id === id) return choices[i];
        if (id === 'default') return builtIn;
        if (S && S.pick === 'order') return choices[orderIdx++ % choices.length];
        var c = choices[Math.floor(Math.random() * choices.length)];
        if (choices.length > 1 && c.id === lastPick)
            c = choices[Math.floor(Math.random() * choices.length)];
        lastPick = c.id; // try not to send the same fish twice in a row
        return c;
    }

    // ---------- Jumps & splashes ----------
    var fishes = [];
    var queued = []; // fish waiting their turn in a group jump: seconds until they go
    // A group jump: jumpCount fish, one after another, jumpSpread seconds apart.
    function startGroup() {
        if (!S) return;
        var n = Math.max(1, S.jumpCount || 1),
            gap = S.jumpSpread === undefined ? 0.4 : S.jumpSpread;
        for (var i = 0; i < n; i++) {
            if (i === 0 && !gap) startJump();
            else queued.push(i * gap + (gap ? rand(-0.15, 0.15) * gap : rand(0, 0.08)));
        }
    }

    var droplets = [];
    var ripples = [];

    /** Random number between a and b. */
    var rand = function (a, b) {
        return a + Math.random() * (b - a);
    };

    /** Launch one fish: size, height, direction and start point vary with the "Timing variety" setting. */
    function startJump(fishId) {
        if (!S) return;
        var v = S.variety;
        var pick = pickFish(fishId);
        var size = S.fishSize * pick.scale * (1 + rand(-1, 1) * v * 0.5);
        var h = height * S.jumpHeight * (1 + rand(-1, 1) * v * 0.6);
        var dir =
            S.directions === 'right'
                ? 1
                : S.directions === 'left'
                ? -1
                : Math.random() < 0.5
                ? 1
                : -1;
        var dist = h * rand(0.7, 1.2);
        var lo = dir > 0 ? size : dist + size;
        var hi = dir > 0 ? width - dist - size : width - size;
        var x0 = hi > lo ? rand(lo, hi) : width / 2;
        var dur = (1.1 + (h / height) * 1.6) / S.jumpSpeed;
        fishes.push({
            x0: x0,
            dir: dir,
            dist: dist,
            h: h,
            dur: dur,
            size: size,
            t: 0,
            entered: false,
            img: pick.img,
            facesLeft: pick.facesLeft
        });
        if (S.splash) makeSplash(x0, size, 1);
    }

    /** Throw droplets and two ripples where a fish leaves or enters the water. */
    function makeSplash(x, size, power) {
        var scale = size / 110;
        var y = surfaceY(x);
        var count = Math.round(rand(16, 24) * power);
        for (var i = 0; i < count; i++) {
            droplets.push({
                x: x + rand(-14, 14) * scale,
                y: y,
                vx: rand(-170, 170) * scale,
                vy: -rand(180, 480) * scale * power,
                r: rand(1.8, 4.5) * Math.max(0.6, scale),
                life: 1,
                gold: Math.random() < 0.25
            });
        }
        ripples.push({ x: x, r: 6 * scale, max: 70 * scale, life: 1 });
        ripples.push({ x: x, r: 2 * scale, max: 45 * scale, life: 1 });
    }

    /** Draw a jumping fish along its arc, tilted to follow it, and splash when it dives back in. */
    function drawFish(f) {
        var img = f.img;
        var t = f.t;
        var x = f.x0 + f.dir * f.dist * t;
        var y = surfaceY(x) + f.size * 0.6 - f.h * 4 * t * (1 - t);
        var angle = Math.atan2(-f.h * 4 * (1 - 2 * t), f.dist);
        var w = f.size;
        var ready = img && img.complete && img.naturalWidth;
        var h = ready ? w * (img.naturalHeight / img.naturalWidth) : 0;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(f.dir, 1);
        ctx.rotate(angle);
        if (f.facesLeft) ctx.scale(-1, 1);
        if (ready) ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
        if (!f.entered && t >= 0.93) {
            f.entered = true;
            if (S && S.splash) makeSplash(x, f.size, 1.15);
        }
    }

    /** Release queued group fish when their turn comes, then move and draw every fish in the air. */
    function updateFish(dt) {
        for (var q = queued.length - 1; q >= 0; q--) {
            queued[q] -= dt;
            if (queued[q] <= 0) {
                queued.splice(q, 1);
                startJump();
            }
        }
        for (var i = fishes.length - 1; i >= 0; i--) {
            var f = fishes[i];
            f.t += dt / f.dur;
            if (f.t > 1.2) {
                fishes.splice(i, 1);
                continue;
            }
            drawFish(f);
        }
    }

    /** Grow and fade ripples; drop droplets with gravity until they hit the water. */
    function updateSplashes(dt) {
        ctx.save();
        var j;
        for (j = ripples.length - 1; j >= 0; j--) {
            var r = ripples[j];
            r.life -= dt * 1.1;
            r.r += (r.max - r.r) * Math.min(1, dt * 3);
            if (r.life <= 0) {
                ripples.splice(j, 1);
                continue;
            }
            ctx.globalAlpha = r.life * 0.8;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.ellipse(r.x, surfaceY(r.x) + 2, r.r, r.r * 0.22, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (j = droplets.length - 1; j >= 0; j--) {
            var d = droplets[j];
            d.vy += 900 * dt;
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.life -= dt * 0.9;
            if (d.life <= 0 || (d.vy > 0 && d.y > surfaceY(d.x) + 6)) {
                droplets.splice(j, 1);
                continue;
            }
            ctx.globalAlpha = Math.min(1, d.life * 1.4);
            ctx.fillStyle = d.gold ? '#ffe484' : '#e8fbff';
            ctx.shadowColor = d.gold ? '#ffd700' : 'rgba(180, 240, 255, 0.8)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // ---------- On-demand show/hide ----------
    var shownUntil = 0;

    // ---------- Main loop ----------
    var last = performance.now();
    var nextJumpIn = 2;

    /** One animation frame: background, waves (fish between the back and front layers), splashes, sparkles, auto-jump timer. */
    function render(now) {
        var dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        var bgIdx = S ? S.bg : 3;
        if (bgColors[bgIdx]) {
            ctx.fillStyle = bgColors[bgIdx];
            ctx.fillRect(0, 0, width, height);
        } else ctx.clearRect(0, 0, width, height);

        // on-demand: if hidden, just clear and skip drawing
        if (S && S.onDemand && shownUntil && Date.now() > shownUntil) {
            requestAnimationFrame(render);
            return;
        }
        // not visible at all: skip drawing
        if (S && !S.visible && !(S.onDemand && shownUntil && Date.now() < shownUntil)) {
            requestAnimationFrame(render);
            return;
        }

        time += 1;
        drawLayer(layers[0], time);
        drawLayer(layers[1], time);
        updateFish(dt);
        drawLayer(layers[2], time);
        drawLayer(layers[3], time);
        updateSplashes(dt);

        sparkles.forEach(function (s) {
            s.alpha += s.speed;
            var a = (Math.sin(s.alpha) + 1) / 2;
            drawSparkle(s.x, s.y + Math.sin(time * 0.03 + s.x) * 6, s.size, a);
        });

        if (S && S.autoJump) {
            nextJumpIn -= dt;
            if (nextJumpIn <= 0) {
                startGroup();
                nextJumpIn = S.jumpEvery * rand(0.5, 1.5);
                if (S.onDemand && S.showOnJump) shownUntil = Date.now() + (S.showSec || 30) * 1000;
            }
        }
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);

    // ---------- Server poll ----------
    // One-off actions (jump / show / hide) arrive as numbered commands in the poll response.
    // Run each command newer than the last one seen; on the first poll just note the number so
    // reopening the overlay does not replay old jumps.
    var lastCmd = -1;
    /** Run the overlay commands (jump / show / hide) that are newer than the last one seen. */
    function runCommands(c) {
        if (!c) return;
        if (lastCmd < 0) {
            lastCmd = c.seq;
            return;
        }
        if (c.seq < lastCmd) lastCmd = 0; // ICB restarted, numbering began again
        for (var i = 0; i < (c.list || []).length; i++) {
            var cmd = c.list[i];
            if (cmd.n <= lastCmd) continue;
            if (cmd.action === 'jump') {
                if (cmd.fishId) startJump(cmd.fishId);
                else startGroup();
            }
            if (cmd.action === 'show') shownUntil = Date.now() + (S.showSec || 30) * 1000;
            if (cmd.action === 'hide') shownUntil = 1;
        }
        lastCmd = c.seq;
    }

    /** Take the latest settings from ICB, preload fish pictures, and run new commands. */
    function apply(d) {
        var oldSparkles = S ? S.sparkles : 60;
        S = d;
        for (var i = 0; i < (d.fish || []).length; i++) if (d.fish[i].on) getImg(d.fish[i].url); // preload
        if (d.sparkles !== oldSparkles) rebuildSparkles();
        runCommands(d.commands);
    }

    /** Ask ICB for settings every two seconds (Meld-safe XHR). */
    function poll() {
        var r = new XMLHttpRequest();
        r.open('GET', '/api/oceanfish?_=' + new Date().getTime(), true);
        r.onreadystatechange = function () {
            if (r.readyState !== 4 || r.status !== 200) return;
            try {
                var d = JSON.parse(r.responseText);
                if (d && d.ok) apply(d);
            } catch (e) {}
        };

        r.send();
    }

    poll();
    setInterval(poll, 2000);
})();
