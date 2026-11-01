// Effects for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
    jarState.loadFx = function loadFx(key, src, maxSide) {
        var img = new Image();
        img.onload = function () {
            var sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * sc));
            c.height = Math.max(1, Math.round(img.naturalHeight * sc));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            if (key === 'stars') jarState.FX.stars.push(c);
            else if (key === 'rainbow') jarState.FX.rainbow = c;
            else jarState.FX[key] = c;
        };

        img.src = src;
    };

    jarState.cloudW = function cloudW() {
        return Math.min(
            jarState.W * 0.6,
            Math.min(jarState.W * 0.24, jarState.J.w * 1.05) * jarState.settings.cloudScale
        );
    };

    // Where the next unicorn should fall from, and move the cloud there.
    jarState.dropPoint = function dropPoint(intoJar) {
        var cw = jarState.cloudW();
        if (!jarState.cloud.inited) {
            jarState.cloud.x = intoJar ? jarState.J.cx : jarState.W / 2;
            jarState.cloud.inited = true;
        }
        jarState.cloud.lastUse = Date.now();
        if (intoJar) {
            return (
                jarState.J.mouthLeft +
                jarState.R +
                Math.random() *
                    Math.max(1, jarState.J.mouthRight - jarState.J.mouthLeft - 2 * jarState.R)
            );
        }
        // Jar full: the cloud stays over the jar, so overflow unicorns pop out of
        // the cloud's left or right edge and get flung out to the floor (see
        // spawnDrop, which gives them the sideways push).
        return null;
    };

    jarState.updateCloud = function updateCloud(now) {
        var drawCloudOn = jarState.phase === 'rain' || jarState.phase === 'gather';
        // Baby (2026-09-26): the cloud now parks over the jar for the whole
        // stream instead of fading out between drops - always visible.
        jarState.cloud.alpha += (1 - jarState.cloud.alpha) * 0.08;
        var cw = jarState.cloudW();
        if (jarState.phase === 'gather') {
            jarState.cloud.x += (jarState.W / 2 - jarState.cloud.x) * 0.06;
            jarState.cloud.y = Math.max(60, cw * 0.28);
            return;
        }
        // Baby (2026-09-26): no more run-away cloud - it stays parked over the
        // jar all stream, even when the jar is full. It only sweeps across the
        // screen during a drawing's rain.
        if (jarState.phase !== 'rain' || jarState.DRAW_JAR_ONLY) {
            jarState.cloud.x += (jarState.J.cx - jarState.cloud.x) * 0.06;
        } else {
            // Sweep back and forth over the free part of the screen.
            jarState.cloud.x += jarState.cloud.dir * (jarState.phase === 'rain' ? 11 : 5);
            if (jarState.cloud.x > jarState.W - cw / 2) {
                jarState.cloud.x = jarState.W - cw / 2;
                jarState.cloud.dir = -1;
            }
            if (jarState.cloud.x < cw / 2) {
                jarState.cloud.x = cw / 2;
                jarState.cloud.dir = 1;
            }
        }
        jarState.cloud.y = Math.max(60, cw * 0.28) + Math.sin(now / 500) * 6;
    };

    jarState.sparkleAt = function sparkleAt(x, y, n) {
        if (!jarState.magic) return;
        for (var i = 0; i < n && jarState.sparks.length < jarState.MAX_SPARKS; i++) {
            // Accents are half a unicorn's size (Baby: "they are meant to be accents").
            // Mostly stars, sometimes a little rainbow, plus tiny glowing sparkles.
            var roll = Math.random(),
                img = null;
            if (roll < 0.62 && jarState.FX.stars.length)
                img = jarState.FX.stars[Math.floor(Math.random() * jarState.FX.stars.length)];
            else if (roll < 0.8 && jarState.FX.rainbow) img = jarState.FX.rainbow;
            var isRainbow = img === jarState.FX.rainbow;
            jarState.sparks.push({
                x: x + (Math.random() - 0.5) * jarState.R * 3,
                y: y + (Math.random() - 0.5) * jarState.R,
                vx: (Math.random() - 0.5) * 2.4,
                vy: 0.6 + Math.random() * 2.2,
                rot: isRainbow ? (Math.random() - 0.5) * 0.4 : Math.random() * 6.28,
                vr: isRainbow ? (Math.random() - 0.5) * 0.02 : (Math.random() - 0.5) * 0.12,
                size: img
                    ? jarState.R * (isRainbow ? 3.2 : 1.2) * (0.9 + Math.random() * 0.2)
                    : 2 + Math.random() * 3,
                img: img,
                born: Date.now(),
                life: 1500 + Math.random() * 1300,
                tw: Math.random() * 6.28
            });
        }
    };

    // Big moments (gift bombs, big hand-adds): an extra shower of accents.
    jarState.triggerRainbow = function triggerRainbow(ms) {
        if (!jarState.magic) return;
        jarState.sparkleAt(
            jarState.cloud.inited ? jarState.cloud.x : jarState.J.cx,
            jarState.cloud.inited ? jarState.cloud.y : jarState.J.top,
            Math.min(30, Math.round((ms || 3500) / 250))
        );
    };

    jarState.drawRainbow = function drawRainbow(now) {
        jarState.rainbow.alpha +=
            ((now < jarState.rainbow.until ? 1 : 0) - jarState.rainbow.alpha) * 0.05;
        if (jarState.rainbow.alpha < 0.01 || !jarState.FX.rainbow) return;
        var rw = Math.min(jarState.W * 0.45, jarState.J.w * 1.75),
            rh = (rw * jarState.FX.rainbow.height) / jarState.FX.rainbow.width;
        var cx =
            jarState.phase === 'rise'
                ? jarState.W / 2
                : Math.max(rw / 2 + 10, Math.min(jarState.W - rw / 2 - 10, jarState.J.cx)); // keep it all on screen
        var base =
            jarState.phase === 'rise'
                ? jarState.H * 0.3 + rh * 0.25
                : jarState.J.top + jarState.J.h * 0.18;
        jarState.ctx.save();
        jarState.ctx.globalAlpha = jarState.rainbow.alpha * 0.95;
        var grow = 0.85 + 0.15 * jarState.rainbow.alpha;
        jarState.ctx.drawImage(
            jarState.FX.rainbow,
            cx - (rw * grow) / 2,
            base - rh * grow,
            rw * grow,
            rh * grow
        );
        jarState.ctx.restore();
    };

    jarState.drawCloud = function drawCloud() {
        if (jarState.cloud.alpha < 0.01 || !jarState.FX.cloud) return;
        var cw = jarState.cloudW(),
            ch = (cw * jarState.FX.cloud.height) / jarState.FX.cloud.width;
        jarState.ctx.save();
        jarState.ctx.globalAlpha = jarState.cloud.alpha;
        jarState.ctx.drawImage(
            jarState.FX.cloud,
            jarState.cloud.x - cw / 2,
            jarState.cloud.y - ch / 2,
            cw,
            ch
        );
        jarState.ctx.restore();
    };

    // Stars & rainbows that get blown around with the lottery mix while a
    // winner is being picked. Baby (2026-09-27): more of them, and sized
    // "medium" on purpose - bigger than the half-size accents that settle
    // into the jar, smaller than a unicorn, so they read clearly while they
    // swirl but don't crowd out the unicorns themselves. Built directly
    // (rather than through sparkleAt) so every one is a star or rainbow at
    // that size, not the occasional plain sparkle dot.
    jarState.swirlAccents = function swirlAccents(n, life) {
        if (!jarState.magic) return;
        // "Medium" here means: clearly bigger than the half-size accents that
        // settle into the jar (those draw at ~R wide) and smaller than a full
        // unicorn (~R*2.4 wide) - big enough to read clearly while they swirl.
        var mediumSize = jarState.R * 1.6;
        var RAINBOW_SCALE = 4.2; // Baby: rainbows much bigger - ~2.6x the stars
        for (var i = 0; i < n && jarState.sparks.length < jarState.MAX_SPARKS; i++) {
            var isRainbow = Math.random() < 0.22 && jarState.FX.rainbow;
            var img = isRainbow
                ? jarState.FX.rainbow
                : jarState.FX.stars.length
                ? jarState.FX.stars[Math.floor(Math.random() * jarState.FX.stars.length)]
                : null;
            if (!img) continue;
            jarState.sparks.push({
                x: Math.random() * jarState.W,
                y: jarState.H * 0.15 + Math.random() * jarState.H * 0.8,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                rot: isRainbow ? (Math.random() - 0.5) * 0.4 : Math.random() * 6.28,
                vr: isRainbow ? (Math.random() - 0.5) * 0.02 : (Math.random() - 0.5) * 0.12,
                size:
                    (isRainbow ? jarState.R * RAINBOW_SCALE : mediumSize) *
                    (0.85 + Math.random() * 0.3),
                img: img,
                swirl: true,
                born: Date.now(),
                life: life * (0.85 + Math.random() * 0.15),
                tw: Math.random() * 6.28
            });
        }
    };

    jarState.drawSparks = function drawSparks(now) {
        for (var i = jarState.sparks.length - 1; i >= 0; i--) {
            var p = jarState.sparks[i],
                age = now - p.born;
            if (age > p.life) {
                jarState.sparks.splice(i, 1);
                continue;
            }
            if (p.swirl) {
                p.vx += Math.sin(p.y * 0.006 + now * 0.0021) * 0.55 + (Math.random() - 0.5) * 0.4;
                p.vy += Math.cos(p.x * 0.006 + now * 0.0017) * 0.55 + (Math.random() - 0.5) * 0.4;
                p.vx *= 0.97;
                p.vy *= 0.97;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr * 3;
                if (p.x < 10 || p.x > jarState.W - 10) p.vx = -p.vx;
                if (p.y < 10 || p.y > jarState.H - 10) p.vy = -p.vy;
            } else {
                p.vy += 0.035;
                p.vx *= 0.99;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr;
            }
            var fade = p.swirl
                ? Math.min(1, age / 400) * Math.min(1, (p.life - age) / 800)
                : Math.min(1, age / 150) * (1 - Math.pow(age / p.life, 2));
            var twinkle = 0.75 + 0.25 * Math.sin(now / 90 + p.tw);
            jarState.ctx.save();
            jarState.ctx.globalAlpha = Math.max(0, fade);
            jarState.ctx.translate(p.x, p.y);
            if (p.img) {
                jarState.ctx.rotate(p.rot);
                var sw = p.size * twinkle,
                    sh = (sw * p.img.height) / p.img.width;
                jarState.ctx.drawImage(p.img, -sw / 2, -sh / 2, sw, sh);
            } else {
                jarState.ctx.fillStyle = '#fff';
                jarState.ctx.shadowColor = 'rgba(255,170,240,1)';
                jarState.ctx.shadowBlur = 10;
                jarState.ctx.beginPath();
                jarState.ctx.arc(0, 0, p.size * twinkle, 0, 6.2832);
                jarState.ctx.fill();
            }
            jarState.ctx.restore();
        }
    };
})(window.ICBJar);
