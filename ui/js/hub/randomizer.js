/** Game randomizer controls. Loaded before the page startup script. */
function rzGame() {
    return RZ && (RZ.games.find((g) => g.id === rzGameId) || RZ.games[0]);
}

function rzFill(msg, title) {
    return String(msg || '')
        .split('{title}')
        .join(title || '')
        .split('{link}')
        .join((RZ && RZ.link) || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function rzPick(list, recentKey) {
    if (!list.length) return '';
    const recent = RZ.recent[recentKey] || [];
    const avoid = Math.min(5, list.length - 1);
    const pool = list.filter((x) => recent.slice(0, avoid).indexOf(x) < 0);
    const pick = (pool.length ? pool : list)[
        Math.floor(Math.random() * (pool.length || list.length))
    ];
    RZ.recent[recentKey] = [pick].concat(recent.filter((x) => x !== pick)).slice(0, 10);
    return pick;
}

async function rzLoad() {
    try {
        const d = await (await fetch('/api/randomizer', { cache: 'no-store' })).json();
        if (!d.ok) return;
        RZ = d;
    } catch (e) {
        return;
    }
    if (!rzGameId || !RZ.games.some((g) => g.id === rzGameId)) rzGameId = RZ.games[0].id;
    const g = rzGame();
    // Show the last picks again after a refresh.
    rzRaw.title = (RZ.recent[g.id + ':title'] || [])[0] || '';
    rzRaw.golive = (RZ.recent[g.id + ':golive'] || [])[0] || '';
    rzRender(true);
}

function rzRender(lists) {
    const g = rzGame();
    if (!g) return;
    $('rzGames').innerHTML = RZ.games
        .map(
            (x) =>
                `<button class="rz-game ${x.id === g.id ? 'on' : ''}" onclick="rzSwitch('${
                    x.id
                }')">${esc(x.name)}</button>`
        )
        .join('');
    $('rzTitle').textContent =
        rzRaw.title || (g.titles.length ? 'Press 🎲 Randomize' : 'No titles yet — add some below');
    $('rzGolive').textContent = rzRaw.golive
        ? rzFill(rzRaw.golive, rzTitleText())
        : g.golives.length
        ? 'Press 🎲 Randomize'
        : 'No go-live messages yet — add some below';
    rzCounts();
    for (const k of ['title', 'golive']) {
        const btn = $(k === 'title' ? 'rzLockTitle' : 'rzLockGolive');
        btn.textContent = rzLocked[k] ? '🔒 Kept' : '🔓 Keep this one';
        $(k === 'title' ? 'rzTitleBox' : 'rzGoliveBox').classList.toggle('locked', rzLocked[k]);
    }
    document.querySelectorAll('.rzGameName').forEach((el) => (el.textContent = g.name));
    if (lists && !rzDirty) {
        $('rzTitles').value = g.titles.join('\n');
        $('rzGolives').value = g.golives.join('\n');
        $('rzLink').value = RZ.link || '';
        $('rzTitlesN').textContent = g.titles.length;
        $('rzGolivesN').textContent = g.golives.length;
    }
}

function rzTitleText() {
    return rzRaw.title ? $('rzTitle').textContent : '';
}

function rzCounts() {
    const t = rzRaw.title ? $('rzTitle').textContent : '',
        m = rzRaw.golive ? $('rzGolive').textContent : '';
    const tc = $('rzTitleCount');
    tc.textContent = t ? `${t.length} / 140` : '';
    tc.classList.toggle('over', t.length > 140);
    $('rzGoliveCount').textContent = m ? `${m.length} characters` : '';
}

function rzEdited() {
    rzCounts();
}

async function rzRoll(which) {
    const g = rzGame();
    if (!g) return;
    if ((!which || which === 'title') && (which === 'title' || !rzLocked.title))
        rzRaw.title = rzPick(g.titles, g.id + ':title');
    if ((!which || which === 'golive') && (which === 'golive' || !rzLocked.golive))
        rzRaw.golive = rzPick(g.golives, g.id + ':golive');
    $('rzTitle').textContent = rzRaw.title; // so the go-live message uses the new title
    rzRender(false);
    try {
        await fetch('/api/randomizer', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(RZ)
        });
    } catch (e) {}
}

function rzLock(k) {
    rzLocked[k] = !rzLocked[k];
    $(k === 'title' ? 'rzLockTitle' : 'rzLockGolive').textContent = rzLocked[k]
        ? '🔒 Kept'
        : '🔓 Keep this one';
    $(k === 'title' ? 'rzTitleBox' : 'rzGoliveBox').classList.toggle('locked', rzLocked[k]);
}

function rzCopy(which) {
    const t = rzRaw.title ? $('rzTitle').textContent.trim() : '',
        m = rzRaw.golive ? $('rzGolive').textContent.trim() : '';
    const text =
        which === 'title' ? t : which === 'golive' ? m : [t, m].filter(Boolean).join('\n\n');
    if (!text) return toast('Press 🎲 Randomize first');
    const done = () =>
        toast(
            which === 'both'
                ? 'Title and message copied'
                : which === 'title'
                ? 'Title copied'
                : 'Message copied'
        );

    if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(text).then(done, () => prompt('Copy:', text));
    else prompt('Copy:', text);
}

function rzSwitch(id) {
    if (rzDirty && !confirm('You have unsaved changes to the lists. Switch games anyway?')) return;
    rzDirty = false;
    rzGameId = id;
    rzLocked = { title: false, golive: false };
    const g = rzGame();
    rzRaw.title = (RZ.recent[g.id + ':title'] || [])[0] || '';
    rzRaw.golive = (RZ.recent[g.id + ':golive'] || [])[0] || '';
    rzRender(true);
}

async function rzPut(next, msg) {
    const r = await fetch('/api/randomizer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
    });
    const d = await r.json().catch(() => ({ ok: false }));
    if (!d.ok) {
        toast(d.error || 'Could not save — is ICB running?');
        return false;
    }
    RZ = d;
    rzDirty = false;
    if (msg) toast(msg);
    return true;
}

