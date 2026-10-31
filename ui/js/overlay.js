const $ = (id) => document.getElementById(id);

const fmt = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());

function render(p) {
    const l = p.live || p;
    const needs = Boolean(l.reconciliation?.required);
    $('amber').textContent = fmt(l.resources?.amber);
    $('essence').textContent = fmt(l.resources?.essence);
    $('sweetLeaf').textContent = fmt(l.resources?.sweetLeaf);
    $('title').textContent = needs
        ? 'Palia totals need reconciliation'
        : p.settings?.stream?.title || 'Live Palia trackers';
    $('status').textContent = needs
        ? 'ENTER CURRENT TOTALS IN CHROME'
        : (l.reader?.state || 'offline').toUpperCase() +
          ' // ' +
          (l.session?.mode || 'offline').toUpperCase();
}

fetch('/api/state', { cache: 'no-store' })
    .then((r) => r.json())
    .then(render);
const e = new EventSource('/events?role=overlay');
e.addEventListener('snapshot', (x) => render(JSON.parse(x.data)));
e.addEventListener('live', (x) => {
    const l = JSON.parse(x.data);
    fetch('/api/settings', { cache: 'no-store' })
        .then((r) => r.json())
        .then((s) => render({ live: l, settings: s.settings }));
});
e.addEventListener('settings', (x) => {
    const s = JSON.parse(x.data);
    fetch('/api/live', { cache: 'no-store' })
        .then((r) => r.json())
        .then((l) => render({ live: l.live, settings: s }));
});
