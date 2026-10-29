// Turn Line dashboard (Baby, 2026-10-29). Operator page in Chrome, not a Meld layer.
var $ = function (id) {
    return document.getElementById(id);
};

var SWITCHES = ['visible', 'open', 'showHeader'];
var TEXTS = ['title', 'dish', 'joinWord', 'bgMode', 'bgFit', 'bgImage'];
var NUMBERS = ['turnsEach', 'font', 'bgOpacity', 'bgRadius'];
var COLORS = ['goColor', 'doneColor', 'waitColor', 'accent', 'bgColor'];
var STATE_LABEL = { wait: 'waiting', go: 'YOUR TURN', done: 'finished' };

/** Show a short message in the corner. */
function toast(t) {
    var e = $('toast');
    e.textContent = t;
    e.className = 'toast show';
    clearTimeout(e._t);
    e._t = setTimeout(function () {
        e.className = 'toast';
    }, 2000);
}

/** Escape text for safe use inside HTML. */
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/** Send a change to ICB and redraw from the answer. */
function post(body, msg) {
    return fetch('/api/turnline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            if (!d.ok) throw new Error(d.error);
            if (msg) toast(msg);
            drawQueue(d);
            return d;
        })
        .catch(function (e) {
            toast('⚠️ ' + e.message);
        });
}

/** A line button (Done, Undo, Skip, New round, Clear, Remove, Move). */
function act(body, msg) {
    return post(body, msg);
}

/** Add the typed name to the end of the line. */
function addName() {
    var v = $('addName').value.trim();
    if (!v) return;
    $('addName').value = '';
    post({ add: v }, 'Added');
}

/** Copy the Meld layer link. */
function copyUrl() {
    try {
        navigator.clipboard.writeText('http://127.0.0.1:8790/turn-line.html');
        toast('Copied');
    } catch (e) {}
}

/** Draw the names with their status and row buttons. */
function drawQueue(d) {
    var html = '';
    for (var i = 0; i < d.people.length; i++) {
        var p = d.people[i];
        html +=
            '<div class="qrow ' +
            esc(p.state) +
            '"><span class="nm">' +
            (i + 1) +
            '. ' +
            esc(p.name) +
            '</span><span class="st">' +
            STATE_LABEL[p.state] +
            '</span>' +
            '<button class="btn-sm" title="Move up" onclick="act({move:{id:' +
            p.id +
            ',dir:-1}})">▲</button>' +
            '<button class="btn-sm" title="Move down" onclick="act({move:{id:' +
            p.id +
            ',dir:1}})">▼</button>' +
            '<button class="btn-sm" title="Remove" onclick="act({remove:' +
            p.id +
            '})">✕</button></div>';
    }
    $('queue').innerHTML = html || '<div class="note">Nobody in line yet.</div>';
    var cur = d.people.filter(function (p) {
        return p.state === 'go';
    })[0];
    $('doneBtn').textContent = cur
        ? '✔ ' + cur.name + ' is done - next person'
        : '✔ Done - next person';
    $('cmdShow').textContent = '!' + d.joinWord;
}

/** Write each slider's value next to it. */
function labels() {
    $('fontV').textContent = $('font').value + 'px';
    $('bgOpacityV').textContent = $('bgOpacity').value + '%';
    $('bgRadiusV').textContent = $('bgRadius').value + 'px';
}

/** Fill the picture list from the files in assets/turn-line. */
function fillImages(d) {
    var sel = $('bgImage');
    var html = '<option value="">(none chosen)</option>';
    for (var i = 0; i < d.images.length; i++)
        html += '<option value="' + esc(d.images[i]) + '">' + esc(d.images[i]) + '</option>';
    sel.innerHTML = html;
    sel.value = d.bgImage;
}

/** Upload the chosen picture file and use it as the background. */
function uploadBg() {
    var f = $('bgFile').files[0];
    if (!f) return toast('Choose a picture first');
    var r = new FileReader();
    r.onload = function () {
        post({ upload: { name: f.name, data: r.result } }, 'Background set').then(function (d) {
            if (d) {
                fillImages(d);
                $('bgMode').value = 'image';
                $('bgFile').value = '';
            }
        });
    };

    r.readAsDataURL(f);
}

/** Gather the settings (not the line) from the page. */
function collect() {
    var body = {};
    SWITCHES.forEach(function (id) {
        body[id] = $(id).checked;
    });
    TEXTS.concat(COLORS).forEach(function (id) {
        body[id] = $(id).value;
    });
    NUMBERS.forEach(function (id) {
        body[id] = Number($(id).value);
    });
    return body;
}

var saveTimer = null;

/** Save shortly after a change instead of on every keystroke. */
function saveSoon() {
    labels();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
        post(collect(), 'Saved');
    }, 350);
}

/** Put saved settings into the controls (only when they are not being edited). */
function load(first) {
    return fetch('/api/turnline')
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';
            drawQueue(d);
            fillImages(d); // pictures dropped into the folder show up without a reload
            if (!first) return;
            SWITCHES.forEach(function (id) {
                $(id).checked = !!d[id];
            });
            TEXTS.concat(COLORS, NUMBERS).forEach(function (id) {
                $(id).value = d[id];
            });
            labels();
        })
        .catch(function () {
            $('health').textContent = 'ICB offline';
            $('health').className = 'health offline';
        });
}

SWITCHES.concat(TEXTS, NUMBERS, COLORS).forEach(function (id) {
    $(id).addEventListener(id === 'font' ? 'input' : 'change', saveSoon);
});
load(true);
setInterval(function () {
    load(false); // chat sign-ups arrive on their own, so keep the list fresh
}, 3000);
