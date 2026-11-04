// ICB Neon Chat overlay (Baby, 2026-10-25). Its own Meld layer: http://127.0.0.1:8790/neon-chat.html
// The neon box fills the layer, so it is sized and placed by moving/resizing the layer in Meld.
// Plain ES5 (Meld rule). Polls /api/neonchat every 2 s (no EventSource) for new lines only.
(function () {
    /** Shorthand for getElementById. */
    function $(id) {
        return document.getElementById(id);
    }

    var S = null;
    var lastSeq = -1;
    var lastCleared = 0;
    var clockOffset = 0; // server time minus this computer's time, for fading
    var list = $('list');
    var box = $('box');
    var BADGE = { streamer: '★', mod: 'MOD', vip: 'VIP', sub: 'SUB' };
    var ICON = { follow: '💖', sub: '⭐', gifts: '🎁', bits: '💎', raid: '🚀' };

    /** Escape text for safe use inside HTML. */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** Build the HTML for one chat or event line. */
    function lineHtml(l) {
        if (l.kind === 'event')
            return '<span class="icon">' + (ICON[l.event] || '✨') + '</span>' + esc(l.text);
        var text = '';
        for (var i = 0; i < l.parts.length; i++) {
            var p = l.parts[i];
            text +=
                p.t === 'emote'
                    ? '<img src="' + esc(p.url) + '" alt="' + esc(p.name) + '">'
                    : esc(p.v);
        }
        var badge =
            S.showBadges && BADGE[l.role] ? '<span class="badge">' + BADGE[l.role] + '</span>' : '';
        return (
            '<div class="name' +
            (S.nameFont === 'script' ? ' script' : '') +
            '">' +
            badge +
            esc(l.name) +
            '</div>' +
            '<div class="text">' +
            text +
            '</div>'
        );
    }

    /** Add one line to the box, keeping only the newest "Messages shown". */
    function addLine(l) {
        var el = document.createElement('div');
        el.className = l.kind === 'event' ? 'msg event' : 'msg';
        if (l.color) el.style.setProperty('--nc', l.color);
        el.setAttribute('data-at', l.at);
        el.innerHTML = lineHtml(l);
        if (S.newestOnTop) list.insertBefore(el, list.firstChild);
        else list.appendChild(el);
        trim();
    }

    /** Remove the oldest lines beyond the limit. */
    function trim() {
        var kids = list.children;
        while (kids.length > S.maxMessages)
            list.removeChild(S.newestOnTop ? list.lastChild : list.firstChild);
    }

    /** Fade lines older than "Messages stay", and hide an empty box if that option is on. */
    function tidy() {
        if (!S) return;
        var now = Date.now() + clockOffset;
        var kids = list.children;
        for (var i = kids.length - 1; i >= 0; i--) {
            var el = kids[i];
            var age = (now - Number(el.getAttribute('data-at'))) / 1000;
            if (S.fadeSec > 0 && age > S.fadeSec && el.className.indexOf(' out') < 0) {
                el.className += ' out';
                removeLater(el);
            }
        }
        var showing = 0;
        for (var j = 0; j < kids.length; j++) if (kids[j].className.indexOf(' out') < 0) showing++;
        var hideBox = !S.showFrame || (S.frameOnlyWithChat && !showing);
        var over = list.scrollHeight > list.clientHeight + 2;
        var base = (S.showTitle ? 'withTitle' : '') + (S.newestOnTop ? ' newestTop' : '');
        list.className = base + (over ? ' overflow' : '');
        box.className = hideBox ? 'hidden' : '';
        $('glass').className = 'cut glass' + (hideBox ? ' hidden' : '');
    }

    /** Take a faded line off the page once its fade has finished. */
    function removeLater(el) {
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 900);
    }

    /** A few twinkles round the frame edge (rebuilt when the option changes). */
    function buildSparks(on) {
        var holder = $('sparks');
        holder.innerHTML = '';
        if (!on) return;
        var spots = [
            [4, 8],
            [96, 6],
            [2, 52],
            [98, 40],
            [8, 97],
            [92, 95],
            [50, 1],
            [60, 99]
        ];
        for (var i = 0; i < spots.length; i++) {
            var s = document.createElement('span');
            s.textContent = '✦';
            s.style.left = 'calc(' + spots[i][0] + '% - 7px)';
            s.style.top = 'calc(' + spots[i][1] + '% - 9px)';
            s.style.fontSize = 10 + (i % 3) * 5 + 'px';
            s.style.animationDelay = i * 0.37 + 's';
            holder.appendChild(s);
        }
    }

    /**
     * The inside of the neon box: her chosen colour at her chosen strength, a little darker
     * at the bottom. Strength 0 makes it fully see-through so only the neon frame shows.
     */
    function glassBackground(hex, opacity) {
        var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
        var r = m ? parseInt(m[1], 16) : 36;
        var g = m ? parseInt(m[2], 16) : 6;
        var b = m ? parseInt(m[3], 16) : 58;
        var a = Math.max(0, Math.min(100, Number(opacity))) / 100;
        if (a === 0) return 'transparent';
        var dark = [Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55)].join(',');
        return (
            'linear-gradient(180deg, rgba(' +
            r +
            ',' +
            g +
            ',' +
            b +
            ',' +
            a +
            '), rgba(' +
            dark +
            ',' +
            Math.min(1, a * 1.03) +
            '))'
        );
    }

    var lastLook = '';

    /** Apply the look settings (size, font, glow, colour shift, title, layout). */
    function applyLook() {
        var look = [
            S.textSize,
            S.glow,
            S.hueShift,
            S.showTitle,
            S.title,
            S.sparkles,
            S.newestOnTop,
            S.visible,
            S.bgColor,
            S.bgOpacity
        ].join('|');
        if (look === lastLook) return;
        var sparksChanged = lastLook.split('|')[5] !== String(S.sparkles);
        lastLook = look;
        document.body.style.fontSize = S.textSize + 'px';
        document.body.style.display = S.visible ? 'block' : 'none';
        var g = S.glow / 100;
        var filters =
            'drop-shadow(0 0 ' +
            Math.round(4 + 10 * g) +
            'px rgba(255,63,208,' +
            (0.35 + 0.5 * g) +
            ')) drop-shadow(0 0 ' +
            Math.round(10 + 20 * g) +
            'px rgba(255,140,60,' +
            0.45 * g +
            '))';
        if (S.hueShift) filters += ' hue-rotate(' + S.hueShift + 'deg)';
        box.style.filter = filters;
        box.style.webkitFilter = filters;
        list.style.filter = S.hueShift ? 'hue-rotate(' + S.hueShift + 'deg)' : '';
        $('glass').style.background = glassBackground(S.bgColor, S.bgOpacity);
        $('title').style.display = S.showTitle ? 'block' : 'none';
        $('titleText').textContent = S.title;
        list.className = (S.showTitle ? 'withTitle' : '') + (S.newestOnTop ? ' newestTop' : '');
        if (sparksChanged) buildSparks(S.sparkles);
    }

    /** Take the latest settings and any new lines from ICB. */
    function apply(d) {
        S = d;
        clockOffset = d.now - Date.now();
        applyLook();
        if (d.clearedAt > lastCleared) {
            list.innerHTML = '';
            lastCleared = d.clearedAt;
        }
        if (d.seq < lastSeq) lastSeq = 0; // ICB restarted, numbering began again
        var now = Date.now() + clockOffset;
        for (var i = 0; i < d.lines.length; i++) {
            var l = d.lines[i];
            var stale = S.fadeSec > 0 && (now - l.at) / 1000 > S.fadeSec; // already faded: skip
            if (l.n > lastSeq && !stale) addLine(l);
        }
        lastSeq = d.seq;
        trim();
        tidy();
    }

    /** Ask ICB for anything new every two seconds (Meld-safe XHR). */
    function poll() {
        var r = new XMLHttpRequest();
        r.open(
            'GET',
            '/api/neonchat?since=' + Math.max(0, lastSeq) + '&_=' + new Date().getTime(),
            true
        );
        r.onreadystatechange = function () {
            if (r.readyState !== 4 || r.status !== 200) return;
            try {
                var d = JSON.parse(r.responseText);
                if (d && d.ok) apply(d);
            } catch (e) {}
        };

        r.send();
    }

    poll();
    setInterval(poll, 2000);
    setInterval(tidy, 1000);
})();
