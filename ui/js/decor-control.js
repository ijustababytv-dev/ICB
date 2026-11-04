const $ = (id) => document.getElementById(id);

const ORIGIN = location.origin;
let state = null;
const LABELS = {
    amount: ['How many', (v) => Math.round(v)],
    speed: ['Speed', (v) => v.toFixed(1) + '×'],
    size: ['Size', (v) => Math.round(v) + 'px'],
    opacity: ['See-through', (v) => Math.round(v * 100) + '%'],
    drift: ['Wind', (v) => (v > 0.05 ? '→ ' : v < -0.05 ? '← ' : '') + Math.abs(v).toFixed(1)],
    sway: ['Flutter', (v) => v.toFixed(1)],
    spin: ['Twirl', (v) => v.toFixed(1)],
    fade: ['Ghostly fade', (v) => Math.round(v * 100) + '%']
};
const STEPS = {
    amount: 1,
    speed: 0.1,
    size: 2,
    opacity: 0.05,
    drift: 0.1,
    sway: 0.1,
    spin: 0.1,
    fade: 0.05
};
const MOTIONS = [
    ['fall', '🍂 Falls down'],
    ['float', '👻 Floats up'],
    ['fly', '🦇 Flies across']
];

function esc(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, method = 'GET', body) {
    const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
    if (!data.ok) toast(data.error || 'Something went wrong');
    return data;
}

// Sliders send while dragging (throttled) so the overlay moves live.
const pending = {};
function sendSetting(id, key, value) {
    pending[id] = Object.assign(pending[id] || {}, { [key]: value });
    clearTimeout(sendSetting['t' + id]);
    sendSetting['t' + id] = setTimeout(() => {
        const b = pending[id];
        delete pending[id];
        api('/api/decor/effects/' + id, 'PATCH', b);
    }, 120);
}

let dragging = false;
function render(s) {
    state = s;
    renderPresets();
    renderLibrary();
    if (dragging) return; // don't rebuild the cards under the mouse mid-drag
    const box = $('effects');
    box.innerHTML = s.effects
        .map((e) => {
            const link = ORIGIN + '/decor/' + e.id + '.html';
            const sliders = Object.keys(LABELS)
                .filter((k) => s.limits[k])
                .map((k) => {
                    const lim = s.limits[k];
                    return `<label for="${e.id}-${k}">${LABELS[k][0]}</label>
          <input type="range" id="${e.id}-${k}" min="${lim[0]}" max="${lim[1]}" step="${
                        STEPS[k]
                    }" value="${e[k]}"
            oninput="slide('${
                e.id
            }','${k}',this)" onpointerdown="dragging=true" onpointerup="dragging=false" onchange="dragging=false">
          <output id="${e.id}-${k}-v">${LABELS[k][1](e[k])}</output>`;
                })
                .join('');
            const art = e.files
                .map((f) => {
                    const on = !e.off.includes(f);
                    const src = '/decor-art/' + e.id + '/' + encodeURIComponent(f);
                    return `<div class="thumb ${on ? 'on' : 'off'}" title="${esc(f)} — click to ${
                        on ? 'stop using' : 'use'
                    }" onclick="toggleArt('${e.id}', ${esc(JSON.stringify(f))})">
          <img src="${src}" alt=""><button class="rm" title="Remove" onclick="event.stopPropagation(); removeArt('${
                        e.id
                    }', ${esc(JSON.stringify(f))})">✕</button>
          <div class="tag">${esc(f)}</div></div>`;
                })
                .join('');
            const libByKey = {};
            (s.library || []).forEach((x) => (libByKey[x.key] = x));
            const borrowed = (e.extra || []).filter(
                (k) => libByKey[k] && k.indexOf(e.id + '/') !== 0
            );
            const borrowedHtml = borrowed
                .map(
                    (k) => `<div class="thumb on" title="${esc(
                        libByKey[k].file
                    )} (from the picture library) — click to take it out of this effect" onclick="toggleExtra('${
                        e.id
                    }', ${esc(JSON.stringify(k))})">
          <span class="lib-tag">library</span><img src="${
              libByKey[k].url
          }" alt=""><div class="tag">${esc(libByKey[k].file)}</div></div>`
                )
                .join('');
            const usedCount = e.files.filter((f) => !e.off.includes(f)).length + borrowed.length;
            const warn =
                !e.files.length && !borrowed.length
                    ? `<p class="warn">No art yet — it's showing simple placeholder shapes until you add your own images below.</p>`
                    : !usedCount && !borrowed.length
                    ? `<p class="warn">All art is unticked — it's showing placeholder shapes. Click an image to use it.</p>`
                    : '';
            const motion = `<div class="motion">How it moves: ${MOTIONS.map(
                ([t, label]) =>
                    `<button class="btn-small ${
                        (e.type || 'fall') === t ? 'sel' : ''
                    }" onclick="setType('${e.id}','${t}')">${label}</button>`
            ).join('')}
        <span style="flex:1"></span><button class="btn-small btn-accent" onclick="solo('${
            e.id
        }', ${esc(
                JSON.stringify(e.name)
            )})" title="Turn this on and every other effect off">▶ Show only this one</button></div>`;
            const windNote =
                e.type === 'fly'
                    ? `<div class="note" style="margin:-4px 0 10px">Flies across: <b>Wind</b> sets the direction (→ right, ← left, middle = both ways) and how fast they cross.</div>`
                    : '';
            return `<div class="card" id="fx-${e.id}">
        <div class="fx-head">
          <div class="name">${esc(e.name)}</div>
          <span class="status ${e.enabled ? 'on' : ''}">${e.enabled ? 'ON AIR' : 'off'}</span>
          <label class="switch"><input type="checkbox" ${
              e.enabled ? 'checked' : ''
          } onchange="setOn('${e.id}', this.checked)"><span></span></label>
        </div>
        <div class="url"><span>Meld link</span><code>${esc(
            link
        )}</code><button class="btn-small" onclick="copy('${esc(link)}')">Copy</button></div>
        ${motion}
        <div class="sliders">${sliders}</div>
        ${windNote}
        ${warn}
        <div class="art">${art}${borrowedHtml}</div>
        <div class="drop" ondragover="event.preventDefault(); this.classList.add('hover')" ondragleave="this.classList.remove('hover')"
             ondrop="event.preventDefault(); this.classList.remove('hover'); upload('${
                 e.id
             }', event.dataTransfer.files)"
             onclick="this.nextElementSibling.click()">Drop PNG art here, or click to pick files (transparent PNGs look best)</div>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="display:none" onchange="upload('${
            e.id
        }', this.files); this.value=''">
        <div class="note">Art folder: <code>ICB\\assets\\decor\\${esc(
            e.id
        )}\\</code> — files you drop in there show up here too (refresh). Click an image to turn it on/off for this effect.</div>
        <div class="fx-foot">
          <span class="note" style="margin:0">Art in use: ${usedCount}${
                borrowed.length ? ` (${borrowed.length} from the library)` : ''
            }</span>
          <button class="btn-small btn-danger" onclick="removeEffect('${e.id}', ${esc(
                JSON.stringify(e.name)
            )})">Delete effect</button>
        </div>
      </div>`;
        })
        .join('');
}

