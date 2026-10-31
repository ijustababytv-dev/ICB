// ICB Team Contest overlay (Baby, 2026-10-05). Meld layer:
//   http://127.0.0.1:8790/teams.html   (any size - the board scales to fit)
// Plain ES5 (Meld rule). Polls /api/teams every second.
(function () {
    var stage = document.getElementById('stage');
    // Meld's browser can report a 0x0 window at first load and doesn't always
    // fire 'resize' - so guard against 0 and re-fit on every poll.
    function fit() {
        var w = window.innerWidth || document.documentElement.clientWidth || 1600;
        var h = window.innerHeight || document.documentElement.clientHeight || 900;
        var s = Math.min(w / 1600, h / 900);
        if (!(s > 0)) s = 1;
        stage.style.transform = 'scale(' + s + ')';
        stage.style.webkitTransform = 'scale(' + s + ')';
        stage.style.left = Math.max(0, (w - 1600 * s) / 2) + 'px';
    }

    window.addEventListener('resize', fit);
    fit();
    var $ = function (id) {
        return document.getElementById(id);
    };

    var lastShape = '',
        lastHead = '',
        prevTotals = {},
        prevPlayers = {},
        first = true;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function renderHead(d, grand) {
        var it = d.item || {};
        var key = [
            d.title,
            it.label,
            it.command,
            it.imageUrl,
            d.showBanner,
            it.valueBox ? JSON.stringify(it.valueBox) : ''
        ].join('|');
        if (key !== lastHead) {
            lastHead = key;
            var html = '';
            if (d.showBanner && it.imageUrl) {
                html += '<div class="banner"><img src="' + esc(it.imageUrl) + '" alt="">';
                if (it.valueBox)
                    html +=
                        '<div class="gt" id="gt" style="left:' +
                        it.valueBox.left +
                        '%;top:' +
                        it.valueBox.top +
                        '%;width:' +
                        it.valueBox.width +
                        '%;height:' +
                        it.valueBox.height +
                        '%"></div>';
                html += '</div>';
            }
            html +=
                '<div class="title">' +
                esc(d.title || 'Team Contest') +
                (it.label ? '<small>Collecting: ' + esc(it.label) + '</small>' : '') +
                '</div>';
            $('head').innerHTML = html;
        }
        var gt = $('gt');
        if (gt) gt.textContent = grand;
    }

    function build(d) {
        var html = '';
        for (var i = 0; i < d.board.length; i++) {
            var t = d.board[i];
            html +=
                '<div class="team" id="t-' +
                t.letter +
                '" style="border-color:' +
                esc(t.color) +
                '"><div class="crown">👑</div>' +
                '<div class="top" style="background:' +
                esc(t.color) +
                '"><div class="nm"></div><div class="join">!team ' +
                t.letter +
                '</div></div>' +
                '<div class="total" style="color:' +
                esc(t.color) +
                '">0</div><div class="pts-label">points</div><ul></ul></div>';
        }
        $('teams').innerHTML = html;
    }

    function floatAt(el, amount) {
        var f = document.createElement('div');
        f.className = 'float ' + (amount < 0 ? 'neg' : 'pos');
        f.appendChild(document.createTextNode((amount > 0 ? '+' : '') + amount));
        el.appendChild(f);
        setTimeout(function () {
            if (f.parentNode) f.parentNode.removeChild(f);
        }, 1500);
    }

    function render(d) {
        fit();
        $('wrap').className = d.visible ? '' : 'hidden';
        var shape = d.board
            .map(function (t) {
                return t.letter + t.color;
            })
            .join('|');
        if (shape !== lastShape) {
            lastShape = shape;
            build(d);
        }
        var grand = 0,
            i,
            j;
        for (i = 0; i < d.board.length; i++) grand += d.board[i].total;
        renderHead(d, grand);
        for (i = 0; i < d.board.length; i++) {
            var t = d.board[i],
                el = $('t-' + t.letter);
            if (!el) continue;
            el.className = 'team' + (t.leading ? ' leading' : '');
            el.querySelector('.nm').textContent = t.name;
            var tot = el.querySelector('.total');
            var before = prevTotals[t.letter];
            tot.textContent = t.total;
            if (!first && before !== undefined && before !== t.total) {
                floatAt(el, t.total - before);
                tot.className = 'total';
                void tot.offsetWidth;
                tot.className = 'total bump';
            }
            prevTotals[t.letter] = t.total;
            var max = d.showPlayers,
                html = '',
                shown = 0;
            if (max > 0) {
                for (j = 0; j < t.players.length && shown < max; j++, shown++) {
                    var p = t.players[j],
                        pk = t.letter + ':' + p.name.toLowerCase();
                    var flash =
                        !first && prevPlayers[pk] !== undefined && prevPlayers[pk] !== p.points;
                    html +=
                        '<li' +
                        (flash ? ' class="flash"' : '') +
                        '><span class="n">' +
                        esc(p.name) +
                        '</span><span class="p">' +
                        p.points +
                        '</span></li>';
                }
                if (t.players.length > shown)
                    html += '<li class="more">+' + (t.players.length - shown) + ' more</li>';
                if (!t.players.length)
                    html += '<li class="empty">Type !team ' + t.letter + ' to join</li>';
            }
            el.querySelector('ul').innerHTML = html;
            for (j = 0; j < t.players.length; j++)
                prevPlayers[t.letter + ':' + t.players[j].name.toLowerCase()] = t.players[j].points;
        }
        // un-flash after a moment
        setTimeout(function () {
            var f = document.querySelectorAll('li.flash');
            for (var k = 0; k < f.length; k++) f[k].className = '';
        }, 700);
        first = false;
        var it = d.item || {},
            letters = [];
        for (i = 0; i < d.board.length; i++) letters.push(d.board[i].letter);
        var parts = [];
        if (d.joinOpen) parts.push('Join: <b>!team ' + letters.join('</b> / <b>') + '</b>');
        if (d.counting)
            parts.push(
                'Score: <b>!' +
                    esc(it.command) +
                    '</b> (or <b>!' +
                    esc(it.command) +
                    ' +2</b> / <b>-1</b>)'
            );
        else parts.push('⏸ Scoring is paused');
        $('footer').innerHTML = parts.join(' &nbsp;·&nbsp; ');
    }

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/teams?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.ok) render(d);
            } catch (e) {}
        };

        x.send();
    }

    poll();
    setInterval(poll, 1000);
})();
