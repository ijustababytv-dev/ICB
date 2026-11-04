(function () {
    var BASE = '';
    var S = null,
        sprites = [],
        arts = {};
    var pickedId = '',
        pickedVar = '';

    /** Resolve a control in this page. */
    function $(id) {
        return document.getElementById(id);
    }

    // ---- save a setting ----
    function save(obj) {
        fetch(BASE + '/api/sprite-tv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ set: obj })
        })
            .then(function (r) {
                return r.json();
            })
            .then(function (d) {
                if (d.ok) apply(d);
            });
    }

    // ---- apply state to controls ----
    function apply(d) {
        S = d.settings;
        $('chkVisible').checked = S.visible;
        $('selMode').value = S.mode;
        $('chkName').checked = S.showName;
        $('chkVariant').checked = S.showVariant;
        $('chkRarity').checked = S.showRarity;
        $('chkBars').checked = S.idleBars;
        $('selTextPos').value = S.textPos;

        $('rngTextSize').value = S.textSize;
        $('valTextSize').textContent = S.textSize + '%';
        $('rngImgSize').value = S.imgSize;
        $('valImgSize').textContent = S.imgSize + '%';
        $('rngFlash').value = S.flashMs;
        $('valFlash').textContent = S.flashMs + 'ms';
        $('rngStatic').value = S.staticMs;
        $('valStatic').textContent = S.staticMs + 'ms';

        // slideshow
        $('chkSlideshow').checked = S.slideshow;
        $('chkInterrupt').checked = S.ssShowInterrupt;
        $('selPool').value = S.ssPool;
        $('rngDelay').value = S.ssDelay;
        $('valDelay').textContent = S.ssDelay + 's';
        $('rngInterval').value = S.ssInterval;
        $('valInterval').textContent = S.ssInterval + 's';
        $('txtMessage').value = S.ssMessage || '';
        $('txtSubMessage').value = S.ssSubMessage || '';
        $('ssSettings').style.display = S.slideshow ? '' : 'none';

        $('pickArea').style.display = S.mode === 'pinned' ? '' : 'none';
        pickedId = S.pinnedId;
        pickedVar = S.pinnedVariant;
        highlightPick();
        renderNow(d.display);
        scalePreview();
    }

    /** Preview the resolved display sprite, including variant artwork when available. */
    function renderNow(disp) {
        var el = $('nowShowing');
        if (!disp) {
            el.innerHTML = '<div class="note">Nothing yet — catch a sprite!</div>';
            return;
        }
        var imgUrl = disp.variantImg || disp.img || '';
        if (imgUrl && !imgUrl.startsWith('http')) imgUrl = BASE + imgUrl;
        el.innerHTML =
            (imgUrl ? '<img src="' + imgUrl + '" alt="">' : '') +
            '<div class="info"><div class="sn">' +
            esc(disp.name) +
            '</div><div class="sv">' +
            esc(disp.variant || '') +
            '</div>' +
            '<div class="note">' +
            esc(disp.rarity || '') +
            '</div></div>';
    }

    /** Encode operator text before inserting it into generated markup. */
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ---- sprite picker ----
    function renderPicker() {
        var el = $('spritePick');
        el.innerHTML = '';
        sprites.forEach(function (sp) {
            var img = (arts[sp.id] && arts[sp.id]['Base']) || sp.img;
            if (img && !img.startsWith('http')) img = BASE + img;
            var btn = document.createElement('div');
            btn.className = 'sp-btn' + (sp.id === pickedId ? ' active' : '');
            btn.dataset.id = sp.id;
            btn.innerHTML =
                (img
                    ? '<img src="' + img + '" alt="">'
                    : '<div style="width:100%;aspect-ratio:1;background:var(--panel)"></div>') +
                '<div class="sname">' +
                esc(sp.name) +
                '</div>';
            btn.onclick = function () {
                pickSprite(sp.id);
            };

            el.appendChild(btn);
        });
    }

    /** Selecting a roster entry pins its first variant and reveals variant controls. */
    function pickSprite(id) {
        pickedId = id;
        var sp = sprites.find(function (s) {
            return s.id === id;
        });
        pickedVar = sp ? sp.variants[0] : 'Base';
        renderVariants();
        highlightPick();
        save({ pinnedId: pickedId, pinnedVariant: pickedVar, mode: 'pinned' });
        $('selMode').value = 'pinned';
        $('pickArea').style.display = '';
    }

    /** List only variants belonging to the selected roster entry. */
    function renderVariants() {
        var el = $('varPills');
        el.innerHTML = '';
        var sp = sprites.find(function (s) {
            return s.id === pickedId;
        });
        if (!sp) return;
        sp.variants.forEach(function (v) {
            var pill = document.createElement('span');
            pill.className = 'var-pill' + (v === pickedVar ? ' active' : '');
            pill.textContent = v;
            pill.onclick = function () {
                pickedVar = v;
                highlightPick();
                save({ pinnedVariant: v });
            };

            el.appendChild(pill);
        });
    }

    /** Keep selection markers aligned with the saved pin. */
    function highlightPick() {
        var btns = $('spritePick').querySelectorAll('.sp-btn');
        for (var i = 0; i < btns.length; i++)
            btns[i].className = 'sp-btn' + (btns[i].dataset.id === pickedId ? ' active' : '');
        var pills = $('varPills').querySelectorAll('.var-pill');
        for (var j = 0; j < pills.length; j++)
            pills[j].className = 'var-pill' + (pills[j].textContent === pickedVar ? ' active' : '');
    }

    // ---- preview scaling ----
    /** Fit the overlay preview to the operator panel without changing its native canvas. */
    function scalePreview() {
        var wrap = $('prevWrap'),
            fr = $('prevFrame');
        var w = wrap.offsetWidth;
        if (!w) return;
        var s = w / 400;
        fr.style.transform = 'scale(' + s + ')';
        wrap.style.paddingTop = '100%';
    }

    window.addEventListener('resize', scalePreview);

    // ---- wiring ----
    $('chkVisible').onchange = function () {
        save({ visible: this.checked });
    };

    $('chkName').onchange = function () {
        save({ showName: this.checked });
    };

    $('chkVariant').onchange = function () {
        save({ showVariant: this.checked });
    };

    $('chkRarity').onchange = function () {
        save({ showRarity: this.checked });
    };

    $('chkBars').onchange = function () {
        save({ idleBars: this.checked });
    };

    $('selMode').onchange = function () {
        save({ mode: this.value });
        $('pickArea').style.display = this.value === 'pinned' ? '' : 'none';
    };

    $('selTextPos').onchange = function () {
        save({ textPos: this.value });
    };

    $('chkSlideshow').onchange = function () {
        save({ slideshow: this.checked });
        $('ssSettings').style.display = this.checked ? '' : 'none';
    };

    $('chkInterrupt').onchange = function () {
        save({ ssShowInterrupt: this.checked });
    };

    $('selPool').onchange = function () {
        save({ ssPool: this.value });
    };

    $('txtMessage').onchange = function () {
        save({ ssMessage: this.value });
    };

    $('txtSubMessage').onchange = function () {
        save({ ssSubMessage: this.value });
    };

    /** Preview a slider value immediately and persist it when the edit completes. */
    function rangeWire(sliderId, valId, key, suffix) {
        var sl = $(sliderId),
            vl = $(valId);
        sl.oninput = function () {
            vl.textContent = sl.value + suffix;
        };

        sl.onchange = function () {
            var o = {};
            o[key] = Number(sl.value);
            save(o);
        };
    }

    rangeWire('rngTextSize', 'valTextSize', 'textSize', '%');
    rangeWire('rngImgSize', 'valImgSize', 'imgSize', '%');
    rangeWire('rngFlash', 'valFlash', 'flashMs', 'ms');
    rangeWire('rngStatic', 'valStatic', 'staticMs', 'ms');
    rangeWire('rngDelay', 'valDelay', 'ssDelay', 's');
    rangeWire('rngInterval', 'valInterval', 'ssInterval', 's');

    /** Copy the existing production Meld URL from the control. */
    function copyUrl() {
        try {
            navigator.clipboard.writeText($('meldUrl').value);
        } catch (_) {}
    }

    $('meldUrl').nextElementSibling.onclick = copyUrl;

    // ---- load ----
    function init() {
        // Get sprite-tv settings + display
        fetch(BASE + '/api/sprite-tv')
            .then(function (r) {
                return r.json();
            })
            .then(function (d) {
                if (d.ok) apply(d);
            })
            .catch(function () {});
        // Get sprites for the picker
        fetch(BASE + '/api/sprites/jar?first=1')
            .then(function (r) {
                return r.json();
            })
            .then(function (d) {
                if (d.sprites) {
                    sprites = d.sprites;
                    arts = {};
                    d.sprites.forEach(function (s) {
                        if (s.art) arts[s.id] = s.art;
                    });
                    renderPicker();
                    renderVariants();
                }
            })
            .catch(function () {});
    }

    // ---- SSE ----
    function connectSSE() {
        var es = new EventSource(BASE + '/events?role=control');
        es.addEventListener('spritetv', function (e) {
            try {
                var d = JSON.parse(e.data);
                if (d.ok) apply(d);
            } catch (_) {}
        });
        es.addEventListener('sprites', function () {
            // re-fetch to pick up any new catches
            fetch(BASE + '/api/sprite-tv')
                .then(function (r) {
                    return r.json();
                })
                .then(function (d) {
                    if (d.ok) apply(d);
                })
                .catch(function () {});
        });
        es.onopen = function () {
            $('health').textContent = 'connected';
            $('health').className = 'health';
        };

        es.onerror = function () {
            $('health').textContent = 'offline';
            $('health').className = 'health offline';
            es.close();
            setTimeout(connectSSE, 3000);
        };
    }

    init();
    connectSSE();
})();
