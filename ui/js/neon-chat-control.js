// Neon Chat dashboard (Baby, 2026-10-25). Operator page in Chrome, not a Meld layer.
var $ = function (id) {
    return document.getElementById(id);
};

// Each slider: [element id, label format].
var SLIDERS = [
    ['textSize', 'px'],
    ['glow', '%'],
    ['bgOpacity', '%'],
    ['hueShift', '°'],
    ['maxMessages', ''],
    ['fadeSec', 's']
];
var SWITCHES = [
    'visible',
    'showFrame',
    'frameOnlyWithChat',
    'showTitle',
    'sparkles',
    'newestOnTop',
    'hideCommands',
    'hideMe',
    'useTwitchColors',
    'showBadges'
];
var ROLES = ['streamer', 'mod', 'vip', 'sub', 'viewer'];
var EVENTS = ['follow', 'sub', 'gifts', 'bits', 'raid'];

/** Show a short message in the corner. */
function toast(t) {
    var e = $('toast');
    e.textContent = t;
    e.className = 'toast show';
    clearTimeout(e._t);
    e._t = setTimeout(function () {
        e.className = 'toast';
    }, 2200);
}

/** Send a change to ICB; shows a toast with the message or the error. */
function post(body, msg) {
    return fetch('/api/neonchat', {
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
            return d;
        })
        .catch(function (e) {
            toast('⚠️ ' + e.message);
        });
}

/** Copy the Meld layer link. */
function copyUrl() {
    try {
        navigator.clipboard.writeText('http://127.0.0.1:8790/neon-chat.html');
        toast('Copied');
    } catch (e) {}
}

/** Add a sample follow / sub / gifts / bits / raid line. */
function testEvent(type) {
    post({ testEvent: type }, 'Test ' + type + ' sent');
}

/** Make the inside of the chat box fully see-through (only the neon frame shows). */
function setTransparent() {
    $('bgOpacity').value = 0;
    saveSoon();
}

/** Put the background back to a solid, easy-to-read panel. */
function setSolid() {
    $('bgOpacity').value = 88;
    saveSoon();
}

/** Write each slider's value next to it. */
function labels() {
    SLIDERS.forEach(function (s) {
        $(s[0] + 'V').textContent = $(s[0]).value + s[1];
    });
    if ($('fadeSec').value === '0') $('fadeSecV').textContent = 'always';
    if ($('bgOpacity').value === '0') $('bgOpacityV').textContent = 'clear';
    $('c_viewer').disabled = $('viewerNeon').checked;
}

/** Gather every setting on the page. */
function collect() {
    var body = {
        title: $('title').value,
        streamerName: $('streamerName').value,
        nameFont: $('nameFont').value,
        bgColor: $('bgColor').value,
        hideNames: $('hideNames').value,
        roleColors: {},
        events: {}
    };
    SWITCHES.forEach(function (id) {
        body[id] = $(id).checked;
    });
    SLIDERS.forEach(function (s) {
        body[s[0]] = Number($(s[0]).value);
    });
    ROLES.forEach(function (r) {
        body.roleColors[r] = $('c_' + r).value;
    });
    if ($('viewerNeon').checked) body.roleColors.viewer = ''; // mixed neon palette
    EVENTS.forEach(function (e) {
        body.events[e] = $('e_' + e).checked;
    });
    return body;
}

var saveTimer = null;

/** Save shortly after a change instead of on every slider step. */
function saveSoon() {
    labels();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
        post(collect(), 'Saved');
    }, 350);
}

/** Put saved settings into the page controls. */
function load() {
    return fetch('/api/neonchat?since=999999999')
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';
            SWITCHES.forEach(function (id) {
                $(id).checked = !!d[id];
            });
            SLIDERS.forEach(function (s) {
                $(s[0]).value = d[s[0]];
            });
            ROLES.forEach(function (r) {
                if (d.roleColors[r]) $('c_' + r).value = d.roleColors[r];
            });
            $('viewerNeon').checked = !d.roleColors.viewer;
            EVENTS.forEach(function (e) {
                $('e_' + e).checked = !!d.events[e];
            });
            $('title').value = d.title;
            $('streamerName').value = d.streamerName;
            $('nameFont').value = d.nameFont;
            $('bgColor').value = d.bgColor;
            $('hideNames').value = (d.hideNames || []).join(', ');
            labels();
        })
        .catch(function () {
            $('health').textContent = 'ICB offline';
            $('health').className = 'health offline';
        });
}

SLIDERS.forEach(function (s) {
    $(s[0]).addEventListener('input', saveSoon);
});
SWITCHES.concat(['viewerNeon', 'bgColor', 'nameFont', 'title', 'streamerName', 'hideNames'])
    .concat(
        ROLES.map(function (r) {
            return 'c_' + r;
        }),
        EVENTS.map(function (e) {
            return 'e_' + e;
        })
    )
    .forEach(function (id) {
        $(id).addEventListener('change', saveSoon);
    });
load();
