/** Shorthand for getElementById. */
var $ = function (id) {
    return document.getElementById(id);
};

var S = null;

/** Escape text for safe use inside HTML. */
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}

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
function post(b, msg) {
    return fetch('/api/oceanfish', {
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

/** Copy the Meld overlay link. */
function copyUrl() {
    try {
        navigator.clipboard.writeText('http://127.0.0.1:8790/ocean-fish.html');
        toast('Copied');
    } catch (e) {}
}

/* ---------- slider labels ---------- */
function slid() {
    $('fishSizeV').textContent = $('fishSize').value + 'px';
    $('jumpHeightV').textContent = $('jumpHeight').value + '%';
    $('jumpSpeedV').textContent = ($('jumpSpeed').value / 10).toFixed(1) + '×';
    $('jumpEveryV').textContent = $('jumpEvery').value + 's';
    $('jumpCountV').textContent = $('jumpCount').value + ' fish';
    $('jumpSpreadV').textContent =
        $('jumpSpread').value === '0'
            ? 'all at once'
            : ($('jumpSpread').value / 10).toFixed(1) + 's';
    $('jumpSpread').disabled = $('jumpCount').value === '1';
    $('varietyV').textContent = (($('variety').value / 10) * 100).toFixed(0) + '%';
    $('waveSpeedV').textContent = ($('waveSpeed').value / 10).toFixed(1) + '×';
    $('waveHeightV').textContent = ($('waveHeight').value / 10).toFixed(1) + '×';
    $('sparklesV').textContent = $('sparkles').value;
    $('showSecV').textContent = $('showSec').value + 's';
    toggleOnDemand();
}

/** Only show the on-demand options while on-demand mode is on. */
function toggleOnDemand() {
    var on = $('onDemand').checked;
    $('onDemandOpts').style.display = on ? 'flex' : 'none';
    $('showOnJumpRow').style.display = on ? 'flex' : 'none';
    $('showHideRow').style.display = on ? 'flex' : 'none';
}

/* ---------- save (debounced for sliders, instant for checkboxes/selects) ---------- */
var saveT = null;

/** Save shortly after a slider stops moving instead of on every step. */
function saveLater() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
        save();
    }, 300);
}

/** Send every look and timing setting to ICB. */
function save() {
    clearTimeout(saveT);
    var bgRadio = document.querySelector('input[name="bg"]:checked');
    post(
        {
            visible: $('visible').checked,
            onDemand: $('onDemand').checked,
            showSec: Number($('showSec').value),
            showOnJump: $('showOnJump').checked,
            fishSize: Number($('fishSize').value),
            autoJump: $('autoJump').checked,
            jumpHeight: Number($('jumpHeight').value) / 100,
            jumpSpeed: Number($('jumpSpeed').value) / 10,
            jumpEvery: Number($('jumpEvery').value),
            jumpCount: Number($('jumpCount').value),
            jumpSpread: Number($('jumpSpread').value) / 10,
            variety: Number($('variety').value) / 10,
            splash: $('splash').checked,
            directions: $('directions').value,
            waveSpeed: Number($('waveSpeed').value) / 10,
            waveHeight: Number($('waveHeight').value) / 10,
            sparkles: Number($('sparkles').value),
            gold: $('gold').checked,
            bg: bgRadio ? Number(bgRadio.value) : 3,
            pick: $('pick').value
        },
        'Saved'
    );
}

/* ---------- fish pictures ---------- */
function readAsDataUrl(file) {
    return new Promise(function (ok, bad) {
        var r = new FileReader();
        r.onload = function (e) {
            ok(e.target.result);
        };

        r.onerror = function () {
            bad(new Error('Could not read ' + file.name));
        };

        r.readAsDataURL(file);
    });
}

/** Add each chosen picture as a new fish, one after another. */
function uploadFish() {
    var files = Array.prototype.slice.call($('fishFile').files || []);
    if (!files.length) return;
    var chain = Promise.resolve(),
        added = 0;
    files.forEach(function (file) {
        chain = chain.then(function () {
            if (file.size > 8 * 1024 * 1024) {
                toast(file.name + ' is too large (max 8 MB)');
                return;
            }
            return readAsDataUrl(file).then(function (data) {
                return post({ addFish: { name: file.name, image: data } }).then(function (d) {
                    if (d) added++;
                });
            });
        });
    });
    chain
        .then(function () {
            $('fishFile').value = '';
            if (added) toast(added === 1 ? 'Fish added 🐟' : added + ' fish added 🐟');
            load();
        })
        .catch(function (e) {
            toast('⚠️ ' + e.message);
        });
}

/** Add a fish from a picture link (some sites block this; then use the file picker). */
function loadFishUrl() {
    var url = $('fishUrl').value.trim();
    if (!url) {
        toast('Paste a picture link first');
        return;
    }
    toast('Loading picture…');
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        var data;
        try {
            data = c.toDataURL('image/png');
        } catch (e) {
            toast('That site blocks copying — save the picture and use the file picker');
            return;
        }
        var name = (url.split('/').pop() || 'fish').split('?')[0];
        post({ addFish: { name: name, image: data } }, 'Fish added 🐟').then(function (d) {
            if (d) {
                $('fishUrl').value = '';
                load();
            }
        });
    };

    img.onerror = function () {
        toast('Could not load that link');
    };

    img.src = url;
}