// ---- picture library ----
function inEffect(e, item) {
    if (item.folder === e.id) return !e.off.includes(item.file);
    return (e.extra || []).includes(item.key);
}

function renderLibrary() {
    if (!state) return;
    const lib = state.library || [],
        q = ($('libSearch').value || '').trim().toLowerCase(),
        show = $('libShow').value;
    const rows = lib.filter((item) => {
        const used = state.effects.some((e) => inEffect(e, item));
        if (show === 'used' && !used) return false;
        if (show === 'unused' && used) return false;
        return !q || (item.file + ' ' + item.folder).toLowerCase().includes(q);
    });
    $('library').innerHTML = rows.length
        ? rows
              .map((item) => {
                  const used = state.effects.some((e) => inEffect(e, item));
                  const chips = state.effects
                      .map(
                          (e) =>
                              `<button class="chip ${
                                  inEffect(e, item) ? 'on' : ''
                              }" onclick="libToggle('${e.id}', ${esc(JSON.stringify(item.key))})">${
                                  inEffect(e, item) ? '✓ ' : ''
                              }${esc(e.name)}</button>`
                      )
                      .join('');
                  return `<div class="lib-tile ${used ? 'used' : ''}">
        <div class="pic"><img src="${item.url}" alt="" loading="lazy"></div>
        <div class="fn" title="${esc(item.folder + '/' + item.file)}">${esc(
                      item.file
                  )} <span style="opacity:.6">· ${esc(item.folder)}</span></div>
        <div class="chips">${chips}</div></div>`;
              })
              .join('')
        : `<span class="note" style="margin:0">${
              lib.length ? 'No pictures match.' : 'No pictures yet — drop some below.'
          }</span>`;
}

async function libToggle(effectId, key) {
    const e = state.effects.find((x) => x.id === effectId);
    if (!e) return;
    const item = (state.library || []).find((x) => x.key === key);
    if (!item) return;
    if (item.folder === e.id) await toggleArt(e.id, item.file); // its own folder: tick/untick
    else await toggleExtra(e.id, key);
}

async function toggleExtra(effectId, key) {
    const e = state.effects.find((x) => x.id === effectId);
    if (!e) return;
    const extra = (e.extra || []).includes(key)
        ? e.extra.filter((k) => k !== key)
        : (e.extra || []).concat([key]);
    await api('/api/decor/effects/' + effectId, 'PATCH', { extra });
}

