// Animated Overlay dashboard (Baby, 2026-10-25). Operator page in Chrome, not a Meld layer.
var $ = function (id) {
    return document.getElementById(id);
};

// Each slider: [element id, divide-by for the saved value, label format].
var SLIDERS = [
    ['glowStrength', 1, '%'],
    ['glowSpeed', 10, '×'],
    ['flickerRate', 1, ''],
    ['chaserSpeed', 10, '×'],
    ['chaserLength', 1, '%'],
    ['chaserOffset', 1, 'px'],
    ['chamfer', 1, 'px'],
    ['sunShimmer', 1, '%'],
    ['starTwinkle', 1, '%'],
    ['sparkles', 1, '%'],
    ['sunX', 10, '%'],
    ['sunY', 10, '%'],
    ['sunR', 10, '%'],
    ['hueShift', 1, '°'],
    ['cycleSpeed', 1, 's'],
    ['reactionStrength', 10, '×']
];
var SWITCHES = ['visible', 'introOnLoad', 'glow', 'flicker', 'chaser', 'sun', 'stars'];
var REACTIONS = ['follow', 'sub', 'gifts', 'bits', 'raid'];

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
    return fetch('/api/streamframe', {
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

/** Copy the Meld overlay link. */
function copyUrl() {
    try {
        navigator.clipboard.writeText('http://127.0.0.1:8790/stream-frame.html');
        toast('Copied');
    } catch (e) {}
}

/** Write each slider's value next to it. */
function labels() {
    SLIDERS.forEach(function (s) {
        var v = Number($(s[0]).value) / s[1];
        $(s[0] + 'V').textContent = (s[1] > 1 ? v.toFixed(1) : v) + s[2];
    });
    $('flickerRateV').textContent =
        $('flickerRate').value === '0' ? 'never' : $('flickerRate').value;
}

/** Gather every setting on the page. */
function collect() {
    var body = {
        chaserColor: $('chaserColor').value,
        chaserCount: Number($('chaserCount').value),
        colorMode: $('colorMode').value,
        reactions: {}
    };
    SWITCHES.forEach(function (id) {
        body[id] = $(id).checked;
    });
    SLIDERS.forEach(function (s) {
        body[s[0]] = Number($(s[0]).value) / s[1];
    });
    REACTIONS.forEach(function (r) {
        body.reactions[r] = $('r_' + r).checked;
    });
    return body;
}

var saveTimer = null;

/** Save shortly after a slider stops moving instead of on every step. */
function saveSoon() {
    labels();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
        post(collect(), 'Saved');
    }, 300);
}

/** Make one particular reaction happen now so it can be previewed. */
function test(type) {
    post({ test: type }, 'Testing ' + type);
}

/** Upload a new overlay picture; the overlay swaps to it within two seconds. */
function uploadArt() {
    var file = $('artFile').files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('That picture is too large (max 15 MB)');
    var reader = new FileReader();
    reader.onload = function (e) {
        post(
            { uploadArt: { name: file.name, image: e.target.result } },
            'Overlay picture updated'
        ).then(function () {
            $('artFile').value = '';
            load();
        });
    };

    reader.readAsDataURL(file);
}

/** Put saved settings into the page controls. */
function load() {
    return fetch('/api/streamframe')
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
                $(s[0]).value = Math.round(d[s[0]] * s[1]);
            });
            REACTIONS.forEach(function (r) {
                $('r_' + r).checked = !!(d.reactions && d.reactions[r]);
            });
            $('chaserColor').value = d.chaserColor;
            $('chaserCount').value = String(d.chaserCount);
            $('colorMode').value = d.colorMode;
            $('artName').textContent = d.art;
            $('artWarn').style.display = d.artFound ? 'none' : 'block';
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
SWITCHES.concat(['chaserColor', 'chaserCount', 'colorMode']).forEach(function (id) {
    $(id).addEventListener('change', saveSoon);
});
REACTIONS.forEach(function (r) {
    $('r_' + r).addEventListener('change', saveSoon);
});
load();