async function rzSave() {
    const g = rzGame();
    if (!g) return;
    const lines = (id) =>
        $(id)
            .value.split('\n')
            .map((x) => x.trim())
            .filter(Boolean);

    const next = JSON.parse(JSON.stringify(RZ));
    const ng = next.games.find((x) => x.id === g.id);
    ng.titles = lines('rzTitles');
    ng.golives = lines('rzGolives');
    next.link = $('rzLink').value.trim();
    if (
        await rzPut(
            next,
            `Saved — ${ng.titles.length} titles, ${ng.golives.length} go-live messages`
        )
    )
        rzRender(true);
}

async function rzAddGame() {
    const name = $('rzNewGame').value.trim();
    if (!name) return toast('Type the game name first');
    const next = JSON.parse(JSON.stringify(RZ));
    next.games.push({ name, titles: [], golives: [] });
    if (await rzPut(next, `Added ${name} — now add its titles`)) {
        $('rzNewGame').value = '';
        rzGameId = RZ.games[RZ.games.length - 1].id;
        rzRaw = { title: '', golive: '' };
        rzRender(true);
    }
}

async function rzRenameGame() {
    const g = rzGame();
    const name = prompt('New name for ' + g.name + ':', g.name);
    if (!name || !name.trim()) return;
    const next = JSON.parse(JSON.stringify(RZ));
    next.games.find((x) => x.id === g.id).name = name.trim();
    if (await rzPut(next, 'Renamed')) rzRender(true);
}

async function rzDeleteGame() {
    const g = rzGame();
    if (RZ.games.length < 2) return toast('Keep at least one game');
    if (!confirm(`Delete ${g.name} and all its titles and go-live messages?`)) return;
    const next = JSON.parse(JSON.stringify(RZ));
    next.games = next.games.filter((x) => x.id !== g.id);
    if (await rzPut(next, `${g.name} deleted`)) {
        rzGameId = RZ.games[0].id;
        rzRaw = { title: '', golive: '' };
        rzRender(true);
    }
}
