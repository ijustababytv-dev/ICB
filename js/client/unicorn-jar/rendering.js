// Rendering for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
    // -------------------------------------------------------------- rendering
    jarState.roundRect = function roundRect(x, y, w, h, r) {
        jarState.ctx.beginPath();
        jarState.ctx.moveTo(x + r, y);
        jarState.ctx.lineTo(x + w - r, y);
        jarState.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        jarState.ctx.lineTo(x + w, y + h - r);
        jarState.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        jarState.ctx.lineTo(x + r, y + h);
        jarState.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        jarState.ctx.lineTo(x, y + r);
        jarState.ctx.quadraticCurveTo(x, y, x + r, y);
        jarState.ctx.closePath();
    };

    jarState.jarTransform = function jarTransform() {
        jarState.ctx.translate(jarState.J.pivot.x, jarState.J.pivot.y);
        jarState.ctx.rotate(jarState.J.angle);
        jarState.ctx.translate(-jarState.J.pivot.x, -jarState.J.pivot.y);
    };

    jarState.drawJarImage = function drawJarImage(img, alpha) {
        if (!img.complete || !img.naturalWidth) return;
        jarState.ctx.save();
        jarState.jarTransform();
        jarState.ctx.globalAlpha = alpha;
        jarState.ctx.drawImage(
            img,
            jarState.J.ox,
            jarState.J.oy,
            jarState.JAR_IMG_W * jarState.J.s,
            jarState.JAR_IMG_H * jarState.J.s
        );
        jarState.ctx.restore();
    };

    jarState.drawJarBack = function drawJarBack() {
        jarState.drawJarImage(jarState.JAR_BACK, 1);
    };

    jarState.drawJarFront = function drawJarFront() {
        if (jarState.frontUsable) {
            if (jarState.FRONT_SHEEN_ALPHA > 0)
                jarState.drawJarImage(jarState.JAR_BACK, jarState.FRONT_SHEEN_ALPHA);
            jarState.drawJarImage(jarState.JAR_FRONT, 1);
        } else jarState.drawJarImage(jarState.JAR_BACK, jarState.FRONT_FALLBACK_ALPHA);
        jarState.ctx.save();
        jarState.jarTransform();
        // count tag, on the front of the glass
        var label = String(jarState.totalEntries);
        var fs = Math.max(20, Math.min(40, jarState.J.w * 0.1));
        jarState.ctx.font = '900 ' + fs + 'px ' + jarState.FONT;
        var iconW = fs * 1.3,
            tw = jarState.ctx.measureText(label).width;
        var tagW = tw + iconW + fs * 1.1,
            tagH = fs * 1.55;
        var tx = jarState.J.cx - tagW / 2,
            ty = jarState.J.oy + 820 * jarState.J.s;
        jarState.roundRect(tx, ty, tagW, tagH, tagH / 2);
        jarState.ctx.fillStyle = 'rgba(120,20,120,0.72)';
        jarState.ctx.fill();
        jarState.ctx.lineWidth = 2;
        jarState.ctx.strokeStyle = 'rgba(255,215,248,0.9)';
        jarState.ctx.stroke();
        if (jarState.UNI.complete)
            jarState.ctx.drawImage(
                jarState.UNI,
                tx + fs * 0.4,
                ty + (tagH - iconW * jarState.UNI_ASPECT) / 2,
                iconW,
                iconW * jarState.UNI_ASPECT
            );
        jarState.ctx.fillStyle = '#fff2fd';
        jarState.ctx.textBaseline = 'middle';
        jarState.ctx.textAlign = 'left';
        jarState.ctx.shadowColor = 'rgba(255,120,230,0.9)';
        jarState.ctx.shadowBlur = 8;
        jarState.ctx.fillText(label, tx + fs * 0.4 + iconW + fs * 0.25, ty + tagH / 2 + 1);
        jarState.ctx.restore();
    };

    // Split a name into up to two lines that each fit maxW. Prefers breaking
    // at "_" or where lowercase meets uppercase/digit (haley_|please_hush,
    // Sammie|Sparkle, kjdragon|2018); otherwise splits wherever it fits.
    jarState.wrapName = function wrapName(g, name, maxW) {
        if (g.measureText(name).width <= maxW) return [name];
        var best = null,
            bestScore = Infinity;
        for (var i = 1; i < name.length; i++) {
            var a = name.slice(0, i),
                b = name.slice(i);
            var natural =
                name.charAt(i - 1) === '_' ||
                name.charAt(i) === '_' ||
                (/[a-z]/.test(name.charAt(i - 1)) && /[A-Z0-9]/.test(name.charAt(i)));
            var wa = g.measureText(a).width,
                wb = g.measureText(b).width;
            if (wa > maxW) break;
            var score = Math.max(wa, wb) - (natural ? maxW * 0.35 : 0);
            if (wb <= maxW && score < bestScore) {
                bestScore = score;
                best = [a, b];
            }
        }
        return best;
    };

    jarState.nameLabel = function nameLabel(name) {
        if (jarState.labelCache[name]) return jarState.labelCache[name];
        var maxW = jarState.R * 2.5,
            px = Math.max(10, Math.round(jarState.R * 0.6)),
            minPx = Math.max(8, Math.round(jarState.R * 0.46));
        var c = document.createElement('canvas'),
            g = c.getContext('2d');
        var lines = null;
        // Shrink a little if needed; take the first size where it fits on 1-2 lines.
        for (; px >= minPx; px--) {
            g.font = '800 ' + px + 'px ' + jarState.FONT;
            lines = jarState.wrapName(g, name, maxW);
            if (lines) break;
        }
        if (!lines) {
            // Very long names: two full lines, the second ends with "...".
            px = minPx;
            g.font = '800 ' + px + 'px ' + jarState.FONT;
            var first = name;
            while (first.length > 1 && g.measureText(first).width > maxW)
                first = first.slice(0, -1);
            var rest = name.slice(first.length);
            while (rest.length > 1 && g.measureText(rest + '…').width > maxW)
                rest = rest.slice(0, -1);
            lines = [first, rest + '…'];
        }
        var pad = 4,
            lineH = Math.round(px * 1.05),
            tw = 0;
        for (var k = 0; k < lines.length; k++)
            tw = Math.max(tw, Math.ceil(g.measureText(lines[k]).width));
        c.width = tw + pad * 2;
        c.height = lineH * lines.length + pad * 2 + 2;
        g.font = '800 ' + px + 'px ' + jarState.FONT;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = Math.max(2.5, px * 0.28);
        for (var n = 0; n < lines.length; n++) {
            var y = pad + 1 + lineH * n + lineH / 2;
            g.strokeStyle = 'rgba(70,0,80,0.95)';
            g.strokeText(lines[n], c.width / 2, y);
            g.fillStyle = '#ffffff';
            g.fillText(lines[n], c.width / 2, y);
        }
        jarState.labelCache[name] = c;
        return c;
    };

    jarState.drawAccent = function drawAccent(b) {
        var img = b.accentImg;
        if (!img) return;
        var s = b.renderScale || 1,
            w = jarState.R * (img === jarState.FX.rainbow ? 2.4 : 1.0) * s,
            h = (w * img.height) / img.width;
        jarState.ctx.save();
        jarState.ctx.translate(b.position.x, b.position.y);
        jarState.ctx.rotate(b.angle);
        jarState.ctx.drawImage(img, -w / 2, -h / 2, w, h);
        jarState.ctx.restore();
    };

    jarState.drawUnicorn = function drawUnicorn(b, glow) {
        var s = b.renderScale || 1,
            w = jarState.R * 2.4 * s,
            h = w * jarState.UNI_ASPECT;
        jarState.ctx.save();
        jarState.ctx.translate(b.position.x, b.position.y);
        jarState.ctx.rotate(glow ? Math.sin(Date.now() / 400) * 0.15 : b.angle);
        if (glow) {
            jarState.ctx.shadowColor = 'rgba(255,120,230,1)';
            jarState.ctx.shadowBlur = 45;
        }
        jarState.ctx.drawImage(jarState.UNI, -w / 2, -h / 2, w, h);
        jarState.ctx.restore();
        if (jarState.showNames && b.owner) {
            var lab = jarState.nameLabel(b.owner);
            var lw = lab.width * s,
                lh = lab.height * s;
            jarState.ctx.drawImage(
                lab,
                b.position.x - lw / 2,
                b.position.y + jarState.R * 0.15 * s - lh / 2,
                lw,
                lh
            );
        }
    };

    jarState.drawCountdown = function drawCountdown(now) {
        if (jarState.phase !== 'countdown') return;
        var t = now - jarState.phaseStart,
            left = Math.max(1, Math.ceil((jarState.COUNTDOWN_MS - t) / 1000));
        var frac = 1 - (((jarState.COUNTDOWN_MS - t) / 1000) % 1); // 0 at each new number -> 1
        var scale = 1.35 - 0.35 * Math.min(1, frac * 3);
        jarState.ctx.save();
        jarState.ctx.translate(jarState.W / 2, jarState.H * 0.42);
        jarState.ctx.textAlign = 'center';
        jarState.ctx.textBaseline = 'middle';
        jarState.ctx.globalAlpha = 0.95;
        jarState.ctx.font = '800 38px ' + jarState.FONT;
        jarState.ctx.fillStyle = '#ffe3fb';
        jarState.ctx.shadowColor = 'rgba(120,0,120,0.9)';
        jarState.ctx.shadowBlur = 12;
        jarState.ctx.fillText('WINNER IN', 0, -150);
        jarState.ctx.scale(scale, scale);
        jarState.ctx.font = '900 230px ' + jarState.FONT;
        jarState.ctx.lineJoin = 'round';
        jarState.ctx.lineWidth = 16;
        jarState.ctx.strokeStyle = 'rgba(110,0,120,0.95)';
        jarState.ctx.shadowColor = left <= 3 ? 'rgba(255,215,110,1)' : 'rgba(255,110,220,1)';
        jarState.ctx.shadowBlur = 40;
        jarState.ctx.strokeText(String(left), 0, 10);
        jarState.ctx.fillStyle = left <= 3 ? '#fff4c9' : '#ffffff';
        jarState.ctx.fillText(String(left), 0, 10);
        jarState.ctx.restore();
    };

    jarState.drawBanner = function drawBanner(now) {
        if (!jarState.current || !jarState.current.bannerAt || now < jarState.current.bannerAt)
            return;
        if (jarState.phase !== 'rise') return;
        var age = now - jarState.current.bannerAt;
        var alpha = Math.min(1, age / 300);
        // Baby (2026-09-26): a custom prize name (set on the dashboard) overrides
        // the generic "Plushie"/"Mystery Outfit" wording, e.g. "Squishmallow Corgi".
        var prize =
            jarState.current.prizeLabel ||
            (jarState.current.prize === 'mystery-outfit' ? 'Mystery Outfit' : 'Plushie');
        var name = jarState.current.username;
        var cy = jarState.H * 0.3 + (jarState.winnerBody ? jarState.R * 4.2 * 1.3 : 0) + 40;
        jarState.ctx.save();
        jarState.ctx.globalAlpha = alpha;
        jarState.ctx.textAlign = 'center';
        jarState.ctx.textBaseline = 'middle';
        var nameSize = 78;
        jarState.ctx.font = '900 ' + nameSize + 'px ' + jarState.FONT;
        while (jarState.ctx.measureText(name).width > jarState.W * 0.7 && nameSize > 30) {
            nameSize -= 4;
            jarState.ctx.font = '900 ' + nameSize + 'px ' + jarState.FONT;
        }
        var boxW = Math.max(jarState.ctx.measureText(name).width + 120, 560),
            boxH = nameSize + 130;
        jarState.roundRect(jarState.W / 2 - boxW / 2, cy - 45, boxW, boxH, 36);
        var bg = jarState.ctx.createLinearGradient(0, cy - 45, 0, cy - 45 + boxH);
        bg.addColorStop(0, 'rgba(150,30,150,0.9)');
        bg.addColorStop(1, 'rgba(90,20,140,0.9)');
        jarState.ctx.fillStyle = bg;
        jarState.ctx.fill();
        jarState.ctx.lineWidth = 4;
        jarState.ctx.strokeStyle = 'rgba(255,215,130,0.95)';
        jarState.ctx.shadowColor = 'rgba(255,200,110,0.9)';
        jarState.ctx.shadowBlur = 25;
        jarState.ctx.stroke();
        jarState.ctx.shadowBlur = 0;
        jarState.ctx.font = '800 30px ' + jarState.FONT;
        jarState.ctx.fillStyle = '#ffe9c9';
        jarState.ctx.fillText('WINNER!', jarState.W / 2, cy - 8);
        if (jarState.current.isTest) {
            // Baby (2026-09-27): the demo/test draw looks the same as a real one,
            // but a small tag makes it obvious to anyone watching that this run
            // didn't pick a real player and isn't going in the Winners Circle.
            jarState.ctx.save();
            jarState.ctx.font = '700 20px ' + jarState.FONT;
            jarState.ctx.fillStyle = '#fff2a8';
            jarState.ctx.shadowColor = 'rgba(0,0,0,0.6)';
            jarState.ctx.shadowBlur = 6;
            jarState.ctx.fillText('TEST DRAW - just a demo', jarState.W / 2, cy - 45 - 34);
            jarState.ctx.restore();
        }
        jarState.ctx.font = '900 ' + nameSize + 'px ' + jarState.FONT;
        jarState.ctx.fillStyle = '#ffffff';
        jarState.ctx.shadowColor = 'rgba(255,120,230,1)';
        jarState.ctx.shadowBlur = 20;
        jarState.ctx.fillText(name, jarState.W / 2, cy + 18 + nameSize / 2);
        jarState.ctx.shadowBlur = 0;
        jarState.ctx.font = '800 30px ' + jarState.FONT;
        jarState.ctx.fillStyle = '#ffe3fb';
        jarState.ctx.fillText('wins the ' + prize + '!', jarState.W / 2, cy + nameSize + 55);
        jarState.ctx.restore();
    };

    jarState.drawConfetti = function drawConfetti() {
        for (var i = jarState.confetti.length - 1; i >= 0; i--) {
            var c = jarState.confetti[i];
            c.vy += 0.25;
            c.vx *= 0.99;
            c.x += c.vx;
            c.y += c.vy;
            c.rot += c.vr;
            c.life -= 0.006;
            if (c.life <= 0 || c.y > jarState.H + 20) {
                jarState.confetti.splice(i, 1);
                continue;
            }
            jarState.ctx.save();
            jarState.ctx.globalAlpha = Math.min(1, c.life * 2);
            jarState.ctx.translate(c.x, c.y);
            jarState.ctx.rotate(c.rot);
            jarState.ctx.fillStyle = c.color;
            jarState.ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
            jarState.ctx.restore();
        }
    };

    jarState.render = function render(now) {
        jarState.ctx.clearRect(0, 0, jarState.W, jarState.H);
        if (!jarState.settings) return;
        jarState.drawJarBack();
        for (var i = 0; i < jarState.bodies.length; i++) {
            if (jarState.bodies[i] === jarState.winnerBody) continue;
            if (jarState.bodies[i].isAccent) jarState.drawAccent(jarState.bodies[i]);
            else jarState.drawUnicorn(jarState.bodies[i], false);
        }
        jarState.drawJarFront();
        jarState.drawSparks(now);
        if (jarState.winnerBody) jarState.drawUnicorn(jarState.winnerBody, true);
        jarState.drawCloud();
        jarState.drawCountdown(now);
        jarState.drawBanner(now);
        jarState.drawConfetti();
    };
})(window.ICBJar);
