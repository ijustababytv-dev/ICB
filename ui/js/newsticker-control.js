var $ = function (id) {
    return document.getElementById(id);
};

var S = null,
    msgs = [];
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

function post(b, msg) {
    return fetch('/api/newsticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(b)
    })
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            if (!d.ok) throw new Error(d.error);
            if (msg) toast(msg);
            return d;
        })
        .catch(function (e) {
            toast('⚠️ ' + e.message);
        });
}

function copyUrl() {
    try {
        navigator.clipboard.writeText('http://127.0.0.1:8790/newsticker.html');
        toast('Copied');
    } catch (e) {}
}

function renderMsgs() {
    var h = '';
    msgs.forEach(function (m, i) {
        h +=
            '<div class="mrow' +
            (m.on ? '' : ' off') +
            '"><input type="checkbox" ' +
            (m.on ? 'checked' : '') +
            ' onchange="msgs[' +
            i +
            '].on=this.checked;renderMsgs()" title="Show this message">' +
            '<input type="text" value="' +
            esc(m.text) +
            '" maxlength="300" oninput="msgs[' +
            i +
            '].text=this.value">' +
            '<span class="acts"><button class="btn-sm" onclick="mv(' +
            i +
            ',-1)">↑</button><button class="btn-sm" onclick="mv(' +
            i +
            ',1)">↓</button><button class="btn-sm" onclick="rm(' +
            i +
            ')">✕</button></span></div>';
    });
    $('msgs').innerHTML = h || '<div class="note">No messages yet — add one below.</div>';
}

function mv(i, d) {
    var j = i + d;
    if (j < 0 || j >= msgs.length) return;
    var t = msgs[i];
    msgs[i] = msgs[j];
    msgs[j] = t;
    renderMsgs();
}

function rm(i) {
    msgs.splice(i, 1);
    renderMsgs();
}

function addMsg() {
    var t = $('newMsg').value.trim();
    if (!t) return;
    msgs.push({ text: t, on: true });
    $('newMsg').value = '';
    renderMsgs();
    saveMsgs();
}

function saveMsgs() {
    post({ messages: msgs }, 'Messages saved').then(function (d) {
        if (d) load();
    });
}

$('newMsg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addMsg();
});

function sendAlert() {
    var t = $('alertText').value.trim();
    if (!t) {
        toast('Type the alert first');
        return;
    }
    post(
        { alert: { text: t, seconds: Number($('alertSec').value), color: $('alertColor').value } },
        'Alert is on stream ⚠️'
    ).then(load);
}

function stopAlert() {
    post({ alert: null }, 'Alert stopped').then(load);
}

function slid() {
    $('gapV').textContent = $('gap').value + 's';
    $('speedV').textContent = $('speed').value;
    $('fontV').textContent = $('font').value + 'px';
    $('barOpacityV').textContent = 100 - Number($('barOpacity').value) + '%';
}

var lookT = null;
function lookSave() {
    slid();
    clearTimeout(lookT);
    lookT = setTimeout(function () {
        post(
            {
                visible: $('visible').checked,
                showLabel: $('showLabel').checked,
                label: $('label').value,
                separator: $('separator').value,
                speed: Number($('speed').value),
                gap: Number($('gap').value),
                font: Number($('font').value),
                barOpacity: Number($('barOpacity').value),
                barColor: $('barColor').value,
                textColor: $('textColor').value,
                labelColor: $('labelColor').value,
                labelText: $('labelText').value,
                accent: $('accent').value
            },
            'Saved'
        );
    }, 300);
}

[
    'visible',
    'showLabel',
    'label',
    'gap',
    'speed',
    'font',
    'barOpacity',
    'barColor',
    'textColor',
    'labelColor',
    'labelText',
    'accent'
].forEach(function (id) {
    $(id).addEventListener(/^(label|separator)$/.test(id) ? 'change' : 'input', lookSave);
});

function load() {
    return fetch('/api/newsticker/admin')
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            S = d;
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';
            if (!msgs.length || load.first !== false) {
                msgs = d.all.map(function (m) {
                    return { id: m.id, text: m.text, on: m.on };
                });
                renderMsgs();
            }
            if (load.first !== false) {
                $('visible').checked = d.visible;
                $('showLabel').checked = d.showLabel;
                $('label').value = d.label;
                $('separator').value = d.separator;
                $('speed').value = d.speed;
                $('gap').value = d.gap === undefined ? 1 : d.gap;
                $('font').value = d.font;
                $('barOpacity').value = d.barOpacity;
                $('barColor').value = d.barColor;
                $('textColor').value = d.textColor;
                $('labelColor').value = d.labelColor;
                $('labelText').value = d.labelText;
                $('accent').value = d.accent;
                $('alertColor').value = d.alertRaw.color || '#ff4655';
                slid();
            }
            load.first = false;
            $('alertLive').textContent = d.alert
                ? '● on stream · ' + d.alert.leftSec + 's left'
                : '';
        })
        .catch(function () {
            $('health').textContent = 'ICB offline';
            $('health').className = 'health offline';
        });
}

load();
setInterval(load, 3000);
