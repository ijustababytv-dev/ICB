/** ICBTradeupRendering keeps related operations together and reads shared state at call time. */
window.ICBTradeupRendering = function ICBTradeupRendering(context) {
    function roundRect(x, y, w, h, r) {
        context.ctx.beginPath();
        context.ctx.moveTo(x + r, y);
        context.ctx.lineTo(x + w - r, y);
        context.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        context.ctx.lineTo(x + w, y + h - r);
        context.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        context.ctx.lineTo(x + r, y + h);
        context.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        context.ctx.lineTo(x, y + r);
        context.ctx.quadraticCurveTo(x, y, x + r, y);
        context.ctx.closePath();
    }

    function jarTransform() {
        context.ctx.translate(context.J.pivot.x, context.J.pivot.y);
        context.ctx.rotate(context.J.angle);
        context.ctx.translate(-context.J.pivot.x, -context.J.pivot.y);
    }

    function drawJarImage(img, alpha) {
        if (!img.complete || !img.naturalWidth) return;
        context.ctx.save();
        jarTransform();
        context.ctx.globalAlpha = alpha;
        context.ctx.drawImage(
            img,
            context.J.ox,
            context.J.oy,
            context.JAR_IMG_W * context.J.s,
            context.JAR_IMG_H * context.J.s
        );
        context.ctx.restore();
    }

    function drawJarBack() {
        drawJarImage(context.JAR_BACK, 1);
    }

    function drawJarFront() {
        if (context.frontUsable) {
            if (context.FRONT_SHEEN_ALPHA > 0)
                drawJarImage(context.JAR_BACK, context.FRONT_SHEEN_ALPHA);
            drawJarImage(context.JAR_FRONT, 1);
        } else drawJarImage(context.JAR_BACK, context.FRONT_FALLBACK_ALPHA);
    }

    function drawItem(b, glow) {
        var box = b.box,
            item = box && box.item;
        var s = b.renderScale || 1,
            d = context.R * 2 * s * 1.5;
        context.ctx.save();
        context.ctx.translate(b.position.x, b.position.y);
        context.ctx.rotate(glow ? Math.sin(Date.now() / 400) * 0.1 : b.angle);
        if (glow) {
            context.ctx.shadowColor = 'rgba(255,215,110,1)';
            context.ctx.shadowBlur = 45;
        }
        var img = item ? context.getImg(item.image) : null;
        if (img && img.complete && img.naturalWidth) {
            // object-fit: contain - the real photo, full shape, not cropped.
            var scale = Math.min(d / img.naturalWidth, d / img.naturalHeight);
            var iw = img.naturalWidth * scale,
                ih = img.naturalHeight * scale;
            context.ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
        } else {
            // No art yet for this one - a plain soft square, still no text on it.
            var rr = d * 0.18;
            context.ctx.beginPath();
            context.ctx.moveTo(-d / 2 + rr, -d / 2);
            context.ctx.arcTo(d / 2, -d / 2, d / 2, d / 2, rr);
            context.ctx.arcTo(d / 2, d / 2, -d / 2, d / 2, rr);
            context.ctx.arcTo(-d / 2, d / 2, -d / 2, -d / 2, rr);
            context.ctx.arcTo(-d / 2, -d / 2, d / 2, -d / 2, rr);
            context.ctx.closePath();
            context.ctx.fillStyle = 'rgba(90,60,140,0.9)';
            context.ctx.fill();
        }
        context.ctx.restore();
    }

    function drawBanner(now) {
        if (!context.winnerBanner || !context.winnerBody) return;
        var age = now - context.phaseStart;
        if (context.phase !== 'reveal') return;
        var alpha = Math.min(1, (now - context.winnerBanner.bannerAt) / 300);
        if (alpha <= 0) return;
        var item = context.winnerBanner.item;
        var name = item ? item.name : 'Empty box';
        var sub = item && item.type === 'points' ? item.points + ' Channel Points' : '';
        var cy = context.H * 0.32 + context.R * 1.6 + 60;
        context.ctx.save();
        context.ctx.globalAlpha = alpha;
        context.ctx.textAlign = 'center';
        context.ctx.textBaseline = 'middle';
        var nameSize = 60;
        context.ctx.font = '900 ' + nameSize + 'px ' + context.FONT;
        while (context.ctx.measureText(name).width > context.W * 0.6 && nameSize > 28) {
            nameSize -= 4;
            context.ctx.font = '900 ' + nameSize + 'px ' + context.FONT;
        }
        var boxW = Math.max(context.ctx.measureText(name).width + 100, 480),
            boxH = nameSize + (sub ? 110 : 80);
        roundRect(context.W / 2 - boxW / 2, cy - 30, boxW, boxH, 30);
        var bg = context.ctx.createLinearGradient(0, cy - 30, 0, cy - 30 + boxH);
        bg.addColorStop(0, 'rgba(150,30,150,0.9)');
        bg.addColorStop(1, 'rgba(90,20,140,0.9)');
        context.ctx.fillStyle = bg;
        context.ctx.fill();
        context.ctx.lineWidth = 4;
        context.ctx.strokeStyle = 'rgba(255,215,130,0.95)';
        context.ctx.shadowColor = 'rgba(255,200,110,0.9)';
        context.ctx.shadowBlur = 25;
        context.ctx.stroke();
        context.ctx.shadowBlur = 0;
        context.ctx.font = '800 26px ' + context.FONT;
        context.ctx.fillStyle = '#ffe9c9';
        context.ctx.fillText('THE PICK IS...', context.W / 2, cy);
        context.ctx.font = '900 ' + nameSize + 'px ' + context.FONT;
        context.ctx.fillStyle = '#ffffff';
        context.ctx.shadowColor = 'rgba(255,120,230,1)';
        context.ctx.shadowBlur = 20;
        context.ctx.fillText(name, context.W / 2, cy + 20 + nameSize / 2);
        context.ctx.shadowBlur = 0;
        if (sub) {
            context.ctx.font = '800 24px ' + context.FONT;
            context.ctx.fillStyle = '#ffe3fb';
            context.ctx.fillText(sub, context.W / 2, cy + nameSize + 55);
        }
        context.ctx.restore();
    }

    function render(now) {
        context.ctx.clearRect(0, 0, context.W, context.H);
        if (!context.engine) return;
        drawJarBack();
        for (var i = 0; i < context.bodies.length; i++)
            if (context.bodies[i] && context.bodies[i] !== context.winnerBody)
                drawItem(context.bodies[i], false);
        drawJarFront();
        if (context.winnerBody) drawItem(context.winnerBody, true);
        drawBanner(now);
    }

    return {
        roundRect: roundRect,
        jarTransform: jarTransform,
        drawJarImage: drawJarImage,
        drawJarBack: drawJarBack,
        drawJarFront: drawJarFront,
        drawItem: drawItem,
        drawBanner: drawBanner,
        render: render
    };
};
