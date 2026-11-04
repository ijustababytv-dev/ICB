const $ = (id) => document.getElementById(id);

let state = null;
let lastHealth = null;
let panelOrderApplied = false;
// Tracker card order + cards removed from the dashboard (saved in ICB's settings via /api/layout).
let rtLay = { order: [], hidden: [] };
let rtLayLocal = false; // true once she has changed it here, so a stale broadcast can't undo it
let rtDragging = null,
    rtRenderWaiting = false;
const fmt = (value) =>
    value === null || value === undefined ? '—' : Number(value).toLocaleString();

const stamp = (value) => (value ? new Date(value).toLocaleString() : '—');

const phEsc = (s) =>
    String(s ?? '').replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );

function log(message, kind = 'event') {
    const row = document.createElement('div');
    row.textContent = `${new Date().toLocaleTimeString()}  ${kind}: ${message}`;
    $('log').prepend(row);
    while ($('log').children.length > 60) $('log').lastChild.remove();
}

function render(next) {
    state = next;
    const s = state.settings || {},
        l = state.live || {};
    $('heading').value = s.countdown?.heading || '';
    $('targetAt').value = s.countdown?.targetAt || '';
    $('timezone').value = s.countdown?.timezone || '';
    $('title').value = s.stream?.title || '';
    $('category').value = s.stream?.category || '';
    $('message').value = s.stream?.goLiveMessage || '';
    if (document.activeElement !== $('tickerText')) $('tickerText').value = s.ticker?.text || '';
    if (document.activeElement !== $('tickerSpeed')) $('tickerSpeed').value = s.ticker?.speed ?? 90;
    if (document.activeElement !== $('tickerPause')) $('tickerPause').value = s.ticker?.pause ?? 1;
    $('amber').textContent = fmt(l.resources?.amber);
    $('essence').textContent = fmt(l.resources?.essence);
    $('sweetLeaf').textContent = fmt(l.resources?.sweetLeaf);
    $('readerState').textContent = (l.reader?.state || 'offline').toUpperCase();
    $('sessionMode').textContent = (l.session?.mode || 'offline').toUpperCase();
    $('logFile').textContent = l.reader?.file || '—';
    $('lastUpdate').textContent = stamp(l.reader?.lastUpdateAt);
    const needsReconciliation = Boolean(l.reconciliation?.required);
    $('reconcilePanel').hidden = !needsReconciliation;
    document
        .querySelectorAll('[data-correct]')
        .forEach((button) => (button.disabled = needsReconciliation));
    renderGuide();
    if (!panelOrderApplied) {
        applyPanelOrder(s.layout?.panelOrder);
        panelOrderApplied = true;
    }
    if (!rtLayLocal) {
        rtLay = {
            order: Array.isArray(s.layout?.trackerOrder) ? s.layout.trackerOrder : [],
            hidden: Array.isArray(s.layout?.trackerHidden) ? s.layout.trackerHidden : []
        };
        if (typeof rtRender === 'function') rtRender();
    }
}

// ---------------- panel reordering ----------------

$('panelGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-move]');
    if (!b || b.disabled) return;
    const section = b.closest('section[data-panel]');
    if (!section) return;
    movePanel(section.dataset.panel, b.dataset.move);
});

async function load() {
    const r = await fetch('/api/state?_=' + Date.now(), { cache: 'no-store' });
    const p = await r.json();
    render(p);
    await refreshHealth();
    log('state loaded', 'system');
}

async function saveSettings() {
    const p = {
        countdown: {
            heading: $('heading').value,
            targetAt: $('targetAt').value,
            timezone: $('timezone').value
        },
        stream: {
            title: $('title').value,
            category: $('category').value,
            goLiveMessage: $('message').value
        }
    };
    const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
    });
    const out = await r.json();
    $('settingsToast').textContent = out.ok ? 'Saved and broadcast.' : out.error || 'Save failed';
    if (out.ok) log('settings saved', 'settings');
}

async function action(target, payload = {}) {
    const r = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, payload })
    });
    const out = await r.json();
    $('actionToast').textContent = out.action?.message || out.error || 'Action failed';
    log(`${target} -> ${out.action?.status || 'error'}`, 'command');
}

