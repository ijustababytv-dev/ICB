var $ = function (id) {
    return document.getElementById(id);
};

var A = null,
    cur = null,
    roles = [],
    formFor = null;
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}

function q(s) {
    return esc(s).replace(/'/g, '&#39;');
}

function toast(t) {
    var e = $('toast');
    e.textContent = t;
    e.className = 'toast show';
    clearTimeout(e._t);
    e._t = setTimeout(function () {
        e.className = 'toast';
    }, 2400);
}

function api(path, body) {
    return fetch(
        path,
        body === undefined
            ? {}
            : {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body)
              }
    )
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'Failed');
            return d;
        });
}

function act(path, body, msg) {
    return api(path, body)
        .then(function (d) {
            if (msg) toast(msg);
            return load().then(function () {
                return d;
            });
        })
        .catch(function (e) {
            toast('⚠️ ' + e.message);
        });
}

function copyUrl(b) {
    var u = 'http://127.0.0.1:8790/party.html?board=' + (b || 1);
    try {
        navigator.clipboard.writeText(u);
        toast('Copied ' + u);
    } catch (e) {
        prompt('Copy this link:', u);
    }
}

function ev() {
    for (var i = 0; i < A.full.length; i++) if (A.full[i].id === cur) return A.full[i];
    return A.full[0];
}

function fillForm() {
    var e = ev();
    formFor = e.id;
    $('title').value = e.title || '';
    $('when').value = e.when || '';
    $('subtitle').value = e.subtitle || '';
    $('open').checked = e.open;
    $('startAt').value = e.startAt ? toLocalInput(e.startAt) : '';
    $('warnMin').value = e.warnMin || 10;
    syncTime();
    roles = e.roles.map(function (r) {
        return {
            id: r.id,
            emoji: r.emoji,
            label: r.label,
            command: r.command,
            spots: r.spots,
            group: r.group || '',
            bring: r.bring || ''
        };
    });
    renderRoles();
    fillLook(e);
}

function renderRoles() {
    var h = '';
    roles.forEach(function (r, i) {
        h +=
            '<div class="rbox2"><div class="rrow"><input type="text" value="' +
            q(r.emoji) +
            '" maxlength="8" oninput="roles[' +
            i +
            '].emoji=this.value" style="text-align:center">' +
            '<input type="text" value="' +
            q(r.label) +
            '" maxlength="40" placeholder="Tomato" oninput="roles[' +
            i +
            '].label=this.value">' +
            '<span class="cmdw">!<input type="text" value="' +
            q(r.command) +
            '" maxlength="24" placeholder="tomato" oninput="roles[' +
            i +
            '].command=this.value"></span>' +
            '<input type="number" min="1" max="50" value="' +
            r.spots +
            '" oninput="roles[' +
            i +
            '].spots=Number(this.value)">' +
            '<span class="acts"><button class="btn-sm" onclick="mvRole(' +
            i +
            ',-1)">↑</button><button class="btn-sm" onclick="mvRole(' +
            i +
            ',1)">↓</button><button class="btn-sm" onclick="rmRole(' +
            i +
            ')">✕</button></span></div>' +
            '<div class="rrow2"><span>Section</span><input type="text" list="groupList" value="' +
            q(r.group) +
            '" maxlength="30" placeholder="e.g. Overprep, Cooking, Helpers" oninput="roles[' +
            i +
            '].group=this.value"></div>' +
            '<div class="rrow2"><span>🧺 Must bring</span><input type="text" value="' +
            q(r.bring) +
            '" maxlength="200" placeholder="e.g. 50 Tomatoes + 10 Onions" oninput="roles[' +
            i +
            '].bring=this.value"></div></div>';
    });
    $('roles').innerHTML = h || '<div class="empty">No roles yet — add one.</div>';
}

function mvRole(i, d) {
    var j = i + d;
    if (j < 0 || j >= roles.length) return;
    var t = roles[i];
    roles[i] = roles[j];
    roles[j] = t;
    renderRoles();
}

function rmRole(i) {
    roles.splice(i, 1);
    renderRoles();
}

function addRole() {
    var last = roles[roles.length - 1];
    roles.push({
        emoji: '',
        label: '',
        command: '',
        spots: 2,
        group: last ? last.group : '',
        bring: ''
    });
    renderRoles();
}

function saveRoles() {
    for (var i = 0; i < roles.length; i++)
        if (!String(roles[i].command).replace(/[^a-z0-9_]/gi, '')) {
            toast('Every role needs a chat command');
            return;
        }
    act('/api/party/event', { id: cur, roles: roles }, 'Roles saved').then(function () {
        fillForm();
    });
}

function saveDetails() {
    act(
        '/api/party/event',
        {
            id: cur,
            title: $('title').value,
            when: $('when').value,
            subtitle: $('subtitle').value,
            open: $('open').checked
        },
        'Saved'
    );
}

function checkIn(k, on) {
    act(
        '/api/party/signup',
        { id: cur, key: k, checkedIn: on },
        on ? 'Signed in ✔' : 'Sign-in removed'
    );
}

// "7 PM" style: today at that time, or tomorrow if it already passed.

$('startTime').addEventListener('change', function () {
    var v = $('startTime').value;
    if (!v) return;
    $('startAt').value = toLocalInput(fromTime(Number(v.slice(0, 2)), Number(v.slice(3, 5))));
});
$('startAt').addEventListener('change', syncTime);

setInterval(cdText, 1000);

// Live preview while sliding: save after you stop moving for a moment.
var slideT = null;

// Upload: big pictures are shrunk in the browser first (max 2560 px wide) so they fit.