/** Change one fish (on/off, name, size, faces left). */
function editFish(id, patch) {
    patch.id = id;
    post({ editFish: patch }, 'Saved').then(load);
}

/** Move a fish up or down the list (matters for "next fish in the list"). */
function moveFish(id, dir) {
    post({ moveFish: { id: id, dir: dir } }).then(load);
}

/** Remove a fish from the list after asking; its picture file stays in assets. */
function removeFish(id, name) {
    if (!confirm('Remove "' + name + '" from the fish list?')) return;
    post({ removeFish: id }, 'Removed').then(load);
}

/** Make one particular fish jump now. */
function jumpFish(id) {
    post({ jumpNow: true, fishId: id }, 'Jump!');
}

/** Draw the fish list: the built-in fish first, then her pictures. */
function renderFish(d) {
    var h =
        '<div class="frow builtin' +
        (d.useDefault ? '' : ' off') +
        '">' +
        '<input type="checkbox" ' +
        (d.useDefault ? 'checked' : '') +
        ' onchange="post({useDefault:this.checked},\'Saved\').then(load)" title="Use the built-in fish">' +
        '<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:26px">🐟</div>' +
        '<div class="mid"><span class="nm">Built-in fish</span><span class="opts">the teal and gold fish that comes with ICB</span></div>' +
        '<div class="acts"><button class="btn-sm" onclick="jumpFish(\'default\')">Jump</button></div></div>';
    (d.fish || []).forEach(function (f, i) {
        var pct = Math.round((f.scale || 1) * 100);
        h +=
            '<div class="frow' +
            (f.on ? '' : ' off') +
            '">' +
            '<input type="checkbox" ' +
            (f.on ? 'checked' : '') +
            ' onchange="editFish(\'' +
            f.id +
            '\',{on:this.checked})" title="Use this fish">' +
            '<img class="thumb" src="' +
            esc(f.url) +
            '" alt="">' +
            '<div class="mid"><input type="text" value="' +
            esc(f.name) +
            '" maxlength="40" onchange="editFish(\'' +
            f.id +
            '\',{name:this.value})">' +
            '<span class="opts"><label style="min-width:0"><input type="checkbox" ' +
            (f.facesLeft ? 'checked' : '') +
            ' onchange="editFish(\'' +
            f.id +
            '\',{facesLeft:this.checked})"> Faces left</label>' +
            'Size <input type="range" min="30" max="300" step="5" value="' +
            pct +
            '" oninput="this.nextSibling.textContent=this.value+\'%\'" onchange="editFish(\'' +
            f.id +
            '\',{scale:this.value/100})"><span>' +
            pct +
            '%</span></span></div>' +
            '<div class="acts"><button class="btn-sm" onclick="jumpFish(\'' +
            f.id +
            '\')">Jump</button>' +
            '<button class="btn-sm" onclick="moveFish(\'' +
            f.id +
            '\',-1)"' +
            (i ? '' : ' disabled') +
            '>↑</button>' +
            '<button class="btn-sm" onclick="moveFish(\'' +
            f.id +
            '\',1)"' +
            (i < d.fish.length - 1 ? '' : ' disabled') +
            '>↓</button>' +
            '<button class="btn-sm" onclick="removeFish(\'' +
            f.id +
            "','" +
            esc(f.name).replace(/'/g, '') +
            '\')">✕</button></div></div>';
    });
    $('fishList').innerHTML = h;
}

/* ---------- load state from server ---------- */
function load() {
    return fetch('/api/oceanfish')
        .then(function (r) {
            return r.json();
        })
        .then(function (d) {
            S = d;
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';

            $('visible').checked = d.visible;
            $('onDemand').checked = d.onDemand;
            $('showSec').value = d.showSec;
            $('showOnJump').checked = d.showOnJump;

            $('fishSize').value = d.fishSize;
            $('autoJump').checked = d.autoJump;
            $('jumpHeight').value = Math.round(d.jumpHeight * 100);
            $('jumpSpeed').value = Math.round(d.jumpSpeed * 10);
            $('jumpEvery').value = d.jumpEvery;
            $('jumpCount').value = d.jumpCount || 1;
            $('jumpSpread').value = Math.round(
                (d.jumpSpread === undefined ? 0.4 : d.jumpSpread) * 10
            );
            $('variety').value = Math.round(d.variety * 10);
            $('splash').checked = d.splash;
            $('directions').value = d.directions;

            $('waveSpeed').value = Math.round(d.waveSpeed * 10);
            $('waveHeight').value = Math.round(d.waveHeight * 10);
            $('sparkles').value = d.sparkles;
            $('gold').checked = d.gold;

            var radios = document.querySelectorAll('input[name="bg"]');
            for (var i = 0; i < radios.length; i++)
                radios[i].checked = Number(radios[i].value) === d.bg;

            $('pick').value = d.pick || 'random';
            renderFish(d);
            slid();
        })
        .catch(function () {
            $('health').textContent = 'ICB offline';
            $('health').className = 'health offline';
        });
}

/* ---------- SSE for live updates ---------- */
var events = new EventSource('/events?role=control');
events.addEventListener('oceanfish', function (e) {
    // don't clobber while user is interacting
});
events.onerror = function () {
    $('health').classList.add('offline');
    $('health').textContent = 'ICB offline';
};

events.onopen = function () {
    $('health').classList.remove('offline');
    $('health').textContent = 'connected';
};

load();
