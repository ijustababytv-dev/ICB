// ICB Event Time converter overlay (Baby, 2026-10-06). Meld layer:
//   http://127.0.0.1:8790/eventtime.html  (any size - scales to fit)
// Plain ES5 (Meld rule). Polls /api/eventtime every 2 s.
(function () {
    var $ = function (id) {
        return document.getElementById(id);
    };

    var box = $('box'),
        state = null,
        skew = 0,
        lastKey = '';

    function fit() {
        box.style.transform = 'none';
        var w = window.innerWidth || document.documentElement.clientWidth || 1600;
        var h = window.innerHeight || document.documentElement.clientHeight || 400;
        var bw = box.offsetWidth || 1,
            bh = box.offsetHeight || 1;
        var s = Math.min(w / bw, h / bh);
        if (!(s > 0)) s = 1;
        box.style.transform = 'scale(' + s + ')';
        box.style.webkitTransform = 'scale(' + s + ')';
        box.style.left = Math.max(0, (w - bw * s) / 2) + 'px';
    }

    window.addEventListener('resize', fit);

    function fmt(ms, tz, opts) {
        var o = { timeZone: tz };
        for (var k in opts) o[k] = opts[k];
        return new Intl.DateTimeFormat('en-US', o).format(new Date(ms));
    }

    function abbr(ms, tz) {
        try {
            var parts = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                timeZoneName: 'short'
            }).formatToParts(new Date(ms));
            for (var i = 0; i < parts.length; i++)
                if (parts[i].type === 'timeZoneName')
                    return parts[i].value.replace(/^GMT\+(\d)/, 'GMT +$1');
        } catch (e) {}
        return tz;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function render() {
        var d = state;
        if (!d) return;
        box.className = d.visible ? '' : 'hidden';
        $('title').textContent = d.title || 'Next Event';
        $('subtitle').textContent = d.subtitle || '';
        $('subtitle').style.display = d.subtitle ? '' : 'none';
        var key = JSON.stringify([d.at, d.zones, d.layout, d.sourceTz]);
        if (key !== lastKey) {
            lastKey = key;
            var html = '';
            if (!d.at) html = '<div class="empty">Set the event time on the dashboard</div>';
            else
                for (var i = 0; i < d.zones.length; i++) {
                    var z = d.zones[i];
                    if (!z.visible) continue;
                    var lab = z.label || abbr(d.at, z.tz);
                    html +=
                        '<div class="zone' +
                        (z.tz === d.sourceTz ? ' home' : '') +
                        '"><div class="lab">' +
                        esc(lab) +
                        '</div>' +
                        '<div class="day">' +
                        esc(fmt(d.at, z.tz, { weekday: 'short', month: 'short', day: 'numeric' })) +
                        '</div>' +
                        '<div class="tm">' +
                        esc(fmt(d.at, z.tz, { hour: 'numeric', minute: '2-digit' })) +
                        '</div></div>';
                }
            $('zones').className = 'zones ' + (d.layout === 'column' ? 'column' : 'row');
            $('zones').innerHTML = html;
        }
        tick();
        fit();
    }

    function tick() {
        var d = state,
            el = $('cd');
        if (!d) return;
        if (!d.at || !d.showCountdown) {
            el.style.display = 'none';
            return;
        }
        el.style.display = '';
        var left = Math.round((d.at - (new Date().getTime() + skew)) / 1000);
        if (left <= 0) {
            el.textContent = left > -3600 ? '🎉 Happening now! 🎉' : 'This event has started';
            return;
        }
        var dd = Math.floor(left / 86400),
            hh = Math.floor((left % 86400) / 3600),
            mm = Math.floor((left % 3600) / 60),
            ss = left % 60;
        el.textContent =
            'Starts in ' +
            (dd ? dd + 'd ' : '') +
            (dd || hh ? hh + 'h ' : '') +
            mm +
            'm' +
            (dd ? '' : ' ' + ('0' + ss).slice(-2) + 's');
    }

    setInterval(tick, 1000);

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/eventtime?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.ok) {
                    skew = (d.now || 0) - new Date().getTime();
                    state = d;
                    render();
                }
            } catch (e) {}
        };

        x.send();
    }

    poll();
    setInterval(poll, 2000);
})();