function makeLive() {
    var n = Number($('putBoard').value);
    act('/api/party/settings', { board: n, eventId: cur }, 'Now on Board ' + n + ' 📺');
}

function takeOff() {
    var n = null;
    A.events.forEach(function (x) {
        if (x.id === cur) n = x.slot;
    });
    if (n) act('/api/party/settings', { board: n, eventId: null }, 'Taken off Board ' + n);
}

function setBoard(n, id) {
    act(
        '/api/party/settings',
        { board: n, eventId: id || null },
        id ? 'Board ' + n + ' updated' : 'Board ' + n + ' cleared'
    );
}

function spotShow(n) {
    act('/api/party/settings', { spotShow: n }, 'Spotlight → Board ' + n);
}

function saveSpot() {
    act(
        '/api/party/settings',
        {
            spotRotateSec: Number($('spotRotate').value),
            spotHoldSec: Number($('spotHold').value),
            spotChat: $('spotChat').checked
        },
        'Spotlight saved'
    );
}

var spotFilled = false;
function renderBoards() {
    var a = document.activeElement;
    if (a && a.getAttribute && a.getAttribute('data-board')) return;
    var h = '';
    for (var n = 1; n <= 7; n++) {
        var id = A.slots[n - 1],
            o = '<option value="">— empty —</option>';
        A.events.forEach(function (x) {
            o +=
                '<option value="' +
                x.id +
                '"' +
                (x.id === id ? ' selected' : '') +
                '>' +
                esc(x.title || 'Untitled') +
                (x.when ? ' — ' + esc(x.when) : '') +
                '</option>';
        });
        h +=
            '<div class="brow"><b>Board ' +
            n +
            '</b><select data-board="' +
            n +
            '" onchange="setBoard(' +
            n +
            ',this.value)">' +
            o +
            '</select>' +
            '<button class="btn-sm" onclick="copyUrl(' +
            n +
            ')">Copy link</button>' +
            (id
                ? '<button class="btn-sm" onclick="spotShow(' + n + ')">📣 Spotlight</button>'
                : '<span></span>') +
            '</div>';
    }
    $('boards').innerHTML = h;
    var sp = A.spot || {};
    $('spotNow').textContent = sp.slot
        ? '— now showing Board ' +
          sp.slot +
          (sp.held ? ' (asked by ' + sp.by + ', ' + sp.leftSec + 's left)' : ' (rotating)')
        : '— no live boards';
    if (!spotFilled) {
        $('spotRotate').value = sp.rotateSec || 20;
        $('spotHold').value = sp.holdSec || 60;
        $('spotChat').checked = sp.chat !== false;
        spotFilled = true;
    }
}

function newEvent(copy) {
    act(
        '/api/party/event/new',
        copy ? { copyFrom: cur } : {},
        copy ? 'Event copied' : 'New event'
    ).then(function (d) {
        if (d) {
            cur = d.id;
            fillForm();
            render();
        }
    });
}

function delEvent() {
    var e = ev();
    if (!confirm('Delete "' + (e.title || 'this event') + '" and its sign-ups?')) return;
    act('/api/party/event', { id: cur, delete: true }, 'Deleted').then(function () {
        cur = A.liveId;
        fillForm();
        render();
    });
}

function sendTest() {
    api('/api/party/test', { name: $('tName').value, text: $('tText').value })
        .then(function (d) {
            $('tResult').textContent = d.result;
            load();
        })
        .catch(function (e) {
            $('tResult').textContent = e.message;
        });
}

$('panel').addEventListener('input', slideSave);
$('roleCards').addEventListener('input', slideSave);
$('bgImage').addEventListener('change', function () {
    showThumb('bgImage', 'bgThumb');
    saveLook();
});
$('titleImage').addEventListener('change', function () {
    showThumb('titleImage', 'titleThumb');
    saveLook();
});
$('bgFit').addEventListener('change', function () {
    saveLook();
});
$('border').addEventListener('change', function () {
    saveLook();
});
$('tText').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendTest();
});
$('evPick').addEventListener('change', function () {
    cur = $('evPick').value;
    fillForm();
    render();
});
['onDemand', 'showOnSignup'].forEach(function (id) {
    $(id).addEventListener('change', function () {
        var b = {};
        b[id] = $(id).checked;
        act('/api/party/settings', b, 'Saved');
    });
});
$('showSec').addEventListener('change', function () {
    act('/api/party/settings', { showSec: Number($('showSec').value) }, 'Saved');
});
['visible', 'showTwitch'].forEach(function (id) {
    $(id).addEventListener('change', function () {
        var b = {};
        b[id] = $(id).checked;
        act('/api/party/settings', b, 'Saved');
    });
});
$('open').addEventListener('change', function () {
    act(
        '/api/party/event',
        { id: cur, open: $('open').checked },
        $('open').checked ? 'Sign-ups open' : 'Sign-ups closed'
    );
});

function load() {
    return api('/api/party/admin')
        .then(function (d) {
            A = d;
            A.skew = (d.now || Date.now()) - Date.now();
            cdText();
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';
            if (
                !cur ||
                !A.full.some(function (e) {
                    return e.id === cur;
                })
            )
                cur = A.liveId;
            if (formFor !== cur) fillForm();
            var a = document.activeElement;
            if (a && a.tagName === 'SELECT' && a.hasAttribute('data-r')) return;
            render();
        })
        .catch(function () {
            $('health').textContent = 'ICB offline';
            $('health').className = 'health offline';
        });
}

load();
setInterval(load, 2000);
