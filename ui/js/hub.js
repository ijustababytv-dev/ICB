const $ = (id) => document.getElementById(id);

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
function tick() {
    $('clock').textContent = new Date().toLocaleString([], {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit'
    });
}

tick();
setInterval(tick, 15000);

const events = new EventSource('/events?role=control');
events.addEventListener('hub', (e) => {
    window.ICBWorkspace?.updateHub(JSON.parse(e.data));
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
