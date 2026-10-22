// ICB Steam achievements overlay (Baby, 2026-10-07). Meld layers:
//   /steam.html?view=popup     - only the "Achievement Unlocked!" pop-up
//   /steam.html?view=progress  - the X / 64 progress card
//   /steam.html?view=both      - both stacked
//   /steam.html?view=card      - her own art card with X / 64 in its box (+ pop-ups: view=cardpop)
// Plain ES5 (Meld rule). Polls /api/steam every 2 s.
(function () {
    var $ = function (id) {
        return document.getElementById(id);
    };

    var view = (/[?&]view=(\w+)/.exec(location.search) || [])[1] || 'popup';
    var showPop = view === 'popup' || view === 'both' || view === 'cardpop',
        showProg = view === 'progress' || view === 'both',
        showCard = view === 'card' || view === 'cardpop';
    if (!showPop) $('popWrap').className = 'hide';
    var stage = $('stage'),
        lastId = null,
        queue = [],
        busy = false,
        popSec = 9,
        showRarity = true;
    function fit() {
        stage.style.transform = 'none';
        var w = window.innerWidth || document.documentElement.clientWidth || 1000,
            h = window.innerHeight || document.documentElement.clientHeight || 400;
        var bw = 1000,
            bh = stage.offsetHeight || 1;
        var s = Math.min(w / bw, h / bh);
        if (!(s > 0)) s = 1;
        stage.style.transform = 'scale(' + s + ')';
        stage.style.webkitTransform = 'scale(' + s + ')';
        stage.style.left = Math.max(0, (w - bw * s) / 2) + 'px';
    }

    window.addEventListener('resize', fit);
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function sparkle() {
        var bits = ['✨', '⭐', '💖', '🌟', '🦄'],
            pop = $('pop');
        for (var i = 0; i < 18; i++) {
            var s = document.createElement('div');
            s.className = 'spark';
            s.appendChild(document.createTextNode(bits[i % bits.length]));
            s.style.left = 430 + (Math.random() * 600 - 300) + 'px';
            s.style.top = 90 + Math.random() * 60 + 'px';
            s.style.setProperty('--dx', Math.round(Math.random() * 300 - 150) + 'px');
            s.style.setProperty('--dy', Math.round(-60 - Math.random() * 120) + 'px');
            $('popWrap').appendChild(s);
            (function (el) {
                setTimeout(function () {
                    if (el.parentNode) el.parentNode.removeChild(el);
                }, 1700);
            })(s);
        }
    }

    function next() {
        if (busy || !queue.length) return;
        busy = true;
        var a = queue.shift();
        $('pImg').src = a.icon || '';
        $('pImg').style.display = a.icon ? '' : 'none';
        $('pName').textContent = a.name;
        $('pDesc').textContent = a.desc || '';
        var r = $('pRar');
        if (showRarity && a.rarity !== null && a.rarity !== undefined) {
            r.style.display = '';
            r.className = 'rar' + (a.rarity < 10 ? ' rare' : '');
            r.textContent =
                (a.rarity < 10 ? '💎 Rare! ' : '') + 'Only ' + a.rarity + '% of players have this';
        } else r.style.display = 'none';
        $('pop').className = 'pop show';
        sparkle();
        setTimeout(function () {
            $('pop').className = 'pop';
            setTimeout(function () {
                busy = false;
                next();
            }, 700);
        }, popSec * 1000);
    }

    function render(d) {
        popSec = d.popupSec || 9;
        showRarity = d.showRarity !== false;
        // pop-ups: on first load, skip everything already there
        var i,
            maxId = 0;
        for (i = 0; i < d.popups.length; i++) maxId = Math.max(maxId, d.popups[i].id);
        if (lastId === null) lastId = maxId;
        for (i = 0; i < d.popups.length; i++) if (d.popups[i].id > lastId) queue.push(d.popups[i]);
        lastId = Math.max(lastId, maxId);
        if (showPop) next();
        // progress
        var msg = $('msg');
        if (showProg) {
            if (!d.configured || !d.total) {
                $('prog').className = 'hide';
                msg.className = '';
                msg.textContent = d.configured
                    ? 'Connecting to Steam…'
                    : 'Set up Steam on the ICB dashboard';
            } else {
                msg.className = 'hide';
                $('prog').className = '';
                $('gTitle').textContent = d.title || d.gameName + ' Achievements';
                $('gCount').textContent = d.unlocked + ' / ' + d.total;
                $('gBar').style.width = Math.round((d.unlocked / d.total) * 100) + '%';
                var h = '';
                if (d.recent.length) {
                    h += '<span class="lbl">Latest:</span>';
                    for (i = 0; i < d.recent.length && i < 6; i++)
                        if (d.recent[i].icon)
                            h +=
                                '<img class="ic" src="' +
                                esc(d.recent[i].icon) +
                                '" title="' +
                                esc(d.recent[i].name) +
                                '" alt="">';
                }
                $('gRecent').innerHTML = h;
                var sh = '';
                for (i = 0; i < d.stats.length; i++)
                    sh +=
                        '<span class="st">' +
                        esc(d.stats[i].label) +
                        ': <b>' +
                        esc(d.stats[i].value) +
                        '</b></span>';
                $('gStats').innerHTML = sh;
            }
        }
        if (showCard) {
            if (!d.card || !d.total) {
                $('card').className = 'hide';
                msg.className = '';
                msg.textContent = !d.card
                    ? 'Pick a card picture on the Steam dashboard'
                    : 'Connecting to Steam…';
            } else {
                msg.className = 'hide';
                $('card').className = '';
                if ($('cImg').getAttribute('src') !== d.card.url) $('cImg').src = d.card.url;
                var v = $('cVal'),
                    b = d.card.box;
                v.style.left = b.left + '%';
                v.style.top = b.top + '%';
                v.style.width = b.width + '%';
                v.style.height = b.height + '%';
                v.textContent = d.unlocked + ' / ' + d.total;
            }
        }
        fit();
    }

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/steam?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.ok) render(d);
            } catch (e) {}
        };

        x.send();
    }

    fit();
    poll();
    setInterval(poll, 2000);
})();
