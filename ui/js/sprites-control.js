var S = null,
    $ = function (id) {
        return document.getElementById(id);
    },
    sig = '',
    editing = null,
    picFor = null,
    hoverId = null;

var VAR = {
    'Base': ['BASE', '#b9bcc4'],
    'Gold': ['GOLD', '#f5a33a'],
    'Cheat Master': ['CHEAT', '#5fc832'],
    'Loot Hacker': ['HACKER', '#6b6dff'],
    'Bounty Hunter': ['HUNTER', '#f2a9f6'],
    'Trick or Treat': ['TRICK', '#ff7a2e'],
    'Quack': ['QUACK', '#a46bff']
};
var GRAD = {
    Rare: 'linear-gradient(180deg,#0f3d6e,#0b2440 75%)',
    Epic: 'linear-gradient(180deg,#5a2580,#2a1240 75%)',
    Legendary: 'linear-gradient(180deg,#8a4a12,#3d2108 75%)',
    Mythic: 'linear-gradient(180deg,#8a7012,#3b2f08 75%)',
    Uncommon: 'linear-gradient(180deg,#2c6b2c,#163616 75%)',
    Common: 'linear-gradient(180deg,#555,#2a2a2a 75%)',
    Exotic: 'linear-gradient(180deg,#127a8a,#08353d 75%)'
};
var CHECK =
    '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#58d34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var RAR = {
    Common: '#9aa0a6',
    Uncommon: '#5fd068',
    Rare: '#3d9bff',
    Epic: '#b25cff',
    Legendary: '#ffad33',
    Mythic: '#ffd84a',
    Exotic: '#5ee7ff'
};
function vmeta(v) {
    if (VAR[v]) return VAR[v];
    var h = 0;
    for (var i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) % 360;
    return [v.split(' ')[0].toUpperCase().slice(0, 7), 'hsl(' + h + ',80%,65%)'];
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
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

function key(s, v) {
    return s.id + '|' + v;
}

function F(id) {
    return S.sprites.filter(function (s) {
        return s.id === id;
    })[0];
}

// ---------- panels (built once per list change, updated in place) ----------
function build() {
    var g = $('grid');
    g.innerHTML = '';
    S.sprites.forEach(function (s) {
        var d = document.createElement('div');
        d.className = 'sp';
        d.setAttribute('data-id', s.id);
        d.style.setProperty('--r', RAR[s.rarity] || '#3d9bff');
        d.style.setProperty('--g', GRAD[s.rarity] || GRAD.Rare);
        var baseArt = s.art && s.art[s.variants[0]]; // her new Base sticker art replaces the old card picture (2026-10-19)
        d.innerHTML =
            '<div class="pic' +
            (baseArt ? ' stk' : '') +
            '" title="Click to add a picture">' +
            (baseArt || s.img
                ? '<img src="' + esc(baseArt || s.img) + '" alt="">'
                : esc(s.name.charAt(0))) +
            '</div>' +
            '<div class="body"><div class="nm">' +
            esc(s.name) +
            ' <span class="rar">' +
            esc(s.rarity) +
            '</span><span class="cnt"></span></div>' +
            '<div class="vars">' +
            s.variants
                .map(function (v) {
                    var m = vmeta(v);
                    return (
                        '<div class="v" data-v="' +
                        esc(v) +
                        '" style="--c:' +
                        m[1] +
                        '" title="' +
                        esc(v) +
                        '"><div class="dot' +
                        (s.art && s.art[v] ? ' art' : '') +
                        '">' +
                        (s.art && s.art[v] ? '<img src="' + esc(s.art[v]) + '" alt="">' : '') +
                        CHECK +
                        '</div><div class="lb">' +
                        esc(m[0]) +
                        '</div></div>'
                    );
                })
                .join('') +
            '</div></div>' +
            '<div class="acts"><button class="btn-sm" data-a="up">↑</button><button class="btn-sm" data-a="down">↓</button><button class="btn-sm" data-a="all">✓ all</button><button class="btn-sm" data-a="edit">✏️</button></div>';
        [].forEach.call(d.querySelectorAll('.v'), function (el) {
            el.onclick = function () {
                var on = !el.classList.contains('on');
                el.classList.toggle('on', on);
                api('/api/sprites', {
                    catch: { id: s.id, variant: el.getAttribute('data-v'), on: on }
                }).then(load);
            };
        });
        d.querySelector('.pic').onclick = function () {
            picFor = s.id;
            $('picFile').click();
        };

        d.querySelector('[data-a=edit]').onclick = function () {
            editS(s.id);
        };

        d.querySelector('[data-a=all]').onclick = function () {
            api('/api/sprites', { catchAll: { id: s.id, on: true } }).then(load);
        };

        d.querySelector('[data-a=up]').onclick = function () {
            api('/api/sprites', { move: { id: s.id, dir: -1 } }).then(load);
        };

        d.querySelector('[data-a=down]').onclick = function () {
            api('/api/sprites', { move: { id: s.id, dir: 1 } }).then(load);
        };

        d.addEventListener('mouseenter', function () {
            hoverId = s.id;
        });
        d.addEventListener('mouseleave', function () {
            if (hoverId === s.id) hoverId = null;
        });
        d.addEventListener('dragover', function (e) {
            e.preventDefault();
            d.classList.add('drop');
        });
        d.addEventListener('dragleave', function () {
            d.classList.remove('drop');
        });
        d.addEventListener('drop', function (e) {
            e.preventDefault();
            d.classList.remove('drop');
            var f = e.dataTransfer.files[0];
            if (f) uploadPic(s.id, f);
        });
        g.appendChild(d);
    });
}

function refresh() {
    var q = $('q').value.trim().toLowerCase(),
        r = $('rar').value,
        view = $('view').value,
        shown = 0;
    S.sprites.forEach(function (s) {
        var d = $('grid').querySelector('.sp[data-id="' + s.id + '"]');
        if (!d) return;
        var n = 0;
        [].forEach.call(d.querySelectorAll('.v'), function (el) {
            var on = !!S.caught[key(s, el.getAttribute('data-v'))];
            el.classList.toggle('on', on);
            if (on) n++;
        });
        var full = n === s.variants.length,
            caught = !!S.caught[key(s, s.variants[0])];
        d.querySelector('.cnt').textContent = n + '/' + s.variants.length + (full ? ' ⭐' : '');
        d.className = 'sp' + (full ? ' full' : '');
        var ok =
            (!q || s.name.toLowerCase().indexOf(q) >= 0) &&
            (!r || s.rarity === r) &&
            (view === 'all' || (view === 'full' ? full : view === 'missing' ? !full : !caught));
        d.style.display = ok ? '' : 'none';
        if (ok) shown++;
    });
    $('shown').textContent = 'Showing ' + shown + ' of ' + S.sprites.length + ' sprites';
}

['q', 'rar', 'view'].forEach(function (id) {
    $(id).addEventListener('input', refresh);
});
// ---------- pictures ----------

$('picFile').onchange = function (e) {
    var f = e.target.files[0];
    if (f && picFor) uploadPic(picFor, f);
    e.target.value = '';
};

document.addEventListener('paste', function (e) {
    if (!hoverId || $('modal').className === 'modal on') return;
    var it = [].slice.call((e.clipboardData || {}).items || []).filter(function (i) {
        return i.type.indexOf('image') === 0;
    })[0];
    if (it) {
        e.preventDefault();
        uploadPic(hoverId, it.getAsFile());
    }
});
// ---------- edit ----------
function editS(id) {
    editing = id;
    var s = id
        ? F(id)
        : {
              name: '',
              rarity: 'Rare',
              variants: [
                  'Base',
                  'Gold',
                  'Cheat Master',
                  'Loot Hacker',
                  'Bounty Hunter',
                  'Trick or Treat'
              ]
          };
    $('mTitle').textContent = id ? 'Edit ' + s.name : 'Add a sprite';
    $('mName').value = s.name;
    $('mRar').value = s.rarity;
    $('mVars').value = s.variants.join('\n');
    $('mDel').style.display = id ? '' : 'none';
    $('modal').className = 'modal on';
    $('mName').focus();
}

function closeM() {
    $('modal').className = 'modal';
}

function saveS() {
    api('/api/sprites', {
        saveSprite: {
            id: editing || '',
            name: $('mName').value,
            rarity: $('mRar').value,
            variants: $('mVars').value.split(/\r?\n/)
        }
    }).then(function (r) {
        if (r.ok === false) alert(r.error);
        else {
            closeM();
            load();
        }
    });
}

function delS() {
    var s = F(editing);
    if (confirm('Remove ' + s.name + ' and its catches?'))
        api('/api/sprites', { removeSprite: editing }).then(function () {
            closeM();
            load();
        });
}

function addVarAll() {
    var v = $('newVar').value.trim();
    if (v && confirm('Add "' + v + '" to every sprite that has variants?'))
        api('/api/sprites', { addVariantAll: v }).then(function () {
            $('newVar').value = '';
            load();
        });
}

function newSeason() {
    var n = prompt('Name of the new season (e.g. Chapter 8 Season 1)');
    if (!n) return;
    var keep = confirm(
        'Keep the same sprites (empty circles)?\nOK = keep the list, Cancel = start with an empty list.'
    );
    api('/api/sprites', { newSeason: n, keepSprites: keep }).then(load);
}

function resetAll() {
    if (confirm('Untick every catch this season?') && confirm('Really?'))
        api('/api/sprites', { resetCatches: 'yes' }).then(load);
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeM();
});
// ---------- load ----------
function load() {
    return api('/api/sprites/admin')
        .then(function (d) {
            S = d;
            $('health').textContent = 'ICB connected';
            $('health').className = 'health';
            var st = d.stats;
            $('seasonLine').textContent =
                d.season + ' — tap a circle when you catch that sprite. Tap again to undo.';
            if (document.activeElement !== $('season')) $('season').value = d.season;
            $('pct').textContent = st.pct + '%';
            $('done').textContent = st.done + ' / ' + st.total;
            $('base').textContent = st.base + ' / ' + st.sprites;
            $('full').textContent = st.full;
            $('pbar').style.width = st.pct + '%';
            $('varChips').innerHTML = Object.keys(st.byVar)
                .map(function (v) {
                    var m = vmeta(v),
                        o = st.byVar[v];
                    return (
                        '<span class="chip" style="color:' +
                        m[1] +
                        '">' +
                        esc(m[0]) +
                        ' ' +
                        o.done +
                        '/' +
                        o.total +
                        '</span>'
                    );
                })
                .join('');
            $('recent').innerHTML = d.recent.length
                ? d.recent
                      .map(function (r) {
                          var m = vmeta(r.variant);
                          return (
                              '<div>✅ <b>' +
                              esc(r.name) +
                              '</b> · <span style="color:' +
                              m[1] +
                              ';font-weight:800">' +
                              esc(r.variant) +
                              '</span> <span class="note">' +
                              new Date(r.at).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                              }) +
                              '</span></div>'
                          );
                      })
                      .join('')
                : '<div class="note">Nothing yet - tap a circle!</div>';
            if ($('rar').options.length < 2)
                d.rarities.forEach(function (r) {
                    var o = document.createElement('option');
                    o.value = o.textContent = r;
                    $('rar').appendChild(o);
                    $('mRar').appendChild(o.cloneNode(true));
                });
            var g = JSON.stringify(d.sprites);
            if (g !== sig) {
                sig = g;
                build();
            }
            makeStickers(d.needArt || []);
            refresh();
        })
        .catch(function () {
            $('health').textContent = 'ICB offline';
            $('health').className = 'health offline';
        });
}