async function correct(resource) {
    const value = $(resource === 'sweetLeaf' ? 'sweetLeafInput' : resource + 'Input').value;
    const r = await fetch('/api/live/' + resource + '/correct', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: Number(value) })
    });
    const out = await r.json();
    log(out.ok ? `${resource} corrected to ${out.value}` : out.error, 'tracker');
}

async function reconcile() {
    const values = {
        amber: $('reconcileAmber').value,
        essence: $('reconcileEssence').value,
        sweetLeaf: $('reconcileSweetLeaf').value
    };
    if (Object.values(values).some((value) => value.trim() === '')) {
        $('actionToast').textContent = 'Enter all three current totals first.';
        return;
    }
    const r = await fetch('/api/live/reconcile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
    });
    const out = await r.json();
    $('actionToast').textContent = out.ok
        ? 'Current totals saved. Live tracking is ready.'
        : out.error || 'Could not reconcile totals.';
    log(out.ok ? 'All tracker totals reconciled' : 'Reconciliation failed', 'tracker');
}

async function saveTicker() {
    const text = $('tickerText').value.trim();
    if (!text) {
        $('tickerToast').textContent = 'Type something for it to scroll.';
        return;
    }
    const speed = Number($('tickerSpeed').value),
        pause = Number($('tickerPause').value);
    if (!Number.isFinite(speed) || speed < 10 || speed > 500) {
        $('tickerToast').textContent = 'Speed must be between 10 and 500.';
        return;
    }
    if (!Number.isFinite(pause) || pause < 0 || pause > 30) {
        $('tickerToast').textContent = 'Pause must be between 0 and 30 seconds.';
        return;
    }
    const r = await fetch('/api/ticker', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed, pause })
    });
    const out = await r.json();
    $('tickerToast').textContent = out.ok
        ? 'Saved — updates live on the overlay.'
        : out.error || 'Save failed';
    if (out.ok) log('ticker settings saved', 'settings');
}

$('saveSettings').onclick = saveSettings;
$('tickerSave').onclick = saveTicker;
[$('tickerText'), $('tickerSpeed'), $('tickerPause')].forEach((el) =>
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveTicker();
        }
    })
);
document
    .querySelectorAll('[data-action]')
    .forEach((b) => (b.onclick = () => action(b.dataset.action)));
document
    .querySelectorAll('[data-mode]')
    .forEach((b) => (b.onclick = () => action('session.set-mode', { mode: b.dataset.mode })));
document
    .querySelectorAll('[data-correct]')
    .forEach((b) => (b.onclick = () => correct(b.dataset.correct)));
$('reconcileTotals').onclick = reconcile;
const events = new EventSource('/events?role=control');
events.addEventListener('snapshot', (e) => {
    render(JSON.parse(e.data));
    refreshHealth();
});
events.addEventListener('settings', (e) => {
    if (state) render({ ...state, settings: JSON.parse(e.data) });
    log('settings updated', 'sse');
});
events.addEventListener('live', (e) => {
    if (state) render({ ...state, live: JSON.parse(e.data) });
    log('live state updated', 'sse');
});
events.addEventListener('action', (e) => {
    const a = JSON.parse(e.data);
    log(`${a.target} ${a.status}`, 'action');
});
events.onerror = () => {
    $('health').classList.add('offline');
    $('healthText').textContent = 'EVENT FEED OFFLINE';
};

setInterval(refreshHealth, 5000);
load().catch((error) => {
    $('health').classList.add('offline');
    $('healthText').textContent = 'START SERVER';
    log(error.message, 'error');
});

// ---- Weekly Accomplishments ----------------------------------------
let WK = { items: [] };

document.addEventListener('click', async (e) => {
    const row = e.target.closest('.wk-i');
    if (row) {
        await wkCall(`/api/weekly/${row.dataset.wk}/toggle`, {}, 'POST');
        return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'wkUndoBtn') await wkCall('/api/weekly/undo-reset', {}, 'POST');
    else if (b.id === 'wkReset') {
        if (confirm('Zero the whole weekly list now? You can undo this.'))
            await wkCall('/api/weekly/reset', {}, 'POST');
    }
});
fetch('/api/weekly', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
        WK = d.weekly || WK;
        wkRender();
    });
events.addEventListener('weekly', (e) => {
    WK = JSON.parse(e.data);
    wkRender();
});

