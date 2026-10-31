// ICB Turn Line overlay (Baby, 2026-10-29). Its own Meld layer: http://127.0.0.1:8790/turn-line.html
// Plain ES5 (Meld rule). Polls /api/turnline every 2 s (no EventSource).
(function () {
    var wrap = document.getElementById('wrap');
    var lastSig = '';

    /** Escape text for safe use inside HTML. */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** Show the chosen background (none, a colour panel, or a picture) behind the list. */
    function drawBackground(d) {
        var bg = document.getElementById('bg');
        var picture = d.bgMode === 'image' && d.bgUrl;
        var panel = d.bgMode === 'color' || (d.bgMode === 'image' && !d.bgUrl);
        bg.style.display = picture || panel ? 'block' : 'none';
        bg.style.borderRadius = d.bgRadius + 'px';
        bg.style.opacity = d.bgOpacity / 100;
        bg.style.backgroundColor = panel ? d.bgColor : 'transparent';
        bg.style.backgroundImage = picture ? 'url("' + d.bgUrl + '")' : 'none';
        bg.style.backgroundSize = d.bgFit === 'stretch' ? '100% 100%' : d.bgFit;
    }

    /** 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 11 -> 11th, 21 -> 21st. */
    function ordinal(n) {
        var last = n % 10;
        var teen = n % 100 >= 11 && n % 100 <= 13;
        if (teen || last === 0 || last > 3) return n + 'th';
        return n + (last === 1 ? 'st' : last === 2 ? 'nd' : 'rd');
    }

    /** Draw the title, the dish line and every name in line. */
    function render(d) {
        var sig =
            JSON.stringify(d.people) +
            [
                d.visible,
                d.showHeader,
                d.title,
                d.dish,
                d.turnsEach,
                d.font,
                d.goColor,
                d.doneColor,
                d.waitColor,
                d.accent,
                d.open,
                d.joinWord,
                d.bgMode,
                d.bgColor,
                d.bgOpacity,
                d.bgRadius,
                d.bgUrl,
                d.bgFit
            ].join('|');
        if (sig === lastSig) return;
        lastSig = sig;
        wrap.className = d.visible ? '' : 'hidden';
        document.body.style.fontSize = d.font + 'px';
        var s = document.body.style;
        s.setProperty('--go', d.goColor);
        s.setProperty('--done', d.doneColor);
        s.setProperty('--wait', d.waitColor);
        s.setProperty('--accent', d.accent);
        drawBackground(d);
        document.getElementById('head').style.display = d.showHeader ? 'block' : 'none';
        document.getElementById('title').textContent = d.title;
        var sub = d.turnsEach + ' starts each';
        if (d.dish) sub = d.dish + ' - ' + sub;
        if (d.open) sub += ' - type !' + d.joinWord + ' to join';
        document.getElementById('sub').textContent = sub;
        var html = '';
        for (var i = 0; i < d.people.length; i++) {
            var p = d.people[i];
            html +=
                '<div class="row ' +
                esc(p.state) +
                '"><span class="nm">' +
                esc(p.name) +
                '</span><span class="tag">' +
                ordinal(i + 1) +
                '</span></div>';
        }
        document.getElementById('list').innerHTML =
            html || '<div class="empty">Nobody in line yet</div>';
    }

    /** Ask ICB for the line every two seconds (Meld-safe XHR). */
    function poll() {
        var r = new XMLHttpRequest();
        r.open('GET', '/api/turnline?_=' + new Date().getTime(), true);
        r.onreadystatechange = function () {
            if (r.readyState !== 4 || r.status !== 200) return;
            try {
                var d = JSON.parse(r.responseText);
                if (d && d.ok) render(d);
            } catch (e) {}
        };

        r.send();
    }

    poll();
    setInterval(poll, 2000);
})();
