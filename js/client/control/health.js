/** Startup guidance and connection health. Loaded before the page startup script. */
function guideSteps() {
    const l = state?.live || {};
    const serverUp = Boolean(lastHealth?.ok);
    const overlayConnected = (lastHealth?.connectedClients?.overlay || 0) > 0;
    return [
        {
            label: 'Start the ICB Clean server',
            done: serverUp,
            detail: 'Run <code>start-icb-clean.bat</code> in the ICB-Clean folder. This page connects automatically and the status badge above turns ONLINE. Leave the server window running.'
        },
        {
            label: 'Enter your three current in-game totals (one time)',
            done: serverUp && !l.reconciliation?.required,
            detail: 'Open Palia and read your exact Amber Echo, Infected Essence, and Sweet Leaf totals from your inventory. Type all three into the red panel below and click the button. You only ever do this once — after it, ICB tracks every new pickup automatically.'
        },
        {
            label: 'Start Palia Assistant, then Palia',
            done: l.reader?.state === 'live',
            detail: 'Launch Palia Assistant first so it can log the game, then start Palia. The reader flips to LIVE as soon as new log activity appears — collecting or moving any item works. If it stays OFFLINE after a minute of play, click "Rescan Palia logs" in Runtime status.'
        },
        {
            label: 'Add the overlay to Meld Studio',
            done: overlayConnected,
            detail: 'In Meld Studio, add a Browser layer with the URL <code>http://127.0.0.1:8790/overlay.html</code> — never control.html. This step turns green by itself the moment Meld actually connects, so you know it worked.'
        },
        {
            label: 'Go on-air',
            done: l.session?.mode === 'on-air',
            detail: 'When your stream starts, click "Set on-air" in Runtime status. Use "Set break" and "Set offline" the same way. That\'s it — trackers update live in Chrome and in Meld from here on.'
        }
    ];
}

function renderGuide() {
    const list = $('guide');
    if (!list) return;
    list.innerHTML = '';
    let currentAssigned = false;
    guideSteps().forEach((step, index) => {
        let cls = 'pending';
        if (step.done) cls = 'done';
        else if (!currentAssigned) {
            cls = 'current';
            currentAssigned = true;
        }
        const li = document.createElement('li');
        li.className = 'step ' + cls;
        li.innerHTML = `<div class="step-head"><span class="badge">${
            step.done ? '✓' : index + 1
        }</span><span class="step-label">${step.label}</span><span class="step-state">${
            step.done ? 'DONE' : cls === 'current' ? 'DO THIS NOW' : 'WAITS FOR THE STEP ABOVE'
        }</span></div>${cls === 'current' ? `<div class="step-detail">${step.detail}</div>` : ''}`;
        list.appendChild(li);
    });
}

async function refreshHealth() {
    try {
        const h = await (await fetch('/api/health?_=' + Date.now(), { cache: 'no-store' })).json();
        lastHealth = h;
        $('health').classList.toggle('offline', !h.ok);
        $('healthText').textContent = h.ok ? 'ONLINE' : 'ERROR';
        $('version').textContent = `${h.version} // port ${h.port}`;
        renderGuide();
        return h.ok;
    } catch (error) {
        lastHealth = { ok: false };
        $('health').classList.add('offline');
        $('healthText').textContent = 'DISCONNECTED';
        $('version').textContent = 'Unable to reach ICB Clean';
        renderGuide();
        return false;
    }
}
