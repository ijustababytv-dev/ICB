// Stream Frame overlay: drawing helpers for the running light, sparkles, sun and stars
// (ES5 for Meld). Loaded before /js/client/stream-frame.js. All inputs are screen pixels.
window.ICBFrame = window.ICBFrame || {};

(function () {
    /**
     * Corner points of a frame with cut (chamfered) corners around a hole. `grow` pushes the
     * path outwards from the hole edge onto the neon tube; `cut` is the corner size.
     */
    window.ICBFrame.framePath = function (hole, grow, cut) {
        var x0 = hole.x0 - grow;
        var y0 = hole.y0 - grow;
        var x1 = hole.x1 + grow;
        var y1 = hole.y1 + grow;
        var c = Math.max(0, Math.min(cut, (x1 - x0) / 3, (y1 - y0) / 3));
        var pts = [
            [x0 + c, y0],
            [x1 - c, y0],
            [x1, y0 + c],
            [x1, y1 - c],
            [x1 - c, y1],
            [x0 + c, y1],
            [x0, y1 - c],
            [x0, y0 + c]
        ];
        var lens = [];
        var total = 0;
        for (var i = 0; i < pts.length; i++) {
            var a = pts[i];
            var b = pts[(i + 1) % pts.length];
            var len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
            lens.push(len);
            total += len;
        }
        return { pts: pts, lens: lens, total: total };
    };

    /** The point a fraction u (0..1, wraps) of the way round a frame path. */
    window.ICBFrame.pointAt = function (path, u) {
        var d = (((u % 1) + 1) % 1) * path.total;
        for (var i = 0; i < path.pts.length; i++) {
            if (d <= path.lens[i] || i === path.pts.length - 1) {
                var a = path.pts[i];
                var b = path.pts[(i + 1) % path.pts.length];
                var t = path.lens[i] ? Math.min(1, d / path.lens[i]) : 0;
                return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            }
            d -= path.lens[i];
        }
        return path.pts[0];
    };

    /**
     * Paint one running light's trail (bright head fading behind it) onto the light buffer as a
     * few thick line pieces, and return the box it covers. The buffer is later masked by the
     * neon tubes, so the light only shows on the real tubes and follows every bend, even where
     * the frame steps in and out. `reach` is how far either side of the path it can catch a tube.
     */
    window.ICBFrame.stampChaser = function (bctx, path, head, dir, length, reach, maxW, maxH) {
        var pieces = 24;
        var x0 = 1e9;
        var y0 = 1e9;
        var x1 = -1e9;
        var y1 = -1e9;
        var prev = window.ICBFrame.pointAt(path, head);
        bctx.lineWidth = reach * 2;
        bctx.lineCap = 'round';
        bctx.lineJoin = 'round';
        bctx.strokeStyle = '#ffffff';
        for (var i = 1; i <= pieces; i++) {
            var f = i / pieces;
            var p = window.ICBFrame.pointAt(path, head - dir * f * length);
            bctx.globalAlpha = Math.pow(1 - (i - 0.5) / pieces, 1.4);
            bctx.beginPath();
            bctx.moveTo(prev[0], prev[1]);
            bctx.lineTo(p[0], p[1]);
            bctx.stroke();
            x0 = Math.min(x0, p[0], prev[0]);
            y0 = Math.min(y0, p[1], prev[1]);
            x1 = Math.max(x1, p[0], prev[0]);
            y1 = Math.max(y1, p[1], prev[1]);
            prev = p;
        }
        bctx.globalAlpha = 1;
        // The box around everything just painted, kept on screen.
        x0 = Math.max(0, Math.floor(x0 - reach));
        y0 = Math.max(0, Math.floor(y0 - reach));
        x1 = Math.min(maxW, Math.ceil(x1 + reach));
        y1 = Math.min(maxH, Math.ceil(y1 + reach));
        if (x1 <= x0 || y1 <= y0) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };

    /** A soft coloured halo at the head of a running light (not masked, so it glows past the tube). */
    window.ICBFrame.drawHalo = function (ctx, x, y, radius, color, alpha) {
        var g = ctx.createRadialGradient(x, y, 0, x, y, radius);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };

    var sprites = {};

    /** Draw one four-point twinkle picture per colour, once, at 64px; sparkles reuse it. */
    function sparkleSprite(color) {
        if (sprites[color]) return sprites[color];
        var c = document.createElement('canvas');
        c.width = c.height = 64;
        var g = c.getContext('2d');
        var x = 32;
        var r = 31;
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(x, x - r);
        g.quadraticCurveTo(x, x, x + r, x);
        g.quadraticCurveTo(x, x, x, x + r);
        g.quadraticCurveTo(x, x, x - r, x);
        g.quadraticCurveTo(x, x, x, x - r);
        g.fill();
        var grad = g.createRadialGradient(x, x, 0, x, x, r * 0.7);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(1, 'rgba(255,200,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, x, r * 0.7, 0, Math.PI * 2);
        g.fill();
        sprites[color] = c;
        return c;
    }

    /** Draw a four-point twinkle at (x, y), radius r, see-through amount alpha. */
    window.ICBFrame.drawSparkle = function (ctx, x, y, r, alpha, color) {
        if (alpha <= 0.01 || r <= 0.5) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(sparkleSprite(color || '#fff3d6'), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    };

    /**
     * Sun shimmer: soft light bands drifting down across the sun disc (only above the horizon),
     * plus a gentle halo. `flare` (0..1) adds an extra burst of light, used for raids.
     */
    window.ICBFrame.drawSun = function (ctx, cx, cy, r, time, amount, flare) {
        var strength = amount / 100;
        if (strength <= 0 && flare <= 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * (1.6 + flare));
        halo.addColorStop(
            0,
            'rgba(255,170,90,' + (0.1 + 0.08 * Math.sin(time * 1.3)) * (strength + flare) + ')'
        );
        halo.addColorStop(1, 'rgba(255,80,160,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1.6 + flare), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.rect(cx - r, cy - r, r * 2, r * 1.09); // stop at the horizon
        ctx.clip();
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
        ctx.clip();
        var gap = r * 0.24;
        var offset = (time * r * 0.12) % gap;
        ctx.fillStyle = 'rgba(255,245,215,' + (0.32 * strength + 0.4 * flare) + ')';
        for (var y = cy - r - gap + offset; y < cy + r; y += gap)
            ctx.fillRect(cx - r, y, r * 2, gap * 0.28);
        ctx.restore();
    };
})();
