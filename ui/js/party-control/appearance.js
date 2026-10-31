/** Party artwork and appearance controls. Loaded before the page startup script. */
function artOptions(sel) {
    var o = '<option value="">(none)</option>';
    (A.art || []).forEach(function (f) {
        o += '<option' + (f === sel ? ' selected' : '') + '>' + esc(f) + '</option>';
    });
    return o;
}

function showThumb(sel, img) {
    var f = $(sel).value,
        im = $(img);
    if (f) {
        im.src = '/assets/party/' + encodeURIComponent(f);
        im.style.display = 'block';
    } else im.style.display = 'none';
}

function fillLook(e) {
    var a = e.art || {};
    $('bgImage').innerHTML = artOptions(a.bgFile);
    $('titleImage').innerHTML = artOptions(a.titleFile);
    $('bgFit').value = a.fit || 'cover';
    $('panel').value = a.panel === undefined ? 86 : a.panel;
    $('roleCards').value = a.roleCards === undefined ? 40 : a.roleCards;
    $('border').checked = a.border !== false;
    slid();
    showThumb('bgImage', 'bgThumb');
    showThumb('titleImage', 'titleThumb');
}

function slid() {
    $('panelV').textContent = $('panel').value + '%';
    $('roleCardsV').textContent = $('roleCards').value + '%';
}

function lookBody() {
    return {
        id: cur,
        bgImage: $('bgImage').value || null,
        titleImage: $('titleImage').value || null,
        bgFit: $('bgFit').value,
        panel: Number($('panel').value),
        roleCards: Number($('roleCards').value),
        border: $('border').checked
    };
}

function saveLook(all) {
    var b = lookBody();
    if (all) {
        if (!confirm('Use this background, banner and darkness on every party?')) return;
        b.artToAll = true;
    }
    act('/api/party/event', b, all ? 'Look copied to all parties 🎨' : 'Look saved 🎨');
}

function slideSave() {
    slid();
    clearTimeout(slideT);
    slideT = setTimeout(function () {
        api('/api/party/event', lookBody()).catch(function () {});
    }, 350);
}

function uploadArt(input, target) {
    var f = input.files && input.files[0];
    if (!f) return;
    var send = function (dataUrl) {
        toast('Uploading…');
        api('/api/party/image', { dataUrl: dataUrl, name: f.name })
            .then(function (d) {
                A.art = (A.art || []).concat([d.file]).sort();
                var keepBg = $('bgImage').value,
                    keepT = $('titleImage').value;
                $('bgImage').innerHTML = artOptions(target === 'bgImage' ? d.file : keepBg);
                $('titleImage').innerHTML = artOptions(target === 'titleImage' ? d.file : keepT);
                showThumb('bgImage', 'bgThumb');
                showThumb('titleImage', 'titleThumb');
                saveLook();
                input.value = '';
            })
            .catch(function (e) {
                toast('⚠️ ' + e.message);
            });
    };

    var r = new FileReader();
    r.onload = function () {
        if (f.size <= 8 * 1024 * 1024) return send(r.result);
        var im = new Image();
        im.onload = function () {
            var w = Math.min(2560, im.width),
                h = Math.round((im.height * w) / im.width),
                c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(im, 0, 0, w, h);
            send(
                c.toDataURL('image/png').length < 11e6
                    ? c.toDataURL('image/png')
                    : c.toDataURL('image/jpeg', 0.9)
            );
        };

        im.src = r.result;
    };

    r.readAsDataURL(f);
}
