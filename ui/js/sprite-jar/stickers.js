/** ICBSpriteJarStickers keeps related operations together and reads shared state at call time. */
window.ICBSpriteJarStickers = function ICBSpriteJarStickers(context) {
    function makeStickers(need) {
        if (context.making || !need.length) return;
        context.making = true;
        var job = need[0],
            img = new Image();
        var done = function () {
            context.making = false;
        };

        img.onload = function () {
            try {
                var w = img.naturalWidth,
                    h = img.naturalHeight,
                    c = document.createElement('canvas');
                c.width = w;
                c.height = h;
                var x = c.getContext('2d');
                x.drawImage(img, 0, 0);
                var px = x.getImageData(0, 0, w, h).data,
                    a = w,
                    b = h,
                    cc = -1,
                    dd = -1;
                for (var yy = 0; yy < h; yy += 2)
                    for (var xx = 0; xx < w; xx += 2)
                        if (px[(yy * w + xx) * 4 + 3] > 8) {
                            if (xx < a) a = xx;
                            if (xx > cc) cc = xx;
                            if (yy < b) b = yy;
                            if (yy > dd) dd = yy;
                        }
                if (cc < 0) {
                    a = 0;
                    b = 0;
                    cc = w - 1;
                    dd = h - 1;
                }
                a = Math.max(0, a - 2);
                b = Math.max(0, b - 2);
                cc = Math.min(w - 1, cc + 2);
                dd = Math.min(h - 1, dd + 2);
                var cw = cc - a + 1,
                    ch = dd - b + 1,
                    sc = Math.min(1, 256 / Math.max(cw, ch)),
                    o = document.createElement('canvas');
                o.width = Math.round(cw * sc);
                o.height = Math.round(ch * sc);
                var ox = o.getContext('2d');
                ox.imageSmoothingQuality = 'high';
                ox.drawImage(c, a, b, cw, ch, 0, 0, o.width, o.height);
                var r = new XMLHttpRequest();
                r.open('POST', '/api/sprites/jar/sticker', true);
                r.setRequestHeader('Content-Type', 'application/json');
                r.onreadystatechange = function () {
                    if (r.readyState === 4) done();
                };

                r.send(
                    JSON.stringify({
                        id: job.id,
                        variant: job.variant,
                        dataUrl: o.toDataURL('image/webp', 0.9)
                    })
                );
            } catch (e) {
                done();
            }
        };

        img.onerror = done;
        img.src = job.src;
    }

    return { makeStickers: makeStickers };
};
