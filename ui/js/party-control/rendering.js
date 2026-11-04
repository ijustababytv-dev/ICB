/** Party event and signup rendering. Loaded before the page startup script. */
function render() {
    var e = ev();
    var opts = A.events
        .map(function (x) {
            return (
                '<option value="' +
                x.id +
                '"' +
                (x.id === cur ? ' selected' : '') +
                '>' +
                (x.slot ? '📺' + x.slot + ' ' : '') +
                esc(x.title || 'Untitled') +
                (x.when ? ' — ' + esc(x.when) : '') +
                ' (' +
                x.count +
                ')</option>'
            );
        })
        .join('');
    $('evPick').innerHTML = opts;
    var mySlot = null;
    A.events.forEach(function (x) {
        if (x.id === cur) mySlot = x.slot;
    });
    $('liveTag').textContent = mySlot ? '● LIVE · Board ' + mySlot : 'not on stream';
    $('liveTag').className = 'live' + (mySlot ? ' on' : '');
    $('takeOff').style.display = mySlot ? '' : 'none';
    if (document.activeElement !== $('putBoard')) {
        if (mySlot) $('putBoard').value = String(mySlot);
        else {
            var free = A.slots.indexOf(null);
            $('putBoard').value = String(free >= 0 ? free + 1 : 1);
        }
    }
    renderBoards();
    $('visible').checked = A.visible;
    $('showTwitch').checked = A.showTwitch;
    $('chatHid').textContent = A.chatHidden
        ? 'Hidden by !hide cake right now (chat types !show cake or click Show all now).'
        : '';
    $('onDemand').checked = !!A.onDemand;
    $('showOnSignup').checked = A.showOnSignup !== false;
    if (document.activeElement !== $('showSec')) $('showSec').value = A.showSec || 30;
    $('countNote').textContent =
        '— ' + e.filled + ' / ' + e.spots + ' spots filled' + (e.open ? '' : ' · sign-ups closed');
    var roleOpts = e.roles
        .map(function (r) {
            return (
                '<option value="' +
                r.id +
                '">' +
                esc((r.emoji ? r.emoji + ' ' : '') + r.label) +
                '</option>'
            );
        })
        .join('');
    var keepRole = $('addRole').value;
    $('addRole').innerHTML = roleOpts;
    if (keepRole) $('addRole').value = keepRole;
    var byKey = {};
    e.signups.forEach(function (s) {
        byKey[s.twitch.toLowerCase()] = s;
    });
    var h = '';
    e.roles.forEach(function (r) {
        h +=
            '<div class="rbox"><h3><span>' +
            esc((r.emoji ? r.emoji + ' ' : '') + r.label) +
            ' <span class="note">!' +
            esc(r.cmdShown || r.command) +
            '</span></span><span><button class="btn-sm" title="Fold or open this role on the stream board" onclick="foldRole(\'' +
            r.id +
            "'," +
            (r.collapsed ? 'false' : 'true') +
            ')">' +
            (r.collapsed ? '▸ Folded on stream' : '▾ Fold on stream') +
            '</button> <span class="ct">' +
            r.people.length +
            ' / ' +
            r.spots +
            '</span></span></h3>' +
            (r.bring ? '<div class="bring-note">🧺 ' + esc(r.bring) + '</div>' : '');
        if (!r.people.length && !r.waitlist.length) h += '<div class="empty">Nobody yet.</div>';
        r.people.forEach(function (p) {
            h += sRow(p, r, roleOpts, false);
        });
        if (r.waitlist.length) {
            h += '<div class="wl">⏳ Waitlist</div>';
            r.waitlist.forEach(function (p) {
                h += sRow(p, r, roleOpts, true);
            });
        }
        h += '</div>';
    });
    $('signups').innerHTML = h || '<div class="empty">Add roles first.</div>';
    var sels = document.querySelectorAll('#signups select[data-r]');
    for (var i = 0; i < sels.length; i++) sels[i].value = sels[i].getAttribute('data-r');
}

function phaseNow(e) {
    if (!e.startAt) return '';
    var left = e.startAt - (Date.now() + (A.skew || 0));
    return left <= 0 ? 'late' : left <= (e.warnMin || 10) * 60000 ? 'soon' : '';
}

function sRow(p, r, roleOpts, waiting) {
    var k = q(p.twitch.toLowerCase()),
        ph = phaseNow(ev()),
        cls = p['in'] ? 'in' : ph;
    return (
        '<div class="srow"><span class="who"><b class="' +
        cls +
        '">' +
        (p['in'] ? '✔ ' : '') +
        esc(p.palia) +
        '</b><small>@' +
        esc(p.twitch) +
        '</small></span>' +
        '<select data-r="' +
        r.id +
        '" onchange="setRole(\'' +
        k +
        '\',this.value)">' +
        roleOpts +
        '</select>' +
        '<span class="acts"><button class="btn-sm btn-in' +
        (p['in'] ? ' on' : '') +
        '" onclick="checkIn(\'' +
        k +
        "'," +
        (p['in'] ? 'false' : 'true') +
        ')">' +
        (p['in'] ? '✔ Signed in' : 'Sign in') +
        '</button>' +
        (waiting ? '<button class="btn-sm" onclick="moveIn(\'' + k + '\')">Move in</button>' : '') +
        '<button class="btn-sm" onclick="rename(\'' +
        k +
        '\')">✎</button><button class="btn-sm btn-danger" onclick="removeP(\'' +
        k +
        '\')">✕</button></span></div>'
    );
}