load();
setInterval(load, 4000);

// Big sticker PNGs get small copies made here too (same as the jar dashboard), so the art shows up right away.
var making = false;
function makeStickers(need) {
    if (making || !need.length) return;
    making = true;
    var job = need[0],
        img = new Image(),
        done = function () {
            making = false;
            setTimeout(load, 300);
        };

    img.onload = function () {
        try {
            var w = img.naturalWidth,
                h = img.naturalHeight,
                c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            var x = c.getContext('2d');
            x.drawImage(img, 0, 0);
            var px = x.getImageData(0, 0, w, h).data,
                a = w,
                b = h,
                cc = -1,
                dd = -1;
            for (var yy = 0; yy < h; yy += 2)
                for (var xx = 0; xx < w; xx += 2)
                    if (px[(yy * w + xx) * 4 + 3] > 8) {
                        if (xx < a) a = xx;
                        if (xx > cc) cc = xx;
                        if (yy < b) b = yy;
                        if (yy > dd) dd = yy;
                    }
            if (cc < 0) {
                a = 0;
                b = 0;
                cc = w - 1;
                dd = h - 1;
            }
            a = Math.max(0, a - 2);
            b = Math.max(0, b - 2);
            cc = Math.min(w - 1, cc + 2);
            dd = Math.min(h - 1, dd + 2);
            var cw = cc - a + 1,
                ch = dd - b + 1,
                sc = Math.min(1, 256 / Math.max(cw, ch)),
                o = document.createElement('canvas');
            o.width = Math.round(cw * sc);
            o.height = Math.round(ch * sc);
            var ox = o.getContext('2d');
            ox.imageSmoothingQuality = 'high';
            ox.drawImage(c, a, b, cw, ch, 0, 0, o.width, o.height);
            api('/api/sprites/jar/sticker', {
                id: job.id,
                variant: job.variant,
                dataUrl: o.toDataURL('image/webp', 0.9)
            }).then(done, done);
        } catch (e) {
            done();
        }
    };

    img.onerror = done;
    img.src = job.src;
}
