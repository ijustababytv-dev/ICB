// ICB Aniimo Dex overlay (Baby, 2026-10-14). Meld layer: http://127.0.0.1:8790/aniimo.html
// Parts can be split into separate Meld layers: ?part=panel  ?part=popup  ?part=lookup  (default: all)
// Plain ES5 (Meld rule). Polls /api/aniimo every second.
(function () {
    var $ = function (id) {
        return document.getElementById(id);
    };

    var part = (/[?&]part=(\w+)/.exec(location.search) || [])[1] || 'all';
    var EL = {
        Fire: '#ff7a45',
        Water: '#4aa8ff',
        Grass: '#5fd068',
        Electric: '#ffd84a',
        Ice: '#8fe3ff',
        Rock: '#c49a6c',
        Wind: '#a8f0d0',
        Dark: '#a77bff',
        Holy: '#fff2a8'
    };
    var lastPop = 0,
        lastLook = 0;
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function hexA(hex, a) {
        var n = parseInt(String(hex).slice(1), 16);
        return (
            'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
        );
    }

    function elColor(e) {
        return (
            EL[
                String(e || '')
                    .split('/')[0]
                    .replace(/\s/g, '')
            ] || '#7dd3fc'
        );
    }

    function fit() {
        var W = window.innerWidth,
            H = window.innerHeight,
            w = $('wrap');
        if (!W || !H) return; // Meld can report 0x0 while loading
        var s = Math.min(1, W / w.offsetWidth, H / Math.max(1, w.offsetHeight));
        w.style.transform = 'scale(' + s + ')';
        w.style.webkitTransform = 'scale(' + s + ')';
    }

    function style(el, d, border) {
        el.style.borderColor = border || d.accent;
        el.style.background = hexA(
            d.panelColor || '#101522',
            (d.panelOpacity === undefined ? 88 : d.panelOpacity) / 100
        );
    }

    function render(d) {
        var st = d.stats,
            ac = d.accent || '#7dd3fc';
        // ---- progress panel ----
        var showPanel = d.visible && (part === 'all' || part === 'panel');
        $('panel').className = 'box' + (showPanel ? '' : ' hidden');
        if (showPanel) {
            style($('panel'), d);
            $('title').textContent = d.title || '';
            $('pct').textContent = st.pct + '%';
            $('pct').style.background = ac;
            $('bar').style.width = st.pct + '%';
            $('bar').style.background = 'linear-gradient(90deg,' + ac + ',#86efac)';
            $('sub').textContent =
                st.done +
                ' / ' +
                st.total +
                ' forms · ' +
                st.basic +
                ' / ' +
                st.species +
                ' caught · ' +
                st.full +
                ' complete';
            var h = '';
            if (d.showElements)
                for (var e in st.elements)
                    if (EL[e]) {
                        var o = st.elements[e],
                            p = o.total ? Math.round((o.done / o.total) * 100) : 0;
                        h +=
                            '<div class="el"><span style="color:' +
                            EL[e] +
                            '">' +
                            esc(e) +
                            '</span> ' +
                            p +
                            '%<div class="b"><i style="width:' +
                            p +
                            '%;background:' +
                            EL[e] +
                            '"></i></div></div>';
                    }
            $('els').innerHTML = h;
            $('els').style.display = h ? '' : 'none';
            $('recent').innerHTML = d.recent.length
                ? 'Latest: ' +
                  d.recent
                      .slice(0, 3)
                      .map(function (r) {
                          return '<b>' + esc(r.name) + '</b> ' + esc(r.variant);
                      })
                      .join(' · ')
                : '';
        }
        // ---- new catch pop-up ----
        var p2 = d.popup,
            showPop = d.visible && p2 && (part === 'all' || part === 'popup');
        if (showPop) {
            var col = p2.complete ? '#ffd166' : elColor(p2.element);
            style($('pop'), d, col);
            $('pop').innerHTML =
                (p2.formImg || p2.img
                    ? '<img class="pimg" src="' + esc(p2.formImg || p2.img) + '" alt="">'
                    : '') +
                '<div class="t1" style="color:' +
                col +
                '">' +
                (p2.complete ? '🏆 Complete!' : '✨ New catch!') +
                '</div><div class="t2">' +
                esc(p2.name) +
                '</div>' +
                '<div class="t3">' +
                esc(p2.variant) +
                ' · ' +
                p2.have +
                '/' +
                p2.of +
                '</div>';
            $('pop').className = 'box' + (p2.at !== lastPop ? ' show' : '');
            lastPop = p2.at;
        } else $('pop').className = 'box hidden';
        // ---- chat look-up ----
        var L = d.lookup,
            showLook = d.visible && L && (part === 'all' || part === 'lookup');
        if (showLook) {
            var lh = L.by ? esc(L.by) + ' asked' : '';
            if (L.kind === 'need') {
                style($('look'), d, elColor(L.element));
                $('look').innerHTML =
                    (L.img ? '<img class="limg" src="' + esc(L.img) + '" alt="">' : '') +
                    '<div class="lh">' +
                    lh +
                    ' · No. ' +
                    esc(L.number) +
                    ' · ' +
                    esc(L.element) +
                    '</div><div class="ln">' +
                    esc(L.name) +
                    ' — ' +
                    (L.need.length ? 'needs ' + L.need.length : 'all done! 🏆') +
                    '</div>' +
                    L.need
                        .map(function (v) {
                            return (
                                '<span class="chip" style="background:' +
                                hexA(elColor(L.element), 0.3) +
                                '">' +
                                esc(v) +
                                '</span>'
                            );
                        })
                        .join('') +
                    L.have
                        .map(function (v) {
                            var fi = (L.formImgs || {})[v];
                            return fi
                                ? '<span class="chip got"><img src="' +
                                      esc(fi) +
                                      '" alt="">' +
                                      esc(v) +
                                      '</span>'
                                : '<span class="chip have">' + esc(v) + '</span>';
                        })
                        .join('') +
                    '<div class="look-clear"></div>';
            } else if (L.kind === 'dex') {
                style($('look'), d);
                $('look').innerHTML =
                    '<div class="lh">' +
                    lh +
                    '</div><div class="ln">' +
                    esc(d.title) +
                    ': ' +
                    st.pct +
                    '%</div><div style="font-size:18px;font-weight:800">' +
                    st.done +
                    ' / ' +
                    st.total +
                    ' forms · ' +
                    st.basic +
                    ' / ' +
                    st.species +
                    ' Aniimo caught · ' +
                    st.full +
                    ' complete</div>';
            } else {
                style($('look'), d, '#ff6b81');
                $('look').innerHTML =
                    '<div class="lh">' +
                    lh +
                    '</div><div class="ln" style="font-size:20px">No Aniimo called "' +
                    esc(L.q) +
                    '"</div>';
            }
            $('look').className = 'box' + (L.at !== lastLook ? ' show' : '');
            lastLook = L.at;
        } else $('look').className = 'box hidden';
        fit();
    }

    function poll() {
        var r = new XMLHttpRequest();
        r.open('GET', '/api/aniimo?_=' + new Date().getTime(), true);
        r.onreadystatechange = function () {
            if (r.readyState !== 4 || r.status !== 200) return;
            try {
                var d = JSON.parse(r.responseText);
                if (d && d.ok) render(d);
            } catch (e) {}
        };

        r.send();
    }

    window.onresize = fit;
    poll();
    setInterval(poll, 1000);
})();
