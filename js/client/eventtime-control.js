var $ = function (id) {
    return document.getElementById(id);
};

var TZS = [
    ['America/Los_Angeles', 'Pacific (Los Angeles)'],
    ['America/Denver', 'Mountain (Denver)'],
    ['America/Phoenix', 'Arizona (no DST)'],
    ['America/Chicago', 'Central (Chicago)'],
    ['America/New_York', 'Eastern (New York)'],
    ['America/Halifax', 'Atlantic (Halifax)'],
    ['America/Anchorage', 'Alaska'],
    ['Pacific/Honolulu', 'Hawaii'],
    ['America/Sao_Paulo', 'Brazil (São Paulo)'],
    ['Etc/GMT', 'GMT +0 (fixed)'],
    ['Etc/GMT-1', 'GMT +1 (fixed)'],
    ['Etc/GMT-2', 'GMT +2 (fixed)'],
    ['Etc/GMT-3', 'GMT +3 (fixed)'],
    ['Europe/London', 'UK (London)'],
    ['Europe/Paris', 'Central Europe (Paris/Berlin)'],
    ['Europe/Athens', 'Eastern Europe (Athens)'],
    ['Asia/Kolkata', 'India'],
    ['Asia/Manila', 'Philippines'],
    ['Asia/Tokyo', 'Japan'],
    ['Australia/Sydney', 'Australia (Sydney)'],
    ['Pacific/Auckland', 'New Zealand']
];
var S = null,
    zones = [];
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}

function toast(t) {
    var e = $('toast');
    e.textContent = t;
    e.className = 'toast show';
    clearTimeout(e._t);
    e._t = setTimeout(function () {
        e.className = 'toast';
    }, 2200);
}

function copyUrl() {
    try {
        navigator.clipboard.writeText('http://127.0.0.1:8790/eventtime.html');
        toast('Copied');
    } catch (e) {}
}

function tzOptions(sel) {
    var h = '',
        found = false;
    TZS.forEach(function (t) {
        if (t[0] === sel) found = true;
        h +=
            '<option value="' +
            t[0] +
            '"' +
            (t[0] === sel ? ' selected' : '') +
            '>' +
            esc(t[1]) +
            '</option>';
    });
    if (!found && sel)
        h = '<option value="' + esc(sel) + '" selected>' + esc(sel) + '</option>' + h;
    return h;
}

function post(body, msg) {
    return fetch('/api/eventtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            if (!d.ok) throw new Error(d.error);
            S = d;
            renderConv();
            if (msg) toast(msg);
            refreshPreview();
            return d;
        })
        .catch(function (e) {
            toast('⚠️ ' + e.message);
        });
}

function refreshPreview() {
    /* overlay polls by itself */
}

function abbr(ms, tz) {
    try {
        var p = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            timeZoneName: 'short'
        }).formatToParts(new Date(ms));
        for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value;
    } catch (e) {}
    return tz;
}

function renderConv() {
    if (!S || !S.at) {
        $('conv').innerHTML =
            '<div class="note">Pick a date and time, then press Show on stream.</div>';
        return;
    }
    var h = '';
    S.zones.forEach(function (z) {
        if (!z.visible) return;
        var t = new Intl.DateTimeFormat('en-US', {
            timeZone: z.tz,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(new Date(S.at));
        h +=
            '<div><b>' + esc(z.label || abbr(S.at, z.tz)) + '</b><span>' + esc(t) + '</span></div>';
    });
    $('conv').innerHTML = '<div class="note" style="border:none">What chat will see:</div>' + h;
}

function renderZones() {
    var h = '';
    zones.forEach(function (z, i) {
        h +=
            '<div class="zrow"><input type="checkbox" ' +
            (z.visible ? 'checked' : '') +
            ' onchange="zones[' +
            i +
            '].visible=this.checked" title="Show">' +
            '<input type="text" value="' +
            esc(z.label) +
            '" placeholder="auto" maxlength="30" oninput="zones[' +
            i +
            '].label=this.value">' +
            '<select onchange="zones[' +
            i +
            '].tz=this.value">' +
            tzOptions(z.tz) +
            '</select>' +
            '<span class="acts"><button class="btn-sm" onclick="mv(' +
            i +
            ',-1)">↑</button><button class="btn-sm" onclick="mv(' +
            i +
            ',1)">↓</button><button class="btn-sm" onclick="rm(' +
            i +
            ')">✕</button></span></div>';
    });
    $('zones').innerHTML = h;
}

function mv(i, d) {
    var j = i + d;
    if (j < 0 || j >= zones.length) return;
    var t = zones[i];
    zones[i] = zones[j];
    zones[j] = t;
    renderZones();
}

function rm(i) {
    zones.splice(i, 1);
    renderZones();
}

function addZone() {
    if (zones.length >= 12) return;
    zones.push({ label: '', tz: 'Europe/London', visible: true });
    renderZones();
}

function saveZones() {
    post({ zones: zones }, 'Zones saved');
}

function pad(n) {
    return ('0' + n).slice(-2);
}

function setDay(add) {
    var tz = $('sourceTz').value,
        now = new Date(Date.now() + add * 86400000);
    var p = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    })
        .formatToParts(now)
        .forEach(function (x) {
            p[x.type] = x.value;
        });
    $('date').value = p.year + '-' + p.month + '-' + p.day;
}

function save() {
    if (!$('date').value || !$('time').value) {
        toast('Pick a date and a time');
        return;
    }
    post(
        {
            title: $('title').value,
            subtitle: $('subtitle').value,
            date: $('date').value,
            time: $('time').value,
            sourceTz: $('sourceTz').value,
            visible: true
        },
        'On stream!'
    ).then(function () {
        $('visible').checked = true;
    });
}

['visible', 'showCountdown'].forEach(function (id) {
    $(id).addEventListener('change', function () {
        var b = {};
        b[id] = $(id).checked;
        post(b, 'Saved');
    });
});
$('layout').addEventListener('change', function () {
    post({ layout: $('layout').value }, 'Saved');
});
$('title').addEventListener('change', function () {
    post({ title: $('title').value }, 'Saved');
});
$('subtitle').addEventListener('change', function () {
    post({ subtitle: $('subtitle').value }, 'Saved');
});

fetch('/api/eventtime')
    .then(function (r) {
        return r.json();
    })
    .then(function (d) {
        S = d;
        $('health').textContent = 'ICB connected';
        $('title').value = d.title || '';
        $('subtitle').value = d.subtitle || '';
        $('date').value = d.date || '';
        $('time').value = d.time || '';
        $('sourceTz').innerHTML = tzOptions(d.sourceTz);
        $('visible').checked = d.visible;
        $('showCountdown').checked = d.showCountdown;
        $('layout').value = d.layout;
        zones = d.zones.map(function (z) {
            return { label: z.label, tz: z.tz, visible: z.visible };
        });
        renderZones();
        renderConv();
    })
    .catch(function () {
        $('health').textContent = 'ICB offline';
        $('health').className = 'health offline';
    });
