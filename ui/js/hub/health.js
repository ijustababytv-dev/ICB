/** Service health checklist and diagnostic reports. Loaded before the page startup script. */
function agoTxt(t) {
    const s = secs(t);
    if (s === Infinity) return 'never';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
}

function whenTxt(t) {
    return t
        ? new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        : '—';
}

function steps(list) {
    return `<details><summary>How to fix</summary><ol>${list
        .map((x) => `<li>${x}</li>`)
        .join('')}</ol></details>`;
}

function row(level, what, state, extra) {
    return `<div class="crow"><div class="line"><span class="light ${level}"></span><span class="what">${what}</span><span class="state">${state}</span></div>${
        extra || ''
    }</div>`;
}

function buildRows(h) {
    const out = [];
    const levels = [];
    const add = (level, what, state, extra, counts = true) => {
        out.push(row(level, what, state, extra));
        if (counts) levels.push(level);
    };

    if (!h) {
        add(
            'bad',
            'ICB server',
            'ICB isn’t answering. Nothing else can work until it’s running.',
            steps([
                'Open the ICB folder (<code>Documents\\GitHub\\ICB</code>) and double-click <code>restart-icb-clean.bat</code>.',
                'Wait about 10 seconds. This page reconnects by itself.',
                'Then reload the listener layer in Meld.'
            ])
        );
        return { html: out.join(''), levels };
    }
    add(
        'good',
        'ICB server',
        `Running — started ${whenTxt(h.server.startedAt)} (${agoTxt(h.server.startedAt)}).`
    );

    // Listener
    const L = h.listener || {};
    const la = secs(L.lastSeen);
    const reloadBtn = `<div style="margin-top:6px"><button class="sm" onclick="reloadListener()">↻ Reload the listener</button> <span class="startcount" id="reloadNote">${
        L.reloadPending ? 'reload asked — waiting for the layer…' : ''
    }</span></div>`;
    const layerFix = [
        'Make sure Meld is open.',
        `In Meld, the scene you're on needs a browser layer with exactly <code>${LISTENER_URL}</code> <button class="sm" onclick="copyText('${LISTENER_URL}')">copy</button>. Its eye must be on. It's invisible on stream, so size and position don't matter.`,
        'Right-click the layer in Meld and choose reload.',
        'Still red? Restart Meld, then reload the layer again.'
    ];
    if (la > 20)
        add(
            'bad',
            'Meld chat listener',
            L.lastSeen
                ? `Not heard from since ${agoTxt(
                      L.lastSeen
                  )}. The layer isn't loaded in Meld right now.`
                : 'Not heard from since ICB started. The layer isn’t loaded in Meld.',
            steps(layerFix)
        );
    else if (L.firehose === 'connected')
        add(
            'good',
            'Meld chat listener',
            `Connected to Meld${
                L.lastEvent ? ' — last: ' + esc(L.lastEvent) + ' ' + agoTxt(L.lastEventAt) : ''
            }.`,
            reloadBtn
        );
    else if (L.firehose === 'connecting')
        add(
            'warn',
            'Meld chat listener',
            'The layer is loaded, but Meld hasn’t opened its chat connection. It reloads itself after 90 seconds.',
            steps([
                'Check Meld. If it says "disconnected from server", Meld has lost its own connection (not ICB). Restart Meld and make sure you’re signed in to Twitch.',
                'Press Reload the listener below.'
            ]) + reloadBtn
        );
    else
        add(
            'bad',
            'Meld chat listener',
            'The layer is loaded, but it couldn’t download Meld’s connection code. It keeps retrying.',
            steps([
                'Check your internet connection.',
                'Press Reload the listener below, or reload the layer in Meld.'
            ]) + reloadBtn
        );

    // Chat
    const R = h.relay || {};
    const ca = secs(R.lastChatAt);
    if (!R.lastChatAt)
        add(
            la <= 20 && L.firehose === 'connected' ? 'warn' : 'off',
            'Chat reaching ICB',
            `No chat since ICB started (${agoTxt(
                h.server.startedAt
            )}). Type a test message in your chat to check.`,
            steps([
                'Type something in your Twitch chat and watch this line. It should say "a few seconds ago".',
                'Nothing? Make sure the listener line above is green first.',
                'If the listener is green but chat never arrives, Meld isn’t getting your Twitch chat. Check the Twitch connection in Meld’s settings and sign in again.'
            ])
        );
    else
        add(
            ca < 600 ? 'good' : 'warn',
            'Chat reaching ICB',
            `Last chat ${agoTxt(R.lastChatAt)}${
                R.lastChatFrom ? ' from ' + esc(R.lastChatFrom) : ''
            } · ${R.chatSinceStart} message${R.chatSinceStart === 1 ? '' : 's'} since ICB started.${
                ca >= 600 ? ' Quiet — fine if chat is slow or you’re offline.' : ''
            }`,
            ca >= 600
                ? steps([
                      'Type a test message in your chat. If this line doesn’t update, check the listener line and Meld’s Twitch connection.'
                  ])
                : ''
        );

    // Meld platforms
    const M = h.meld || {};
    const conns = Object.entries(M.connections || {});
    const liveTxt =
        M.live === true
            ? 'Meld says you’re LIVE.'
            : M.live === false
            ? 'Meld says you’re offline.'
            : 'Live/offline not reported yet.';
    const chips = conns.length
        ? `<div class="chips">${conns
              .map(
                  ([n, v]) =>
                      `<span class="chip ${
                          v.state === 'CONNECTED' ? 'good' : v.state === 'WAITING' ? 'warn' : 'bad'
                      }">${esc(n)}: ${esc(v.state)}</span>`
              )
              .join('')}</div>`
        : '';
    const disc = conns.filter(([n, v]) => v.state !== 'CONNECTED' && v.state !== 'WAITING');
    add(
        disc.length ? 'warn' : conns.length ? 'good' : 'off',
        'Meld’s platform connections',
        conns.length
            ? `${liveTxt} Updated ${agoTxt(
                  M.connectionsAt
              )}. "WAITING" is normal for platforms you're not streaming to. Meld never lists Twitch here — for Twitch, look at the "Chat reaching ICB" line.`
            : `${liveTxt} Meld hasn’t sent its connection list since ICB started (it comes through the listener).`,
        chips +
            (disc.length
                ? steps([
                      'Something shows DISCONNECTED. In Meld, open that platform’s connection and reconnect or sign in again.'
                  ])
                : ''),
        !!disc.length
    );

    // Overlays
    const pages = {};
    (h.pages || []).forEach((p) => (pages[p.page] = p));
    const ovRows = OVERLAYS.map((o) => {
        const p = pages[o.page];
        const on = p && (p.open > 0 || secs(p.lastSeen) < 30);
        const url = 'http://127.0.0.1:8790' + o.page;
        return `<div class="line" style="margin-top:4px"><span class="light ${
            on ? 'good' : 'off'
        }"></span><span style="min-width:230px">${esc(o.name)}</span><span class="state">${
            on ? 'open' : p ? 'last heard ' + agoTxt(p.lastSeen) : 'not open since ICB started'
        }</span><button class="sm" onclick="copyText('${url}')">copy address</button></div>`;
    }).join('');
    add(
        'off',
        'Overlays in Meld',
        'Which ICB layers are loaded right now. Grey only matters if you want that overlay on stream.',
        `<div style="margin-top:6px">${ovRows}</div>` +
            steps([
                'Grey = Meld doesn’t have that layer loaded. Add it as a browser layer with the copied address, turn its eye on, or reload it.',
                'Green but you can’t see it on stream = it’s loaded but hidden. It may be under another layer, too small, or switched off on its own dashboard. Use that dashboard’s 🧪 Test button.'
            ]),
        false
    );
    if (h.walkers && h.walkers.showChat === false)
        out.push(
            row(
                'off',
                'Chat Unicorns note',
                '"Show what they type" is off on the Chat Unicorns dashboard, so no chat bubbles appear. That’s on purpose if you turned it off.'
            )
        );

    // Palia
    const P = h.palia || {};
    add(
        P.state === 'live' ? 'good' : 'off',
        'Palia log reader',
        P.state === 'live'
            ? `Reading Palia Assistant's log — last item ${agoTxt(P.lastUpdateAt)}.`
            : `Quiet — last item ${agoTxt(P.lastUpdateAt)}. Normal when you're not playing Palia.`,
        P.state === 'live'
            ? ''
            : steps([
                  'Palia Assistant must be running while you play. The trackers read its log file.',
                  'Start playing and pick something up. This should turn green within a few seconds.'
              ]),
        false
    );

    // Backups
    const G = h.giveaway || {};
    const b = G.latestBackup;
    add(
        b && secs(b.at) < 900 ? 'good' : 'warn',
        'Giveaway data & backups',
        `${G.people} people in the giveaway, ${G.winners} winners. Last backup ${
            b ? agoTxt(b.at) : 'never'
        }.`,
        b && secs(b.at) < 900
            ? ''
            : steps([
                  'Backups happen every 5 minutes while ICB runs. If this stays yellow, restart ICB.'
              ])
    );

    return { html: out.join(''), levels };
}

