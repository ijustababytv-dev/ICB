const roster = [].concat(
    ANIIMO_ROSTER_001_021,
    ANIIMO_ROSTER_022_042,
    ANIIMO_ROSTER_043_062,
    ANIIMO_ROSTER_063_082,
    ANIIMO_ROSTER_083_99998
);

const KEY = 'aniimo-catch-variants-v2';
let checked = {};
try {
    checked = JSON.parse(localStorage.getItem(KEY) || '{}');
} catch (e) {}
const $ = (id) => document.getElementById(id);

const key = (a, v) => a.number + '|' + a.name + '|' + v;

function isDone(a) {
    return a.variants.every((v) => !!checked[key(a, v)]);
}

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(checked));
    } catch (e) {}
}

function update() {
    let total = 0,
        done = 0;
    roster.forEach((a) =>
        a.variants.forEach((v) => {
            total++;
            if (checked[key(a, v)]) done++;
        })
    );
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('percent').textContent = pct + '%';
    $('progress').textContent = `${done} / ${total} checked`;
    $('remaining').textContent = `${total - done} forms and special entries remaining`;
    $('bar').style.width = pct + '%';
    const q = $('search').value.trim().toLowerCase(),
        el = $('element').value,
        view = $('view').value;
    const items = roster.filter(
        (a) =>
            (a.name.toLowerCase().includes(q) || a.number.includes(q)) &&
            (el === 'All elements' || a.element.split(' / ').includes(el)) &&
            (view === 'all' || (view === 'caught' ? isDone(a) : !isDone(a)))
    );
    $('shown').textContent = `Showing ${items.length} of ${roster.length} Aniimo`;
    const list = $('list');
    list.innerHTML = '';
    items.forEach((a) => {
        const d = document.createElement('details');
        d.className = 'creature';
        d.open = !!q;
        const s = document.createElement('summary'),
            left = document.createElement('div'),
            nm = document.createElement('div'),
            meta = document.createElement('div'),
            tag = document.createElement('div');
        nm.className = 'name';
        nm.textContent = a.name;
        meta.className = 'meta';
        meta.textContent = `No. ${a.number} · ${a.element}`;
        const n = a.variants.filter((v) => checked[key(a, v)]).length;
        tag.className = 'tag';
        tag.textContent = `${n}/${a.variants.length}`;
        left.append(nm, meta);
        s.append(left, tag);
        d.append(s);
        const checks = document.createElement('div');
        checks.className = 'checks';
        a.variants.forEach((v) => {
            const label = document.createElement('label'),
                cb = document.createElement('input'),
                txt = document.createElement('span');
            cb.type = 'checkbox';
            cb.checked = !!checked[key(a, v)];
            txt.textContent = v;
            if (cb.checked) label.classList.add('done');
            cb.addEventListener('change', () => {
                checked[key(a, v)] = cb.checked;
                if (!cb.checked) delete checked[key(a, v)];
                save();
                update();
            });
            label.append(cb, txt);
            checks.append(label);
        });
        d.append(checks);
        list.append(d);
    });
}

['search', 'element', 'view'].forEach((id) => $(id).addEventListener('input', update));
$('export').onclick = () =>
    download(
        'aniimo-variant-progress.json',
        JSON.stringify(
            {
                app: 'Aniimo Catch & Variant Tracker',
                version: 2,
                exportedAt: new Date().toISOString(),
                checked
            },
            null,
            2
        ),
        'application/json'
    );

$('importBtn').onclick = () => $('importFile').click();

$('importFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
        const d = JSON.parse(await f.text());
        checked = d.checked || d;
        save();
        update();
        alert('Progress imported.');
    } catch (err) {
        alert('That file could not be imported.');
    }
    e.target.value = '';
};

$('csv').onclick = () => {
    const rows = [
        ['Caught', 'Number', 'Aniimo', 'Element', 'Form / Special'],
        ...roster.flatMap((a) =>
            a.variants.map((v) => [
                checked[key(a, v)] ? 'Yes' : 'No',
                a.number,
                a.name,
                a.element,
                v
            ])
        )
    ];
    download(
        'aniimo-variant-checklist.csv',
        rows
            .map((r) => r.map((x) => '"' + String(x).replaceAll('"', '""') + '"').join(','))
            .join('\r\n'),
        'text/csv;charset=utf-8'
    );
};

$('expand').onclick = () => {
    const ds = [...document.querySelectorAll('details.creature')];
    const open = ds.some((d) => !d.open);
    ds.forEach((d) => (d.open = open));
    $('expand').textContent = open ? 'Collapse all' : 'Expand all';
};

$('reset').onclick = () => {
    if (confirm('Clear all tracked catches and variants in this browser?')) {
        checked = {};
        save();
        update();
    }
};

function download(n, c, t) {
    const b = new Blob([c], { type: t }),
        u = URL.createObjectURL(b),
        a = document.createElement('a');
    a.href = u;
    a.download = n;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(u);
}

update();