// ---- Resource Trackers ---------------------------------------------
let RT = { cards: [] };

document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rthide) {
        const name = b.closest('.rt')?.querySelector('.rt-name')?.textContent || 'this tracker';
        if (
            !confirm(
                `Remove ${name} from the dashboard?\n\nIt keeps counting and its Meld layer keeps working. You can bring it back from the "Removed from dashboard" list at the bottom.`
            )
        )
            return;
        rtLay.hidden = Array.from(new Set((rtLay.hidden || []).concat(b.dataset.rthide)));
        rtSaveLayout();
        rtRender();
    } else if (b.dataset.rttop) {
        const shown = Array.from($('rtGrid').querySelectorAll('.rt[data-rtid]'))
            .map((x) => x.dataset.rtid)
            .filter((id) => id !== b.dataset.rttop);
        rtLay.order = [b.dataset.rttop].concat(
            shown,
            (rtLay.order || []).filter((id) => id !== b.dataset.rttop && !shown.includes(id))
        );
        rtSaveLayout();
        rtRender();
    } else if (b.dataset.rtshow) {
        rtLay.hidden = (rtLay.hidden || []).filter((id) => id !== b.dataset.rtshow);
        rtSaveLayout();
        rtRender();
    }
});

document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rt)
        await rtCall(`/api/resource-trackers/${b.dataset.rt}/adjust`, {
            delta: Number(b.dataset.d)
        });
    else if (b.dataset.rtsec)
        await rtCall(`/api/resource-trackers/${b.dataset.rtsec}/secondary/adjust`, {
            delta: Number(b.dataset.d)
        });
    else if (b.dataset.rtsecreset) {
        if (confirm(`Reset ${b.dataset.rtresetname || 'this'} to 0? This cannot be undone.`))
            await rtCall(`/api/resource-trackers/${b.dataset.rtsecreset}/secondary/set`, {
                value: 0
            });
    } else if (b.dataset.rtslot)
        await rtCall(`/api/resource-trackers/${b.dataset.rtslot.replace('/', '/slot/')}/adjust`, {
            delta: Number(b.dataset.d)
        });
    else if (b.dataset.rtslotreset) {
        if (confirm(`Reset ${b.dataset.rtresetname || 'this'} to 0? This cannot be undone.`))
            await rtCall(
                `/api/resource-trackers/${b.dataset.rtslotreset.replace('/', '/slot/')}/set`,
                { value: 0 }
            );
    } else if (b.dataset.rtslotstart) {
        const [cardId, slotId] = b.dataset.rtslotstart.split('/');
        const inp = document.getElementById(`slotStart-${cardId}-${slotId}`);
        if (!inp || inp.value === '' || Number(inp.value) < 0) {
            if (inp) inp.focus();
            return;
        }
        const out = await rtCall(`/api/resource-trackers/${cardId}/slot/${slotId}/set-start`, {
            startAt: Number(inp.value)
        });
        if (out && out.ok) inp.value = '';
    } else if (b.dataset.rtslotsreset) {
        if (confirm(`Reset ${b.dataset.rtresetname || 'this'} to 0? This cannot be undone.`))
            await rtCall(
                `/api/resource-trackers/${b.dataset.rtslotsreset}/slots-reset`,
                {},
                'POST'
            );
    } else if (b.dataset.rtstart) {
        const inp = document.getElementById('startInput-' + b.dataset.rtstart);
        const v = inp ? inp.value : '';
        if (v === '' || Number(v) < 0) {
            if (inp) inp.focus();
            return;
        }
        const out = await rtCall(`/api/resource-trackers/${b.dataset.rtstart}/set-start`, {
            startAt: Number(v)
        });
        if (out && out.ok && inp) inp.value = '';
    } else if (b.dataset.rtreset) {
        if (confirm(`Reset ${b.dataset.rtresetname || 'this'} to 0? This cannot be undone.`))
            await rtCall(`/api/resource-trackers/${b.dataset.rtreset}/set`, { value: 0 });
    } else if (b.dataset.rtlivereset) {
        if (
            confirm(
                `Reset ${
                    b.dataset.rtresetname || 'this'
                } to 0? This is your actual live total, used everywhere ICB shows it — not just this card. This cannot be undone.`
            )
        ) {
            const r = await fetch(`/api/live/${b.dataset.rtlivereset}/correct`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: 0 })
            });
            const out = await r.json().catch(() => ({}));
            log(
                out.ok ? `${b.dataset.rtlivereset} reset to 0` : out.error || 'Reset failed',
                'tracker'
            );
            if (out.ok) {
                const rt = await (
                    await fetch('/api/resource-trackers', { cache: 'no-store' })
                ).json();
                if (rt.resourceTrackers) {
                    RT = rt.resourceTrackers;
                    rtRender();
                }
            }
        }
    } else if (b.id === 'rtReset') {
        if (
            confirm(
                'Zero every session resource card? Amber and Essence are not touched, and you can undo this.'
            )
        )
            await rtCall('/api/resource-trackers/reset-session', {}, 'POST');
    } else if (b.id === 'rtUndoBtn') await rtCall('/api/resource-trackers/undo-reset', {}, 'POST');
});
fetch('/api/resource-trackers', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
        RT = d.resourceTrackers || RT;
        rtRender();
    });