function renderCheck() {
    const { html, levels } = buildRows(lastCheck);
    const open = new Set(
        [...document.querySelectorAll('#checkRows details[open]')].map(
            (d) =>
                d.parentElement.querySelector('.what') &&
                d.parentElement.querySelector('.what').textContent
        )
    );
    $('checkRows').innerHTML = html;
    document.querySelectorAll('#checkRows .crow').forEach((r) => {
        const w = r.querySelector('.what');
        if (w && open.has(w.textContent)) {
            const d = r.querySelector('details');
            if (d) d.open = true;
        }
    });
    const bad = levels.includes('bad'),
        warn = levels.includes('warn');
    const sEl = $('checkSummary');
    sEl.className = 'summary ' + (bad ? 'bad' : warn ? 'warn' : 'good');
    sEl.textContent = bad
        ? 'Something needs fixing'
        : warn
        ? 'Mostly OK — check yellow'
        : 'Everything connected ✓';
    $('checkTime').textContent =
        'checked ' +
        new Date().toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
        });
}

async function pollCheck() {
    try {
        const r = await fetch('/api/connection-check', { cache: 'no-store' });
        lastCheck = await r.json();
        if (!lastCheck.ok) lastCheck = null;
    } catch (e) {
        lastCheck = null;
    }
    renderCheck();
}

