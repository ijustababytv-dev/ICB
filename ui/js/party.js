// ICB Party Sign-ups overlay (Baby, 2026-10-06). Meld layers (any size - scales to fit):
//   http://127.0.0.1:8790/party.html?board=1 ... ?board=7   one layer per party board
//   http://127.0.0.1:8790/party.html?board=spot             Spotlight: rotates through live boards,
//                                                          viewers type "!party 3" to show Board 3
// Plain ES5 (Meld rule). Polls /api/party every 1.5 s.
(function () {
    var $ = function (id) {
        return document.getElementById(id);
    };

    var BOARD = (/[?&](?:board|slot)=(\w+)/.exec(location.search) || [])[1] || '1';
    var box = $('box'),
        lastKey = '',
        seen = {},
        first = true,
        skew = 0,
        lastD = null;
    // phase of the party countdown: '' (none / far off), 'soon' (within warnMin), 'late' (started)
    function phaseOf(ev) {
        if (!ev || !ev.startAt) return '';
        var left = ev.startAt - (new Date().getTime() + skew);
        return left <= 0 ? 'late' : left <= ev.warnMin * 60000 ? 'soon' : '';
    }

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function tick() {
        if (!lastD || !lastD.event) return;
        var ev = lastD.event,
            el = $('cdown');
        if (!ev.startAt) {
            el.style.display = 'none';
            $('legend').style.display = 'none';
            return;
        }
        el.style.display = '';
        $('legend').style.display = '';
        $('lgWarn').textContent = ev.warnMin;
        var left = Math.round((ev.startAt - (new Date().getTime() + skew)) / 1000),
            ph = phaseOf(ev);
        if (left > 0) {
            var h = Math.floor(left / 3600),
                m = Math.floor((left % 3600) / 60),
                sec = left % 60;
            el.textContent = '⏰ Party starts in ' + (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
            el.className = 'cdown' + (ph === 'soon' ? ' soon' : '');
        } else {
            el.textContent = '🎉 Party time! Type !here to sign in';
            el.className = 'cdown go';
        }
        if (ph !== lastPhase) {
            lastPhase = ph;
            lastKey = '';
            render(lastD);
        }
    }

    var lastPhase = '';
    setInterval(tick, 1000);
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function fit() {
        box.style.transform = 'none';
        var w = window.innerWidth || document.documentElement.clientWidth || 1500;
        var h = window.innerHeight || document.documentElement.clientHeight || 800;
        var bw = box.offsetWidth || 1,
            bh = box.offsetHeight || 1;
        var s = Math.min(w / bw, h / bh);
        if (!(s > 0)) s = 1;
        box.style.transform = 'scale(' + s + ')';
        box.style.webkitTransform = 'scale(' + s + ')';
        box.style.left = Math.max(0, (w - bw * s) / 2) + 'px';
    }

    window.addEventListener('resize', fit);

    function render(d) {
        var ev = d.event;
        lastD = d;
        // Spotlight banner (board=spot only)
        var sp = $('spot');
        if (d.spot && d.spot.boards && d.spot.boards.length) {
            sp.style.display = '';
            sp.innerHTML =
                '📣 ' +
                (d.spot.held
                    ? 'Showing Board <b>' +
                      d.spot.slot +
                      '</b>' +
                      (d.spot.by && d.spot.by !== 'dashboard' ? ' for ' + esc(d.spot.by) : '')
                    : 'Board <b>' + d.spot.slot + '</b> of ' + d.spot.boards.length + ' parties') +
                (d.spot.chat
                    ? ' · type <b>!party #</b> to show a party (' +
                      d.spot.boards
                          .map(function (x) {
                              return x.slot;
                          })
                          .join(', ') +
                      ')'
                    : '');
        } else sp.style.display = 'none';
        if (d.empty || !ev) {
            box.className = 'hidden';
            lastKey = '';
            return;
        }
        box.className = d.visible ? '' : 'hidden';
        var phase = phaseOf(ev);
        lastPhase = phase;
        var key = JSON.stringify([ev, d.showTwitch, phase]);
        if (key === lastKey) {
            fit();
            return;
        }
        lastKey = key;
        // Her own art (set per party on the dashboard)
        var art = ev.art || {},
            card = $('card'),
            pa = Math.max(0, Math.min(100, art.panel === undefined ? 86 : art.panel)) / 100;
        if (art.bg) {
            card.style.background =
                'linear-gradient(rgba(28,14,40,' +
                pa +
                '),rgba(28,14,40,' +
                pa +
                ')), url("' +
                art.bg +
                '") center / ' +
                (art.fit || 'cover') +
                ' no-repeat';
        } else card.style.background = 'rgba(28,14,40,' + pa + ')';
        card.style.border = art.border === false ? 'none' : '';
        card.style.boxShadow = art.border === false ? 'none' : '';
        var rc = Math.max(0, Math.min(100, art.roleCards === undefined ? 40 : art.roleCards)) / 100;
        if (art.title) {
            $('title').className = 'title img';
            $('title').innerHTML =
                '<img src="' +
                esc(art.title) +
                '" alt="' +
                esc(ev.title || '') +
                '" onload="this.parentNode && window.dispatchEvent(new Event(\'resize\'))">';
        } else {
            $('title').className = 'title';
            $('title').textContent = ev.title || 'Cake Sign-Ups';
        }
        $('when').textContent = ev.when || '';
        $('when').style.display = ev.when ? '' : 'none';
        $('subtitle').textContent = ev.subtitle || '';
        $('subtitle').style.display = ev.subtitle ? '' : 'none';
        var st = $('status');
        st.className = 'status' + (ev.open ? '' : ' closed');
        st.textContent =
            (ev.open
                ? ev.filled + ' / ' + ev.spots + ' spots filled'
                : '🔒 Sign-ups are closed · ' + ev.filled + ' / ' + ev.spots + ' filled') +
            (ev.filled ? ' · ✔ ' + ev.checkedIn + ' signed in' : '');
        var html = '',
            i,
            j,
            nowSeen = {},
            example = '';
        // Roles are grouped into sections (Overprep, Cooking, Helpers...) in the order sections first appear.
        var order = [],
            byGroup = {},
            anyGroup = false;
        for (i = 0; i < ev.roles.length; i++) {
            var g = ev.roles[i].group || '';
            if (g) anyGroup = true;
            if (!byGroup.hasOwnProperty(g)) {
                byGroup[g] = [];
                order.push(g);
            }
            byGroup[g].push(ev.roles[i]);
        }
        var list = [];
        for (i = 0; i < order.length; i++) {
            list.push({ head: order[i] });
            for (j = 0; j < byGroup[order[i]].length; j++) list.push(byGroup[order[i]][j]);
        }
        for (i = 0; i < list.length; i++) {
            // Section headings only help when there are 2+ sections; one section for everything = no heading.
            if (list[i].head !== undefined) {
                if (anyGroup && order.length > 1)
                    html +=
                        '<div class="grp"><span>' + esc(list[i].head || 'Other') + '</span></div>';
                continue;
            }
            var r = list[i],
                full = r.people.length >= r.spots;
            var cmdShown = r.cmdShown || r.command;
            if (!example) example = cmdShown;
            html +=
                '<div class="role' +
                (full ? ' full' : '') +
                (r.spots > 10 ? ' wide' : '') +
                (r.collapsed ? ' folded' : '') +
                '"><div class="rh" data-role="' +
                esc(r.id) +
                '">' +
                (r.emoji ? '<span class="em">' + esc(r.emoji) + '</span>' : '') +
                '<div class="nm"><div class="lab">' +
                esc(r.label) +
                '</div><div class="cmd">!' +
                esc(cmdShown) +
                '</div></div>' +
                '<span class="ct">' +
                r.people.length +
                '/' +
                r.spots +
                '</span><span class="fold">' +
                (r.collapsed ? '▸' : '▾') +
                '</span></div>' +
                (r.bring ? '<div class="bring">🧺 <b>Bring:</b> ' + esc(r.bring) + '</div>' : '') +
                '<ul>';
            for (j = 0; j < r.people.length; j++) {
                var p = r.people[j],
                    k = r.id + ':' + p.twitch.toLowerCase() + ':' + p.palia;
                nowSeen[k] = 1;
                var cls =
                    (p['in'] ? 'in' : phase === 'late' ? 'late' : phase === 'soon' ? 'soon' : '') +
                    (!first && !seen[k] ? ' new' : '');
                html +=
                    '<li' +
                    (cls ? ' class="' + cls + '"' : '') +
                    '>' +
                    esc(p.palia) +
                    (d.showTwitch && p.twitch.toLowerCase() !== p.palia.toLowerCase()
                        ? '<small>@' + esc(p.twitch) + '</small>'
                        : '') +
                    '</li>';
            }
            for (j = r.people.length; j < r.spots; j++) html += '<li class="open">open spot</li>';
            html +=
                '</ul>' +
                (r.waitlist.length
                    ? '<div class="wait">⏳ ' + r.waitlist.length + ' on waitlist</div>'
                    : '') +
                '</div>';
        }
        $('roles').innerHTML = html || '<div class="status">No roles set up yet</div>';
        var rcs = $('roles').querySelectorAll('.role');
        for (var q = 0; q < rcs.length; q++) rcs[q].style.background = 'rgba(20,10,30,' + rc + ')';
        seen = nowSeen;
        first = false;
        $('footer').innerHTML =
            ev.open && example
                ? 'Sign up: type <b>!' +
                  esc(example) +
                  ' YourPaliaName</b> (any role) · <b>!leave</b> to drop out · at the party? <b>!here</b>'
                : ev.filled
                ? 'At the party? Type <b>!here</b> to sign in'
                : '';
        fit();
    }

    // Click a role's header on the board to fold / open it (saved, so the dashboard and other boards agree).
    $('roles').addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== this && !(t.getAttribute && t.getAttribute('data-role')))
            t = t.parentNode;
        if (!t || t === this || !lastD || !lastD.event) return;
        var role = t.parentNode;
        role.className = /folded/.test(role.className)
            ? role.className.replace(' folded', '')
            : role.className + ' folded';
        fit();
        var x = new XMLHttpRequest();
        x.open('POST', '/api/party/collapse', true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify({ id: lastD.event.id, roleId: t.getAttribute('data-role') }));
    });
    function poll() {
        var x = new XMLHttpRequest();
        x.open(
            'GET',
            '/api/party?board=' + encodeURIComponent(BOARD) + '&_=' + new Date().getTime(),
            true
        );
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.ok) {
                    skew = (d.now || 0) - new Date().getTime();
                    render(d);
                    tick();
                }
            } catch (e) {}
        };

        x.send();
    }

    poll();
    setInterval(poll, 1500);
})();
