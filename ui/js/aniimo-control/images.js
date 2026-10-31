/** Aniimo pictures, image preparation, and form-photo controls. Loaded before the page startup script. */
function thumb(a, cls) {
    return (
        '<div class="th ' +
        cls +
        '" style="' +
        (a.img ? '' : 'background:' + elColor(a.element)) +
        '">' +
        (a.img ? '<img src="' + esc(a.img) + '" alt="">' : esc((a.name || '?').charAt(0))) +
        '</div>'
    );
}

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
                minX = w,
                minY = h,
                maxX = -1,
                maxY = -1;
            for (var yy = 0; yy < h; yy++)
                for (var xx = 0; xx < w; xx++)
                    if (px[(yy * w + xx) * 4 + 3] > 8) {
                        if (xx < minX) minX = xx;
                        if (xx > maxX) maxX = xx;
                        if (yy < minY) minY = yy;
                        if (yy > maxY) maxY = yy;
                    }
            if (maxX < 0) {
                minX = 0;
                minY = 0;
                maxX = w - 1;
                maxY = h - 1;
            }
            var cw = maxX - minX + 1,
                ch = maxY - minY + 1,
                sc = Math.min(1, 512 / Math.max(cw, ch));
            var o = document.createElement('canvas');
            o.width = Math.round(cw * sc);
            o.height = Math.round(ch * sc);
            var ox = o.getContext('2d');
            ox.imageSmoothingQuality = 'high';
            ox.drawImage(c, minX, minY, cw, ch, 0, 0, o.width, o.height);
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
        .then(function (dataUrl) {
            return api('/api/aniimo/image', { id: id, dataUrl: dataUrl });
        })
        .then(function (r) {
            if (r.ok === false) alert(r.error);
            return load().then(function () {
                if (editing === id) showPic();
            });
        })
        .catch(function (e) {
            alert(e.message || 'Upload failed');
        });
}

function showPic() {
    var a = A(editing);
    $('mPic').outerHTML = a
        ? thumb(a, 'big').replace('class="th big"', 'id="mPic" class="th big"')
        : '<div id="mPic" class="th big">?</div>';
    $('mRemove').style.display = a && a.img ? '' : 'none';
}

function removePic() {
    if (editing && confirm('Remove this picture?'))
        api('/api/aniimo/image', { id: editing, remove: true }).then(load).then(showPic);
}

function uploadForm(id, v, file, tick) {
    return prepPic(file)
        .then(function (dataUrl) {
            return api('/api/aniimo/image', { id: id, variant: v, dataUrl: dataUrl, tick: !!tick });
        })
        .then(function (r) {
            if (r.ok === false) alert(r.error);
            return load().then(function () {
                if (formEd && formEd.id === id && formEd.v === v) drawForm();
            });
        })
        .catch(function (e) {
            alert(e.message || 'Upload failed');
        });
}

function openForm(id, v) {
    formEd = { id: id, v: v };
    drawForm();
    $('fmodal').className = 'modal on';
}

function closeForm() {
    $('fmodal').className = 'modal';
    formEd = null;
}

function drawForm() {
    var a = A(formEd.id),
        u = (a.formImgs || {})[formEd.v];
    $('fTitle').textContent = a.name + ' — ' + formEd.v;
    $('fBig').innerHTML = u ? '<img src="' + esc(u) + '" alt="">' : '📷';
    $('fRemove').style.display = u ? '' : 'none';
    $('fMain').style.display = u ? '' : 'none';
    $('fState').textContent = S.checked[key(a, formEd.v)] ? '✅ Ticked' : 'Not ticked yet';
}

function removeForm() {
    if (confirm('Remove this photo?'))
        api('/api/aniimo/image', { id: formEd.id, variant: formEd.v, remove: true })
            .then(load)
            .then(drawForm);
}

function formAsMain() {
    var a = A(formEd.id),
        u = (a.formImgs || {})[formEd.v];
    if (!u) return;
    fetch(u)
        .then(function (r) {
            return r.blob();
        })
        .then(function (b) {
            return uploadPic(formEd.id, b);
        })
        .then(function () {
            alert('Now the main picture for ' + a.name + '.');
        });
}
