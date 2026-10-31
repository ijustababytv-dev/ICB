function $(id) {
    return document.getElementById(id);
}

function api(p, b) {
    return fetch(
        p,
        b === undefined
            ? {}
            : {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(b)
              }
    ).then(function (r) {
        return r.json();
    });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}

var THEMES = {
    flowtree: {
        n: 'Flow tree',
        accent1: '#38bdf8',
        accent2: '#c084fc',
        textColor: '#ffffff',
        plate: '#1c1130',
        plateAlpha: 92,
        font: 'Outfit'
    },
    spooky: {
        n: 'Spooky',
        accent1: '#ff8a2a',
        accent2: '#8b5cf6',
        textColor: '#fff3e0',
        plate: '#120a1f',
        plateAlpha: 94,
        font: 'Creepster'
    },
    pink: {
        n: 'Cute pink',
        accent1: '#ff8fd8',
        accent2: '#b77cff',
        textColor: '#ffffff',
        plate: '#3a1240',
        plateAlpha: 88,
        font: 'Chewy'
    },
    gold: {
        n: 'Palia gold',
        accent1: '#fbbf24',
        accent2: '#34d399',
        textColor: '#fffbeb',
        plate: '#1a2416',
        plateAlpha: 90,
        font: 'Comfortaa'
    },
    fortnite: {
        n: 'Fortnite',
        accent1: '#3fb6ff',
        accent2: '#ffd200',
        textColor: '#ffffff',
        plate: '#0a1a3a',
        plateAlpha: 92,
        font: 'Bungee'
    },
    glass: {
        n: 'Glass',
        accent1: '#e0f2fe',
        accent2: '#93c5fd',
        textColor: '#ffffff',
        plate: '#0f172a',
        plateAlpha: 45,
        font: 'Quicksand'
    },
    custom: { n: 'Custom' }
};
var L = [],
    cur = null,
    off = 0,
    filledFor = null,
    timers = {};
function C() {
    return L.filter(function (c) {
        return c.id === cur;
    })[0];
}

function scalePrev() {
    $('pf').style.transform = 'scale(' + $('prev').clientWidth / 1920 + ')';
}

window.addEventListener('resize', scalePrev);
function copyUrl() {
    $('url').select();
    try {
        navigator.clipboard.writeText($('url').value);
    } catch (e) {
        document.execCommand('copy');
    }
}

function save(set) {
    return api('/api/countdowns', { id: cur, set: set }).then(load);
}

function saveSoon(k, v) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
        var o = {};
        o[k] = v;
        save(o);
    }, 250);
}

function act(a, extra) {
    var b = { id: cur, action: a };
    for (var k in extra || {}) b[k] = extra[k];
    return api('/api/countdowns', b).then(load);
}

function showVal(k, v) {
    var s = document.querySelector('[data-v="' + k + '"]');
    if (s) s.textContent = v + (s.getAttribute('data-u') || '');
}

// inputs
[].forEach.call(document.querySelectorAll('[data-k]'), function (el) {
    var k = el.getAttribute('data-k');
    if (el.type === 'checkbox')
        el.onchange = function () {
            save(o1(k, el.checked));
        };

    else if (el.type === 'range')
        el.oninput = function () {
            showVal(k, el.value);
            saveSoon(k, Number(el.value));
        };

    else if (el.type === 'color')
        el.oninput = function () {
            var o = o1(k, el.value);
            o.theme = 'custom';
            clearTimeout(timers.c);
            timers.c = setTimeout(function () {
                save(o);
            }, 200);
        };

    else if (el.tagName === 'SELECT')
        el.onchange = function () {
            save(o1(k, el.value));
        };

    else
        el.oninput = function () {
            saveSoon(k, el.value);
        };
});
function o1(k, v) {
    var o = {};
    o[k] = v;
    return o;
}

$('fontSel').innerHTML = [
    'Outfit',
    'Comfortaa',
    'Fredoka',
    'Chewy',
    'Creepster',
    'Bungee',
    'Quicksand',
    'Orbitron'
]
    .map(function (f) {
        return '<option style="font-family:' + f + '">' + f + '</option>';
    })
    .join('');
$('themes').innerHTML = Object.keys(THEMES)
    .map(function (k) {
        var t = THEMES[k];
        return (
            '<div class="th" data-t="' +
            k +
            '" onclick="pickTheme(\'' +
            k +
            '\')" style="background:#15151c"><i style="background:' +
            (t.accent1
                ? 'linear-gradient(90deg,' + t.accent1 + ',' + t.accent2 + ')'
                : 'repeating-linear-gradient(45deg,#444,#444 6px,#2a2a33 6px,#2a2a33 12px)') +
            '"></i>' +
            t.n +
            '</div>'
        );
    })
    .join('');
function pickTheme(k) {
    var t = THEMES[k],
        o = { theme: k };
    if (t.accent1) {
        o.accent1 = t.accent1;
        o.accent2 = t.accent2;
        o.textColor = t.textColor;
        o.plate = t.plate;
        o.plateAlpha = t.plateAlpha;
        o.font = t.font;
    }
    filledFor = null;
    save(o);
}

var spots = [
        [8, 10],
        [50, 10],
        [92, 10],
        [8, 50],
        [50, 50],
        [92, 50],
        [8, 90],
        [50, 90],
        [92, 90]
    ],
    arrows = ['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘'];
$('grid9').innerHTML = spots
    .map(function (p, i) {
        return '<button onclick="spot(' + i + ')">' + arrows[i] + '</button>';
    })
    .join('');
function spot(i) {
    var c = C(),
        k = (c.scale || 100) / 100,
        w = 13 * k,
        h = 9 * k; // keep the card on screen
    var x = Math.max(w, Math.min(100 - w, spots[i][0])),
        y = Math.max(h, Math.min(100 - h, spots[i][1]));
    filledFor = null;
    save({ x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 });
}

