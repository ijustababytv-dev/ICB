const $ = id => document.getElementById(id);
  let tiles = [];
  let dragId = null;

  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2000); }

  // ---------------- Title & go-live randomizer ----------------
  let RZ = null, rzGameId = null, rzRaw = { title: '', golive: '' }, rzLocked = { title: false, golive: false }, rzDirty = false;
  function rzGame(){ return RZ && (RZ.games.find(g => g.id === rzGameId) || RZ.games[0]); }
  function rzFill(msg, title){ return String(msg || '').split('{title}').join(title || '').split('{link}').join((RZ && RZ.link) || '').replace(/\s+/g, ' ').trim(); }
  function rzPick(list, recentKey){
    if (!list.length) return '';
    const recent = (RZ.recent[recentKey] || []);
    const avoid = Math.min(5, list.length - 1);
    const pool = list.filter(x => recent.slice(0, avoid).indexOf(x) < 0);
    const pick = (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))];
    RZ.recent[recentKey] = [pick].concat(recent.filter(x => x !== pick)).slice(0, 10);
    return pick;
  }
  async function rzLoad(){
    try { const d = await (await fetch('/api/randomizer', { cache: 'no-store' })).json(); if (!d.ok) return; RZ = d; }
    catch (e) { return; }
    if (!rzGameId || !RZ.games.some(g => g.id === rzGameId)) rzGameId = RZ.games[0].id;
    const g = rzGame();
    // Show the last picks again after a refresh.
    rzRaw.title = (RZ.recent[g.id + ':title'] || [])[0] || '';
    rzRaw.golive = (RZ.recent[g.id + ':golive'] || [])[0] || '';
    rzRender(true);
  }
  function rzRender(lists){
    const g = rzGame(); if (!g) return;
    $('rzGames').innerHTML = RZ.games.map(x => `<button class="rz-game ${x.id === g.id ? 'on' : ''}" onclick="rzSwitch('${x.id}')">${esc(x.name)}</button>`).join('');
    $('rzTitle').textContent = rzRaw.title || (g.titles.length ? 'Press 🎲 Randomize' : 'No titles yet — add some below');
    $('rzGolive').textContent = rzRaw.golive ? rzFill(rzRaw.golive, rzTitleText()) : (g.golives.length ? 'Press 🎲 Randomize' : 'No go-live messages yet — add some below');
    rzCounts();
    for (const k of ['title', 'golive']) {
      const btn = $(k === 'title' ? 'rzLockTitle' : 'rzLockGolive');
      btn.textContent = rzLocked[k] ? '🔒 Kept' : '🔓 Keep this one';
      $(k === 'title' ? 'rzTitleBox' : 'rzGoliveBox').classList.toggle('locked', rzLocked[k]);
    }
    document.querySelectorAll('.rzGameName').forEach(el => el.textContent = g.name);
    if (lists && !rzDirty) {
      $('rzTitles').value = g.titles.join('\n'); $('rzGolives').value = g.golives.join('\n'); $('rzLink').value = RZ.link || '';
      $('rzTitlesN').textContent = g.titles.length; $('rzGolivesN').textContent = g.golives.length;
    }
  }
  function rzTitleText(){ return rzRaw.title ? $('rzTitle').textContent : ''; }
  function rzCounts(){
    const t = rzRaw.title ? $('rzTitle').textContent : '', m = rzRaw.golive ? $('rzGolive').textContent : '';
    const tc = $('rzTitleCount'); tc.textContent = t ? `${t.length} / 140` : ''; tc.classList.toggle('over', t.length > 140);
    $('rzGoliveCount').textContent = m ? `${m.length} characters` : '';
  }
  function rzEdited(){ rzCounts(); }
  async function rzRoll(which){
    const g = rzGame(); if (!g) return;
    if ((!which || which === 'title') && (which === 'title' || !rzLocked.title)) rzRaw.title = rzPick(g.titles, g.id + ':title');
    if ((!which || which === 'golive') && (which === 'golive' || !rzLocked.golive)) rzRaw.golive = rzPick(g.golives, g.id + ':golive');
    $('rzTitle').textContent = rzRaw.title;   // so the go-live message uses the new title
    rzRender(false);
    try { await fetch('/api/randomizer', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(RZ) }); } catch (e) {}
  }
  function rzLock(k){
    rzLocked[k] = !rzLocked[k];
    $(k === 'title' ? 'rzLockTitle' : 'rzLockGolive').textContent = rzLocked[k] ? '🔒 Kept' : '🔓 Keep this one';
    $(k === 'title' ? 'rzTitleBox' : 'rzGoliveBox').classList.toggle('locked', rzLocked[k]);
  }
  function rzCopy(which){
    const t = rzRaw.title ? $('rzTitle').textContent.trim() : '', m = rzRaw.golive ? $('rzGolive').textContent.trim() : '';
    const text = which === 'title' ? t : which === 'golive' ? m : [t, m].filter(Boolean).join('\n\n');
    if (!text) return toast('Press 🎲 Randomize first');
    const done = () => toast(which === 'both' ? 'Title and message copied' : which === 'title' ? 'Title copied' : 'Message copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy:', text)); else prompt('Copy:', text);
  }
  function rzSwitch(id){
    if (rzDirty && !confirm('You have unsaved changes to the lists. Switch games anyway?')) return;
    rzDirty = false; rzGameId = id; rzLocked = { title: false, golive: false };
    const g = rzGame();
    rzRaw.title = (RZ.recent[g.id + ':title'] || [])[0] || ''; rzRaw.golive = (RZ.recent[g.id + ':golive'] || [])[0] || '';
    rzRender(true);
  }
  async function rzPut(next, msg){
    const r = await fetch('/api/randomizer', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const d = await r.json().catch(() => ({ ok: false }));
    if (!d.ok) { toast(d.error || 'Could not save — is ICB running?'); return false; }
    RZ = d; rzDirty = false; if (msg) toast(msg); return true;
  }
  async function rzSave(){
    const g = rzGame(); if (!g) return;
    const lines = id => $(id).value.split('\n').map(x => x.trim()).filter(Boolean);
    const next = JSON.parse(JSON.stringify(RZ));
    const ng = next.games.find(x => x.id === g.id);
    ng.titles = lines('rzTitles'); ng.golives = lines('rzGolives'); next.link = $('rzLink').value.trim();
    if (await rzPut(next, `Saved — ${ng.titles.length} titles, ${ng.golives.length} go-live messages`)) rzRender(true);
  }
  async function rzAddGame(){
    const name = $('rzNewGame').value.trim(); if (!name) return toast('Type the game name first');
    const next = JSON.parse(JSON.stringify(RZ)); next.games.push({ name, titles: [], golives: [] });
    if (await rzPut(next, `Added ${name} — now add its titles`)) { $('rzNewGame').value = ''; rzGameId = RZ.games[RZ.games.length - 1].id; rzRaw = { title: '', golive: '' }; rzRender(true); }
  }
  async function rzRenameGame(){
    const g = rzGame(); const name = prompt('New name for ' + g.name + ':', g.name); if (!name || !name.trim()) return;
    const next = JSON.parse(JSON.stringify(RZ)); next.games.find(x => x.id === g.id).name = name.trim();
    if (await rzPut(next, 'Renamed')) rzRender(true);
  }
  async function rzDeleteGame(){
    const g = rzGame();
    if (RZ.games.length < 2) return toast('Keep at least one game');
    if (!confirm(`Delete ${g.name} and all its titles and go-live messages?`)) return;
    const next = JSON.parse(JSON.stringify(RZ)); next.games = next.games.filter(x => x.id !== g.id);
    if (await rzPut(next, `${g.name} deleted`)) { rzGameId = RZ.games[0].id; rzRaw = { title: '', golive: '' }; rzRender(true); }
  }
  document.addEventListener('input', e => { if (e.target && (e.target.id === 'rzTitles' || e.target.id === 'rzGolives' || e.target.id === 'rzLink')) rzDirty = true; });
  rzLoad();
  async function save(body){
    const res = await fetch('/api/hub', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({ ok:false }));
    if (d.ok) render(d.tiles); else toast(d.error || 'Could not save');
    return d;
  }
  const customList = () => tiles.filter(t => !t.builtin).map(({ id, icon, name, url, desc }) => ({ id, icon, name, url, desc }));

  function render(list){
    tiles = list;
    const n = tiles.filter(t => t.startup).length;
    $('startcount').textContent = n ? `${n} page${n === 1 ? '' : 's'} open automatically when ICB starts.` : 'Nothing is set to open automatically when ICB starts.';
    $('grid').innerHTML = tiles.map(t => `
      <div class="tile" draggable="true" data-id="${esc(t.id)}">
        <span class="grip" title="Drag to move">⋮⋮</span>
        <div class="top"><div class="icon">${esc(t.icon)}</div><div class="name">${esc(t.name)}</div></div>
        <div class="desc">${esc(t.desc || '')}</div>
        <div class="url">${esc(t.url)}</div>
        <div class="row">
          <a class="open" href="${esc(t.url)}" target="icb-${esc(t.id)}" draggable="false">Open</a>
          ${t.builtin ? '' : `<button class="mini" title="Edit" onclick="editCustom('${esc(t.id)}')">✎</button><button class="mini" title="Remove" onclick="removeCustom('${esc(t.id)}')">✕</button>`}
        </div>
        <label class="start ${t.startup ? 'on' : ''}"><input type="checkbox" ${t.startup ? 'checked' : ''} onchange="toggleStartup('${esc(t.id)}', this.checked)"> Open when ICB starts</label>
      </div>`).join('');
    for (const el of document.querySelectorAll('.tile')) wireDrag(el);
  }

  function wireDrag(el){
    el.addEventListener('dragstart', e => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
    el.addEventListener('dragover', e => { if (!dragId || dragId === el.dataset.id) return; e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('over');
      const from = tiles.findIndex(t => t.id === dragId), to = tiles.findIndex(t => t.id === el.dataset.id);
      if (from < 0 || to < 0 || from === to) return;
      const moved = tiles.splice(from, 1)[0];
      tiles.splice(to, 0, moved);
      render(tiles);                       // show it right away
      save({ order: tiles.map(t => t.id) });
      dragId = null;
    });
  }

  function toggleStartup(id, on){
    const startup = tiles.filter(t => t.id === id ? on : t.startup).map(t => t.id);
    save({ startup }).then(d => d.ok && toast(on ? 'Will open when ICB starts' : 'Won’t open at start'));
  }
  function addCustom(){
    const name = $('cName').value.trim(), url = $('cUrl').value.trim(), icon = $('cIcon').value.trim() || '🔗';
    if (!name || !url) return toast('Give it a name and a link');
    if (!/^(https?:\/\/|\/)/i.test(url)) return toast('Links start with https:// or / (for an ICB page)');
    const custom = customList().concat([{ id: 'c' + Date.now(), icon, name, url, desc: '' }]);
    save({ custom }).then(d => { if (d.ok) { $('cName').value = ''; $('cUrl').value = ''; $('cIcon').value = ''; toast('Added'); } });
  }
  function editCustom(id){
    const t = tiles.find(x => x.id === id); if (!t) return;
    const name = prompt('Name:', t.name); if (name === null) return;
    const url = prompt('Link:', t.url); if (url === null) return;
    const icon = prompt('Icon (an emoji):', t.icon); if (icon === null) return;
    const desc = prompt('Short description (optional):', t.desc || ''); if (desc === null) return;
    save({ custom: customList().map(c => c.id === id ? { ...c, name: name.trim() || c.name, url: url.trim() || c.url, icon: icon.trim() || c.icon, desc: desc.trim() } : c) });
  }
  function removeCustom(id){
    const t = tiles.find(x => x.id === id);
    if (!t || !confirm(`Remove the "${t.name}" tile?`)) return;
    save({ custom: customList().filter(c => c.id !== id) });
  }

  function tick(){ $('clock').textContent = new Date().toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' }); }
  tick(); setInterval(tick, 15000);

  async function load(){ try { const d = await (await fetch('/api/hub')).json(); if (d.ok) render(d.tiles); } catch (e) {} }
  const events = new EventSource('/events?role=control');
  events.addEventListener('hub', e => { if (!dragId) render(JSON.parse(e.data).tiles); });
  events.onerror = () => { $('health').classList.add('offline'); $('health').textContent = 'ICB offline'; };
  events.onopen = () => { $('health').classList.remove('offline'); $('health').textContent = 'connected'; };

  // ---------------- Connection check ----------------
  const OVERLAYS = [
    { page: '/giveaway-listener.html', name: 'Meld chat listener (invisible)', key: true },
    { page: '/unicorn-jar.html', name: 'Unicorn jar' },
    { page: '/walkers.html', name: 'Chat Unicorns' },
    { page: '/giveaway-entrants.html', name: 'Giveaway entrants board' },
    { page: '/giveaway-winners.html', name: 'Winners Circle' },
  ];
  let lastCheck = null, lastCheckErr = null;
  const secs = t => t ? Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)) : Infinity;
  function agoTxt(t){ const s = secs(t); if (s === Infinity) return 'never'; if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s/60) + ' min ago'; if (s < 172800) return Math.round(s/3600) + ' h ago'; return Math.round(s/86400) + ' days ago'; }
  function whenTxt(t){ return t ? new Date(t).toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' }) : '—'; }
  function steps(list){ return `<details><summary>How to fix</summary><ol>${list.map(x => `<li>${x}</li>`).join('')}</ol></details>`; }
  function row(level, what, state, extra){ return `<div class="crow"><div class="line"><span class="light ${level}"></span><span class="what">${what}</span><span class="state">${state}</span></div>${extra || ''}</div>`; }
  const LISTENER_URL = 'http://127.0.0.1:8790/giveaway-listener.html';

  function buildRows(h){
    const out = []; const levels = [];
    const add = (level, what, state, extra, counts = true) => { out.push(row(level, what, state, extra)); if (counts) levels.push(level); };

    if (!h) {
      add('bad', 'ICB server', 'ICB isn’t answering. Nothing else can work until it’s running.', steps([
        'Open the ICB folder (<code>Documents\\GitHub\\ICB</code>) and double-click <code>restart-icb-clean.bat</code>.',
        'Wait about 10 seconds. This page reconnects by itself.',
        'Then reload the listener layer in Meld.' ]));
      return { html: out.join(''), levels };
    }
    add('good', 'ICB server', `Running — started ${whenTxt(h.server.startedAt)} (${agoTxt(h.server.startedAt)}).`);

    // Listener
    const L = h.listener || {}; const la = secs(L.lastSeen);
    const reloadBtn = `<div style="margin-top:6px"><button class="sm" onclick="reloadListener()">↻ Reload the listener</button> <span class="startcount" id="reloadNote">${L.reloadPending ? 'reload asked — waiting for the layer…' : ''}</span></div>`;
    const layerFix = [
      'Make sure Meld is open.',
      `In Meld, the scene you're on needs a browser layer with exactly <code>${LISTENER_URL}</code> <button class="sm" onclick="copyText('${LISTENER_URL}')">copy</button>. Its eye must be on. It's invisible on stream, so size and position don't matter.`,
      'Right-click the layer in Meld and choose reload.',
      'Still red? Restart Meld, then reload the layer again.' ];
    if (la > 20) add('bad', 'Meld chat listener', L.lastSeen ? `Not heard from since ${agoTxt(L.lastSeen)}. The layer isn't loaded in Meld right now.` : 'Not heard from since ICB started. The layer isn’t loaded in Meld.', steps(layerFix));
    else if (L.firehose === 'connected') add('good', 'Meld chat listener', `Connected to Meld${L.lastEvent ? ' — last: ' + esc(L.lastEvent) + ' ' + agoTxt(L.lastEventAt) : ''}.`, reloadBtn);
    else if (L.firehose === 'connecting') add('warn', 'Meld chat listener', 'The layer is loaded, but Meld hasn’t opened its chat connection. It reloads itself after 90 seconds.', steps([
      'Check Meld. If it says "disconnected from server", Meld has lost its own connection (not ICB). Restart Meld and make sure you’re signed in to Twitch.',
      'Press Reload the listener below.' ]) + reloadBtn);
    else add('bad', 'Meld chat listener', 'The layer is loaded, but it couldn’t download Meld’s connection code. It keeps retrying.', steps([
      'Check your internet connection.', 'Press Reload the listener below, or reload the layer in Meld.' ]) + reloadBtn);

    // Chat
    const R = h.relay || {}; const ca = secs(R.lastChatAt);
    if (!R.lastChatAt) add(la <= 20 && L.firehose === 'connected' ? 'warn' : 'off', 'Chat reaching ICB', `No chat since ICB started (${agoTxt(h.server.startedAt)}). Type a test message in your chat to check.`, steps([
      'Type something in your Twitch chat and watch this line. It should say "a few seconds ago".',
      'Nothing? Make sure the listener line above is green first.',
      'If the listener is green but chat never arrives, Meld isn’t getting your Twitch chat. Check the Twitch connection in Meld’s settings and sign in again.' ]));
    else add(ca < 600 ? 'good' : 'warn', 'Chat reaching ICB', `Last chat ${agoTxt(R.lastChatAt)}${R.lastChatFrom ? ' from ' + esc(R.lastChatFrom) : ''} · ${R.chatSinceStart} message${R.chatSinceStart === 1 ? '' : 's'} since ICB started.${ca >= 600 ? ' Quiet — fine if chat is slow or you’re offline.' : ''}`,
      ca >= 600 ? steps(['Type a test message in your chat. If this line doesn’t update, check the listener line and Meld’s Twitch connection.']) : '');

    // Meld platforms
    const M = h.meld || {}; const conns = Object.entries(M.connections || {});
    const liveTxt = M.live === true ? 'Meld says you’re LIVE.' : M.live === false ? 'Meld says you’re offline.' : 'Live/offline not reported yet.';
    const chips = conns.length ? `<div class="chips">${conns.map(([n, v]) => `<span class="chip ${v.state === 'CONNECTED' ? 'good' : v.state === 'WAITING' ? 'warn' : 'bad'}">${esc(n)}: ${esc(v.state)}</span>`).join('')}</div>` : '';
    const disc = conns.filter(([n, v]) => v.state !== 'CONNECTED' && v.state !== 'WAITING');
    add(disc.length ? 'warn' : (conns.length ? 'good' : 'off'), 'Meld’s platform connections',
      conns.length ? `${liveTxt} Updated ${agoTxt(M.connectionsAt)}. "WAITING" is normal for platforms you're not streaming to. Meld never lists Twitch here — for Twitch, look at the "Chat reaching ICB" line.` : `${liveTxt} Meld hasn’t sent its connection list since ICB started (it comes through the listener).`,
      chips + (disc.length ? steps(['Something shows DISCONNECTED. In Meld, open that platform’s connection and reconnect or sign in again.']) : ''), !!disc.length);

    // Overlays
    const pages = {}; (h.pages || []).forEach(p => pages[p.page] = p);
    const ovRows = OVERLAYS.map(o => {
      const p = pages[o.page]; const on = p && (p.open > 0 || secs(p.lastSeen) < 30);
      const url = 'http://127.0.0.1:8790' + o.page;
      return `<div class="line" style="margin-top:4px"><span class="light ${on ? 'good' : 'off'}"></span><span style="min-width:230px">${esc(o.name)}</span><span class="state">${on ? 'open' : (p ? 'last heard ' + agoTxt(p.lastSeen) : 'not open since ICB started')}</span><button class="sm" onclick="copyText('${url}')">copy address</button></div>`;
    }).join('');
    add('off', 'Overlays in Meld', 'Which ICB layers are loaded right now. Grey only matters if you want that overlay on stream.',
      `<div style="margin-top:6px">${ovRows}</div>` + steps([
        'Grey = Meld doesn’t have that layer loaded. Add it as a browser layer with the copied address, turn its eye on, or reload it.',
        'Green but you can’t see it on stream = it’s loaded but hidden. It may be under another layer, too small, or switched off on its own dashboard. Use that dashboard’s 🧪 Test button.' ]), false);
    if (h.walkers && h.walkers.showChat === false) out.push(row('off', 'Chat Unicorns note', '"Show what they type" is off on the Chat Unicorns dashboard, so no chat bubbles appear. That’s on purpose if you turned it off.'));

    // Palia
    const P = h.palia || {};
    add(P.state === 'live' ? 'good' : 'off', 'Palia log reader', P.state === 'live' ? `Reading Palia Assistant's log — last item ${agoTxt(P.lastUpdateAt)}.` : `Quiet — last item ${agoTxt(P.lastUpdateAt)}. Normal when you're not playing Palia.`,
      P.state === 'live' ? '' : steps(['Palia Assistant must be running while you play. The trackers read its log file.', 'Start playing and pick something up. This should turn green within a few seconds.']), false);

    // Backups
    const G = h.giveaway || {}; const b = G.latestBackup;
    add(b && secs(b.at) < 900 ? 'good' : 'warn', 'Giveaway data & backups', `${G.people} people in the giveaway, ${G.winners} winners. Last backup ${b ? agoTxt(b.at) : 'never'}.`,
      b && secs(b.at) < 900 ? '' : steps(['Backups happen every 5 minutes while ICB runs. If this stays yellow, restart ICB.']));

    return { html: out.join(''), levels };
  }

  function renderCheck(){
    const { html, levels } = buildRows(lastCheck);
    const open = new Set([...document.querySelectorAll('#checkRows details[open]')].map(d => d.parentElement.querySelector('.what') && d.parentElement.querySelector('.what').textContent));
    $('checkRows').innerHTML = html;
    document.querySelectorAll('#checkRows .crow').forEach(r => { const w = r.querySelector('.what'); if (w && open.has(w.textContent)) { const d = r.querySelector('details'); if (d) d.open = true; } });
    const bad = levels.includes('bad'), warn = levels.includes('warn');
    const sEl = $('checkSummary');
    sEl.className = 'summary ' + (bad ? 'bad' : warn ? 'warn' : 'good');
    sEl.textContent = bad ? 'Something needs fixing' : warn ? 'Mostly OK — check yellow' : 'Everything connected ✓';
    $('checkTime').textContent = 'checked ' + new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit', second:'2-digit' });
  }
  async function pollCheck(){
    try { const r = await fetch('/api/connection-check', { cache: 'no-store' }); lastCheck = await r.json(); if (!lastCheck.ok) lastCheck = null; }
    catch (e) { lastCheck = null; }
    renderCheck();
  }
  async function reloadListener(){
    try { await fetch('/api/connection-check/reload-listener', { method: 'POST' }); toast('Asked the listener to reload'); } catch (e) { toast('ICB isn’t answering'); }
    pollCheck();
  }
  function copyText(t){
    const done = () => toast('Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t));
    else fallbackCopy(t);
  }
  function fallbackCopy(t){ const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e) {} a.remove(); }
  function copyReport(){
    const lines = ['ICB status report — ' + new Date().toString()];
    document.querySelectorAll('#checkRows .crow').forEach(r => {
      const l = r.querySelector('.light'); const lvl = l ? (l.classList.contains('good') ? 'OK ' : l.classList.contains('warn') ? 'WARN' : l.classList.contains('bad') ? 'BAD ' : '--  ') : '';
      lines.push(`[${lvl}] ${r.querySelector('.what').textContent}: ${r.querySelector('.state').textContent}`);
      r.querySelectorAll('.chip').forEach(c => lines.push('        ' + c.textContent));
      r.querySelectorAll(':scope > div > .line').forEach(x => { const sp = x.querySelectorAll('span'); lines.push('        ' + (sp[1] ? sp[1].textContent : '') + ': ' + (sp[2] ? sp[2].textContent : '')); });
    });
    lines.push('', 'Raw data:', JSON.stringify(lastCheck, null, 1));
    copyText(lines.join('\n'));
  }
  pollCheck(); setInterval(pollCheck, 5000);
  load();
