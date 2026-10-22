const $ = (id) => document.getElementById(id);

let tiles = [];
let dragId = null;

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
    toast.t = setTimeout(() => t.classList.remove('show'), 2000);
}

// ---------------- Title & go-live randomizer ----------------
let RZ = null,
    rzGameId = null,
    rzRaw = { title: '', golive: '' },
    rzLocked = { title: false, golive: false },
    rzDirty = false;

document.addEventListener('input', (e) => {
    if (
        e.target &&
        (e.target.id === 'rzTitles' || e.target.id === 'rzGolives' || e.target.id === 'rzLink')
    )
        rzDirty = true;
});
rzLoad();
async function save(body) {
    const res = await fetch('/api/hub', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) render(d.tiles);
    else toast(d.error || 'Could not save');
    return d;
}

const customList = () =>
    tiles
        .filter((t) => !t.builtin)
        .map(({ id, icon, name, url, desc }) => ({ id, icon, name, url, desc }));

function render(list) {
    tiles = list;
    const n = tiles.filter((t) => t.startup).length;
    $('startcount').textContent = n
        ? `${n} page${n === 1 ? '' : 's'} open automatically when ICB starts.`
        : 'Nothing is set to open automatically when ICB starts.';
    $('grid').innerHTML = tiles
        .map(
            (t) => `
      <div class="tile" draggable="true" data-id="${esc(t.id)}">
        <span class="grip" title="Drag to move">⋮⋮</span>
        <div class="top"><div class="icon">${esc(t.icon)}</div><div class="name">${esc(
                t.name
            )}</div></div>
        <div class="desc">${esc(t.desc || '')}</div>
        <div class="url">${esc(t.url)}</div>
        <div class="row">
          <a class="open" href="${esc(t.url)}" target="icb-${esc(t.id)}" draggable="false">Open</a>
          ${
              t.builtin
                  ? ''
                  : `<button class="mini" title="Edit" onclick="editCustom('${esc(
                        t.id
                    )}')">✎</button><button class="mini" title="Remove" onclick="removeCustom('${esc(
                        t.id
                    )}')">✕</button>`
          }
        </div>
        <label class="start ${t.startup ? 'on' : ''}"><input type="checkbox" ${
                t.startup ? 'checked' : ''
            } onchange="toggleStartup('${esc(t.id)}', this.checked)"> Open when ICB starts</label>
      </div>`
        )
        .join('');
    for (const el of document.querySelectorAll('.tile')) wireDrag(el);
}

function wireDrag(el) {
    el.addEventListener('dragstart', (e) => {
        dragId = el.dataset.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    });
    el.addEventListener('dragover', (e) => {
        if (!dragId || dragId === el.dataset.id) return;
        e.preventDefault();
        el.classList.add('over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        const from = tiles.findIndex((t) => t.id === dragId),
            to = tiles.findIndex((t) => t.id === el.dataset.id);
        if (from < 0 || to < 0 || from === to) return;
        const moved = tiles.splice(from, 1)[0];
        tiles.splice(to, 0, moved);
        render(tiles); // show it right away
        save({ order: tiles.map((t) => t.id) });
        dragId = null;
    });
}

function toggleStartup(id, on) {
    const startup = tiles.filter((t) => (t.id === id ? on : t.startup)).map((t) => t.id);
    save({ startup }).then(
        (d) => d.ok && toast(on ? 'Will open when ICB starts' : 'Won’t open at start')
    );
}

function addCustom() {
    const name = $('cName').value.trim(),
        url = $('cUrl').value.trim(),
        icon = $('cIcon').value.trim() || '🔗';
    if (!name || !url) return toast('Give it a name and a link');
    if (!/^(https?:\/\/|\/)/i.test(url))
        return toast('Links start with https:// or / (for an ICB page)');
    const custom = customList().concat([{ id: 'c' + Date.now(), icon, name, url, desc: '' }]);
    save({ custom }).then((d) => {
        if (d.ok) {
            $('cName').value = '';
            $('cUrl').value = '';
            $('cIcon').value = '';
            toast('Added');
        }
    });
}

function editCustom(id) {
    const t = tiles.find((x) => x.id === id);
    if (!t) return;
    const name = prompt('Name:', t.name);
    if (name === null) return;
    const url = prompt('Link:', t.url);
    if (url === null) return;
    const icon = prompt('Icon (an emoji):', t.icon);
    if (icon === null) return;
    const desc = prompt('Short description (optional):', t.desc || '');
    if (desc === null) return;
    save({
        custom: customList().map((c) =>
            c.id === id
                ? {
                      ...c,
                      name: name.trim() || c.name,
                      url: url.trim() || c.url,
                      icon: icon.trim() || c.icon,
                      desc: desc.trim()
                  }
                : c
        )
    });
}

function removeCustom(id) {
    const t = tiles.find((x) => x.id === id);
    if (!t || !confirm(`Remove the "${t.name}" tile?`)) return;
    save({ custom: customList().filter((c) => c.id !== id) });
}

function tick() {
    $('clock').textContent = new Date().toLocaleString([], {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit'
    });
}

tick();
setInterval(tick, 15000);

async function load() {
    try {
        const d = await (await fetch('/api/hub')).json();
        if (d.ok) render(d.tiles);
    } catch (e) {}
}

const events = new EventSource('/events?role=control');
events.addEventListener('hub', (e) => {
    if (!dragId) render(JSON.parse(e.data).tiles);
});
events.onerror = () => {
    $('health').classList.add('offline');
    $('health').textContent = 'ICB offline';
};

events.onopen = () => {
    $('health').classList.remove('offline');
    $('health').textContent = 'connected';
};

// ---------------- Connection check ----------------
const OVERLAYS = [
    { page: '/giveaway-listener.html', name: 'Meld chat listener (invisible)', key: true },
    { page: '/unicorn-jar.html', name: 'Unicorn jar' },
    { page: '/walkers.html', name: 'Chat Unicorns' },
    { page: '/giveaway-entrants.html', name: 'Giveaway entrants board' },
    { page: '/giveaway-winners.html', name: 'Winners Circle' }
];
let lastCheck = null,
    lastCheckErr = null;
const secs = (t) => (t ? Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)) : Infinity);

const LISTENER_URL = 'http://127.0.0.1:8790/giveaway-listener.html';

pollCheck();
setInterval(pollCheck, 5000);
load();