function preset(a, b, c) {
    filledFor = null;
    save({ heading: a, subheading: b, endText: c });
}

// timer actions
function setMins(m) {
    $('mins').value = m;
    startMins();
}

function startMins() {
    var m = Number($('mins').value) || 0;
    if (m <= 0) return;
    save({ lastMinutes: m });
    act('start', { ms: m * 60000 });
}

function zoned(y, mo, d, h, mi, tz) {
    // wall-clock time in a time zone -> real instant
    var guess = Date.UTC(y, mo, d, h, mi),
        p = parts(guess, tz),
        asUtc = Date.UTC(p.y, p.mo, p.d, p.h, p.mi);
    return guess - (asUtc - guess);
}

function parts(t, tz) {
    var o = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    })
        .formatToParts(new Date(t))
        .forEach(function (p) {
            o[p.type] = Number(p.value);
        });
    return { y: o.year, mo: o.month - 1, d: o.day, h: o.hour % 24, mi: o.minute };
}

function startClock() {
    var v = $('clock').value,
        tz = $('tz').value;
    if (!v) return alert('Pick a time first.');
    var hm = v.split(':'),
        now = Date.now() + off,
        p = parts(now, tz),
        t = zoned(p.y, p.mo, p.d, Number(hm[0]), Number(hm[1]), tz);
    if (t <= now) t = zoned(p.y, p.mo, p.d + 1, Number(hm[0]), Number(hm[1]), tz);
    save({ lastTime: v, lastTz: tz });
    act('start', { endsAt: t });
}

function pauseResume() {
    var c = C();
    act(c.status === 'paused' ? 'resume' : 'pause');
}

// countdowns
function addCd(copy) {
    var n = $('newName').value.trim() || (copy ? C().name + ' copy' : 'Countdown');
    api('/api/countdowns', { add: { name: n, copyFrom: copy ? cur : null } }).then(function (r) {
        $('newName').value = '';
        cur = r.id;
        filledFor = null;
        load();
    });
}

function removeCd() {
    if (L.length < 2) return alert('You need at least one countdown.');
    if (confirm('Delete "' + C().name + '"?'))
        api('/api/countdowns', { remove: cur }).then(function () {
            cur = null;
            load();
        });
}

function fill(c) {
    [].forEach.call(document.querySelectorAll('[data-k]'), function (el) {
        var k = el.getAttribute('data-k');
        if (c[k] === undefined) return;
        if (el.type === 'checkbox') el.checked = !!c[k];
        else el.value = c[k];
        if (el.type === 'range') showVal(k, c[k]);
    });
    $('mins').value = c.lastMinutes || 10;
    $('clock').value = c.lastTime || '19:00';
    $('tz').value = c.lastTz || 'America/Chicago';
}

function two(n) {
    return (n < 10 ? '0' : '') + n;
}

function showLeft() {
    var c = C();
    if (!c) return;
    var now = Date.now() + off,
        left = c.status === 'running' ? c.endsAt - now : c.status === 'paused' ? c.leftMs : 0,
        st = c.status;
    if (st === 'running' && left <= 0) st = 'done';
    var s = Math.max(0, Math.ceil(left / 1000)),
        h = Math.floor(s / 3600),
        m = Math.floor((s % 3600) / 60);
    $('left').textContent =
        st === 'idle'
            ? '--:--'
            : st === 'done'
            ? c.endText
            : (h ? h + ':' + two(m) : m) + ':' + two(s % 60);
    $('state').textContent =
        st === 'running'
            ? 'running'
            : st === 'paused'
            ? 'paused'
            : st === 'done'
            ? "time's up"
            : 'idle';
    $('state').style.background =
        st === 'running'
            ? '#1f4d33'
            : st === 'paused'
            ? '#4d3d1f'
            : st === 'done'
            ? '#4a1f40'
            : '#2a2a35';
    $('pauseBtn').textContent = c.status === 'paused' ? '▶ Resume' : '⏸ Pause';
}

setInterval(showLeft, 250);
function load() {
    return api('/api/countdowns')
        .then(function (d) {
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';
            L = d.list;
            off = d.now - Date.now();
            if (!cur || !C()) cur = L[0].id;
            $('tabs').innerHTML = L.map(function (c) {
                return (
                    '<button class="tab' +
                    (c.id === cur ? ' on' : '') +
                    '" onclick="pick(\'' +
                    c.id +
                    '\')">⏳ ' +
                    esc(c.name) +
                    '</button>'
                );
            }).join('');
            var c = C();
            var u = location.origin + '/countdown.html?id=' + encodeURIComponent(c.id);
            if ($('url').value !== u) {
                $('url').value = u;
                $('pf').src = '/countdown.html?id=' + encodeURIComponent(c.id);
                scalePrev();
            }
            if (filledFor !== c.id) {
                fill(c);
                filledFor = c.id;
            } else {
                var ae = document.activeElement;
                [].forEach.call(document.querySelectorAll('[data-k]'), function (el) {
                    var k = el.getAttribute('data-k');
                    if (el !== ae && el.tagName === 'SELECT') el.value = c[k];
                    if (el.type === 'color' && el !== ae) el.value = c[k];
                });
            }
            [].forEach.call(document.querySelectorAll('.th'), function (t) {
                t.className = 'th' + (t.getAttribute('data-t') === c.theme ? ' on' : '');
            });
            showLeft();
        })
        .catch(function () {
            $('health').textContent = 'ICB offline — run restart-icb-clean.bat';
            $('health').className = 'health offline';
        });
}

function pick(id) {
    cur = id;
    filledFor = null;
    load();
}

load();
setInterval(load, 3000);