async function reloadListener() {
    try {
        await fetch('/api/connection-check/reload-listener', { method: 'POST' });
        toast('Asked the listener to reload');
    } catch (e) {
        toast('ICB isn’t answering');
    }
    pollCheck();
}

function copyText(t) {
    const done = () => toast('Copied');

    if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t));
    else fallbackCopy(t);
}

function fallbackCopy(t) {
    const a = document.createElement('textarea');
    a.value = t;
    document.body.appendChild(a);
    a.select();
    try {
        document.execCommand('copy');
        toast('Copied');
    } catch (e) {}
    a.remove();
}

function copyReport() {
    const lines = ['ICB status report — ' + new Date().toString()];
    document.querySelectorAll('#checkRows .crow').forEach((r) => {
        const l = r.querySelector('.light');
        const lvl = l
            ? l.classList.contains('good')
                ? 'OK '
                : l.classList.contains('warn')
                ? 'WARN'
                : l.classList.contains('bad')
                ? 'BAD '
                : '--  '
            : '';
        lines.push(
            `[${lvl}] ${r.querySelector('.what').textContent}: ${
                r.querySelector('.state').textContent
            }`
        );
        r.querySelectorAll('.chip').forEach((c) => lines.push('        ' + c.textContent));
        r.querySelectorAll(':scope > div > .line').forEach((x) => {
            const sp = x.querySelectorAll('span');
            lines.push(
                '        ' +
                    (sp[1] ? sp[1].textContent : '') +
                    ': ' +
                    (sp[2] ? sp[2].textContent : '')
            );
        });
    });
    lines.push('', 'Raw data:', JSON.stringify(lastCheck, null, 1));
    copyText(lines.join('\n'));
}
