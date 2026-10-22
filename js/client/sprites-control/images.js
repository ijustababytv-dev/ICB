/** Sprite artwork preparation and uploads. Loaded before the page startup script. */
function prepPic(file) {
    return new Promise(function (ok, fail) {
        var img = new Image(),
            u = URL.createObjectURL(file);
        img.onload = function () {
            var c = document.createElement('canvas'),
                w = img.naturalWidth,
                h = img.naturalHeight;
            c.width = w;
            c.height = h;
            var x = c.getContext('2d');
            x.drawImage(img, 0, 0);
            var px = x.getImageData(0, 0, w, h).data,
                a = w,
                b = h,
                cc = -1,
                dd = -1;
            for (var yy = 0; yy < h; yy++)
                for (var xx = 0; xx < w; xx++)
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
            var cw = cc - a + 1,
                ch = dd - b + 1,
                sc = Math.min(1, 384 / Math.max(cw, ch)),
                o = document.createElement('canvas');
            o.width = Math.round(cw * sc);
            o.height = Math.round(ch * sc);
            o.getContext('2d').drawImage(c, a, b, cw, ch, 0, 0, o.width, o.height);
            URL.revokeObjectURL(u);
            ok(o.toDataURL('image/webp', 0.92));
        };

        img.onerror = function () {
            URL.revokeObjectURL(u);
            fail(new Error('That file is not a picture.'));
        };

        img.src = u;
    });
}

function uploadPic(id, file) {
    return prepPic(file)
        .then(function (d) {
            return api('/api/sprites/image', { id: id, dataUrl: d });
        })
        .then(function (r) {
            if (r.ok === false) alert(r.error);
            load();
        })
        .catch(function (e) {
            alert(e.message || 'Upload failed');
        });
}
