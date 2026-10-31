// Stream Frame overlay: reads the overlay picture once and works out where things are
// (ES5 for Meld). Loaded before /js/client/stream-frame.js.
//   - neon tubes  -> a soft glow picture and a dark "unlit" picture for flicker / power-on
//   - camera and game holes (the see-through areas) -> where the running light goes
//   - small white sky stars near the top -> which points twinkle
// Everything is in picture pixels; the main script scales it to the screen.
window.ICBFrame = window.ICBFrame || {};

(function () {
    var GRID = 4; // hole search works on a 4px grid so it stays fast on big pictures

    /** True for the bright orange/yellow and hot pink pixels that make up the neon tubes. */
    function isNeon(r, g, b) {
        return (r > 240 && g > 150 && b < 180) || (r > 230 && b > 200 && g < 140);
    }

    /** Make a blank canvas of the given size. */
    function makeCanvas(w, h) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        return c;
    }

    /**
     * Build the neon pictures. `glow` is the tubes shrunk to 1/6 size so that stretching it back
     * up blurs it into a soft halo (much cheaper than a blur filter every frame). `crisp` is the
     * tubes at full size for a brightness boost, and `unlit` paints the tubes dark purple so the
     * frame can look switched off.
     */
    function buildNeon(data, w, h) {
        var crisp = makeCanvas(w, h);
        var unlit = makeCanvas(w, h);
        var cctx = crisp.getContext('2d');
        var uctx = unlit.getContext('2d');
        var lit = cctx.createImageData(w, h);
        var dark = uctx.createImageData(w, h);
        var count = 0;
        for (var i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 200 && isNeon(data[i], data[i + 1], data[i + 2])) {
                lit.data[i] = data[i];
                lit.data[i + 1] = data[i + 1];
                lit.data[i + 2] = data[i + 2];
                lit.data[i + 3] = 255;
                dark.data[i] = 26;
                dark.data[i + 1] = 6;
                dark.data[i + 2] = 40;
                dark.data[i + 3] = 235;
                count++;
            }
        }
        cctx.putImageData(lit, 0, 0);
        uctx.putImageData(dark, 0, 0);
        var mid = makeCanvas(w / 3, h / 3);
        mid.getContext('2d').drawImage(crisp, 0, 0, mid.width, mid.height);
        var glow = makeCanvas(w / 6, h / 6);
        glow.getContext('2d').drawImage(mid, 0, 0, glow.width, glow.height);
        return { crisp: crisp, unlit: unlit, glow: glow, neonPixels: count };
    }

    /** Flood-fill one region of a true/false grid and return its size and bounding box. */
    function floodRegion(grid, gw, gh, start, seen) {
        var stack = [start];
        var box = { cells: 0, x0: gw, y0: gh, x1: 0, y1: 0 };
        seen[start] = 1;
        while (stack.length) {
            var k = stack.pop();
            var x = k % gw;
            var y = (k - x) / gw;
            box.cells++;
            if (x < box.x0) box.x0 = x;
            if (x > box.x1) box.x1 = x;
            if (y < box.y0) box.y0 = y;
            if (y > box.y1) box.y1 = y;
            var next = [k - 1, k + 1, k - gw, k + gw];
            for (var j = 0; j < 4; j++) {
                var n = next[j];
                if (n < 0 || n >= gw * gh || seen[n] || !grid[n]) continue;
                if ((j === 0 && x === 0) || (j === 1 && x === gw - 1)) continue;
                seen[n] = 1;
                stack.push(n);
            }
        }
        return box;
    }

    /**
     * Find the camera/game holes: see-through regions that are big (over 2% of the picture)
     * and do not touch the picture edge. Returns up to four, left to right, in picture pixels.
     */
    function findHoles(data, w, h) {
        var gw = Math.floor(w / GRID);
        var gh = Math.floor(h / GRID);
        var grid = new Uint8Array(gw * gh);
        var seen = new Uint8Array(gw * gh);
        var x, y;
        for (y = 0; y < gh; y++)
            for (x = 0; x < gw; x++)
                grid[y * gw + x] = data[(y * GRID * w + x * GRID) * 4 + 3] < 20 ? 1 : 0;
        var holes = [];
        for (var k = 0; k < gw * gh; k++) {
            if (!grid[k] || seen[k]) continue;
            var box = floodRegion(grid, gw, gh, k, seen);
            var touchesEdge =
                box.x0 === 0 || box.y0 === 0 || box.x1 === gw - 1 || box.y1 === gh - 1;
            if (box.cells > gw * gh * 0.02 && !touchesEdge)
                holes.push({
                    x0: box.x0 * GRID,
                    y0: box.y0 * GRID,
                    x1: (box.x1 + 1) * GRID,
                    y1: (box.y1 + 1) * GRID,
                    cells: box.cells
                });
        }
        holes.sort(function (a, b) {
            return b.cells - a.cells;
        });
        holes = holes.slice(0, 4);
        holes.sort(function (a, b) {
            return a.x0 - b.x0;
        });
        return { holes: holes, grid: grid, gw: gw, gh: gh };
    }

    /** Find small white dots in the top 9% of the picture (the sky stars) to twinkle. */
    function findStars(data, w, h) {
        var top = Math.floor(h * 0.09);
        var grid = new Uint8Array(w * top);
        var seen = new Uint8Array(w * top);
        var i;
        for (i = 0; i < w * top; i++) {
            var p = i * 4;
            grid[i] = data[p] > 200 && data[p + 1] > 200 && data[p + 2] > 200 ? 1 : 0;
        }
        var stars = [];
        for (i = 0; i < w * top; i++) {
            if (!grid[i] || seen[i]) continue;
            var box = floodRegion(grid, w, top, i, seen);
            if (box.cells >= 2 && box.cells <= 300)
                stars.push({
                    x: (box.x0 + box.x1 + 1) / 2,
                    y: (box.y0 + box.y1 + 1) / 2,
                    size: Math.max(3, Math.sqrt(box.cells) * 1.6),
                    phase: Math.random() * Math.PI * 2,
                    speed: 0.6 + Math.random() * 1.6
                });
        }
        return stars;
    }

    /** Analyse a loaded overlay picture. Returns null if the picture cannot be read. */
    window.ICBFrame.analyzeArt = function (img) {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (!w || !h) return null;
        var c = makeCanvas(w, h);
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var data;
        try {
            data = ctx.getImageData(0, 0, w, h).data;
        } catch (e) {
            return null; // picture from another site: no analysis, effects that need it stay off
        }
        var neon = buildNeon(data, w, h);
        var holeInfo = findHoles(data, w, h);
        return {
            w: w,
            h: h,
            glow: neon.glow,
            crisp: neon.crisp,
            unlit: neon.unlit,
            neonPixels: neon.neonPixels,
            holes: holeInfo.holes,
            solid: holeInfo,
            stars: findStars(data, w, h)
        };
    };

    /** True if picture point (x, y) is solid art (not a hole and not see-through). */
    window.ICBFrame.isSolid = function (maps, x, y) {
        var gx = Math.floor(x / GRID);
        var gy = Math.floor(y / GRID);
        var s = maps.solid;
        if (gx < 0 || gy < 0 || gx >= s.gw || gy >= s.gh) return false;
        return !s.grid[gy * s.gw + gx];
    };
})();