async function uploadLibrary(files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) return toast('Pick PNG, JPG, WEBP or GIF images');
    let done = 0;
    for (const f of list) {
        const dataUrl = await new Promise((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(r.result);

            r.onerror = fail;
            r.readAsDataURL(f);
        });
        const d = await api('/api/decor/library', 'POST', { dataUrl, name: f.name });
        if (d.ok) done++;
    }
    toast(
        `Added ${done} picture${
            done === 1 ? '' : 's'
        } to the library — now click an effect under it`
    );
}

function renderPresets() {
    const p = state.presets;
    $('presets').innerHTML = p.length
        ? p
              .map(
                  (x) =>
                      `<span class="preset"><button onclick="applyPreset('${x.id}', ${esc(
                          JSON.stringify(x.name)
                      )})">✨ ${esc(
                          x.name
                      )}</button><button class="x" title="Delete preset" onclick="deletePreset('${
                          x.id
                      }', ${esc(JSON.stringify(x.name))})">✕</button></span>`
              )
              .join('')
        : '<span class="note" style="margin:0">No presets yet — set things up the way you like, name it below, and save.</span>';
}

function slide(id, key, el) {
    const v = parseFloat(el.value);
    $(id + '-' + key + '-v').textContent = LABELS[key][1](v);
    sendSetting(id, key, v);
}

async function setOn(id, on) {
    await api('/api/decor/effects/' + id, 'PATCH', { enabled: on });
}

async function setType(id, type) {
    await api('/api/decor/effects/' + id, 'PATCH', { type });
}

async function solo(id, name) {
    const d = await api('/api/decor/effects/' + id + '/solo', 'POST');
    if (d.ok) toast(`Showing only "${name}"`);
}

async function toggleArt(id, file) {
    const e = state.effects.find((x) => x.id === id);
    const off = e.off.includes(file) ? e.off.filter((f) => f !== file) : e.off.concat([file]);
    await api('/api/decor/effects/' + id, 'PATCH', { off });
}

async function removeArt(id, file) {
    if (
        !confirm(
            `Remove "${file}" from this effect?\n\nIt's moved into the _removed folder inside the art folder, not deleted.`
        )
    )
        return;
    await api('/api/decor/effects/' + id + '/images/' + encodeURIComponent(file), 'DELETE');
}

async function upload(id, files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) return toast('Pick PNG, JPG, WEBP or GIF images');
    let done = 0;
    for (const f of list) {
        const dataUrl = await new Promise((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(r.result);

            r.onerror = fail;
            r.readAsDataURL(f);
        });
        const d = await api('/api/decor/effects/' + id + '/images', 'POST', {
            dataUrl,
            name: f.name
        });
        if (d.ok) done++;
    }
    toast(`Added ${done} image${done === 1 ? '' : 's'}`);
}

async function addEffect() {
    const name = $('newName').value.trim();
    if (!name) return toast('Type a name first');
    const d = await api('/api/decor/effects', 'POST', { name, type: $('newType').value });
    if (d.ok) {
        $('newName').value = '';
        toast(`Added "${name}" — add its art and copy its Meld link`);
    }
}

async function removeEffect(id, name) {
    if (
        !confirm(
            `Delete the "${name}" effect?\n\nIts Meld layer will go blank. Its art folder is kept on your PC.`
        )
    )
        return;
    await api('/api/decor/effects/' + id, 'DELETE');
}

async function savePreset() {
    const name = $('presetName').value.trim();
    if (!name) return toast('Name the preset first');
    const d = await api('/api/decor/presets', 'POST', { name });
    if (d.ok) {
        $('presetName').value = '';
        toast(`Saved "${name}"`);
    }
}

async function applyPreset(id, name) {
    const d = await api('/api/decor/presets/' + id + '/apply', 'POST');
    if (d.ok) toast(`Switched to "${name}"`);
}

async function deletePreset(id, name) {
    if (confirm(`Delete the "${name}" preset?`)) await api('/api/decor/presets/' + id, 'DELETE');
}

async function allOff() {
    const d = await api('/api/decor/all-off', 'POST');
    if (d.ok) toast('Everything off');
}

function copy(text) {
    navigator.clipboard.writeText(text).then(
        () => toast('Link copied — paste it into a Meld browser layer'),
        () => prompt('Copy this link:', text)
    );
}

async function load() {
    const d = await api('/api/decor/state');
    if (d.ok) render(d);
}

$('allLink').textContent = ORIGIN + '/decor/all.html';
document.addEventListener('pointerup', () => {
    if (dragging) {
        dragging = false;
        load();
    }
});
const events = new EventSource('/events?role=control');
events.addEventListener('decor', (e) => render(JSON.parse(e.data)));
events.onerror = () => {
    $('health').classList.add('offline');
    $('health').textContent = 'ICB offline';
};

events.onopen = () => {
    $('health').classList.remove('offline');
    $('health').textContent = 'connected';
};

load();
// Picks up art dropped straight into the folder on your PC.
setInterval(() => {
    if (!dragging && document.visibilityState === 'visible') load();
}, 5000);