events.addEventListener('resourcetrackers', (e) => {
    RT = JSON.parse(e.data);
    rtRender();
});

// ---- Daily / Weekly To-Do -------------------------------------------
// Dashboard-only, no auto-reset (confirmed with Baby 2026-08-25) — she adds and deletes these
// herself. 'daily'/'weekly' here are the API list keys; TODO_DOM maps each to its input ids.
let TODOS = { daily: [], weekly: [] };
const TODO_DOM = { daily: 'todoDaily', weekly: 'todoWeekly' };

for (const list of ['daily', 'weekly']) {
    const p = TODO_DOM[list];
    const kindSelect = $(p + 'Kind'),
        targetInput = $(p + 'Target'),
        textInput = $(p + 'Text');
    if (kindSelect && targetInput)
        kindSelect.addEventListener('change', () => {
            targetInput.style.display = kindSelect.value === 'goal' ? '' : 'none';
        });
    if (textInput)
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                todoAdd(list);
            }
        });
}
document
    .querySelectorAll('[data-todo-add]')
    .forEach((b) => (b.onclick = () => todoAdd(b.dataset.todoAdd)));
document.addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-td-toggle]');
    if (toggle) {
        const item = todoFindItem(toggle.dataset.list, toggle.dataset.td);
        if (item && item.kind === 'check')
            await todoCall(`/api/todos/${toggle.dataset.list}/${toggle.dataset.td}`, {
                done: !item.done
            });
        return;
    }
    const adj = e.target.closest('[data-td-adj]');
    if (adj) {
        await todoCall(`/api/todos/${adj.dataset.list}/${adj.dataset.td}`, {
            delta: Number(adj.dataset.tdAdj)
        });
        return;
    }
    const editEl = e.target.closest('[data-td-edit]');
    if (editEl) {
        const item = todoFindItem(editEl.dataset.list, editEl.dataset.td);
        if (!item) return;
        const input = prompt(
            `Edit "${item.text}" — progress as current/target:`,
            `${item.current}/${item.target}`
        );
        if (input === null) return;
        const parts = input.split('/').map((s) => Number(s.trim()));
        if (
            parts.length !== 2 ||
            !Number.isFinite(parts[0]) ||
            !Number.isFinite(parts[1]) ||
            parts[1] <= 0 ||
            parts[0] < 0
        ) {
            alert('Enter it as current/target, e.g. 5/100');
            return;
        }
        await todoCall(`/api/todos/${editEl.dataset.list}/${editEl.dataset.td}`, {
            current: parts[0],
            target: parts[1]
        });
        return;
    }
    const delBtn = e.target.closest('[data-td-del]');
    if (delBtn) {
        const item = todoFindItem(delBtn.dataset.list, delBtn.dataset.td);
        if (item && !confirm(`Delete "${item.text}"?`)) return;
        await todoCall(`/api/todos/${delBtn.dataset.list}/${delBtn.dataset.td}`, {}, 'DELETE');
    }
});
fetch('/api/todos', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
        TODOS = d.todos || TODOS;
        todoRender();
    });
events.addEventListener('todos', (e) => {
    TODOS = JSON.parse(e.data);
    todoRender();
});
