const $ = id => document.getElementById(id);
  let state = { entrants: {}, winners: [] };
  const UNI_ICON = '/images/embedded/0335559507566291.png';

  function totalTickets(e){
    return (e.chatTickets||0) + (e.subTickets||0) + (e.giftTickets||0) + (e.bitsTickets||0) + (e.manualTickets||0);
  }

  function breakdownText(e){
    const parts = [];
    if (e.chatTickets) parts.push(`chat ${e.chatTickets}`);
    if (e.subTickets) parts.push(`sub ${e.subTickets}`);
    if (e.giftTickets) parts.push(`gifts ${e.giftTickets}`);
    if (e.bitsTickets) parts.push(`bits ${e.bitsTickets}`);
    if (e.manualTickets) parts.push(`bonus ${e.manualTickets}`);
    return parts.join(' · ') || '—';
  }

  const DISPLAY_FIELDS = ['dEntrantsTitle','dMaxRows','dEmptyMessage','dTicker','dPrizeLabel','dWinnersTitle','dWinnersEmpty','dJarSide','dUnicornSize','dShowNames','dMagic'];
  let displayDirty = false;
  DISPLAY_FIELDS.forEach(id => ['input','change'].forEach(evt => $(id).addEventListener(evt, () => {
    displayDirty = true;
    $('displayStatus').textContent = 'Unsaved changes';
  })));

  function fillDisplay(d){
    if (!d || displayDirty) return; // never clobber what you're typing
    $('dEntrantsTitle').value = d.entrantsTitle || '';
    $('dMaxRows').value = d.maxRows || 10;
    $('dEmptyMessage').value = d.emptyMessage || '';
    $('dTicker').value = (d.tickerMessages || []).join('\n');
    $('dPrizeLabel').value = d.currentPrizeLabel || '';
    $('dWinnersTitle').value = d.winnersTitle || '';
    $('dWinnersEmpty').value = d.winnersEmptyMessage || '';
    $('dJarSide').value = d.jarSide || 'right';
    $('dUnicornSize').value = d.unicornSize || 'medium';
    $('dShowNames').value = d.showNames === true ? 'yes' : 'no';
    $('dMagic').value = d.magic === false ? 'no' : 'yes';
  }

  async function saveDisplay(){
    const body = {
      entrantsTitle: $('dEntrantsTitle').value,
      maxRows: parseInt($('dMaxRows').value, 10) || 10,
      emptyMessage: $('dEmptyMessage').value,
      tickerMessages: $('dTicker').value.split('\n').map(l => l.trim()).filter(Boolean),
      currentPrizeLabel: $('dPrizeLabel').value,
      winnersTitle: $('dWinnersTitle').value,
      winnersEmptyMessage: $('dWinnersEmpty').value,
      jarSide: $('dJarSide').value,
      unicornSize: $('dUnicornSize').value,
      showNames: $('dShowNames').value === 'yes',
      magic: $('dMagic').value === 'yes',
    };
    const res = await fetch('/api/giveaway/display', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) { $('displayStatus').textContent = data.error || 'Could not save.'; return; }
    displayDirty = false;
    fillDisplay(data.display);
    $('displayStatus').textContent = 'Saved — overlays update in a few seconds.';
  }

  async function restoreDisplayDefaults(){
    if (!confirm('Put all board text back to the original wording?')) return;
    const res = await fetch('/api/giveaway/display/reset', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) return;
    displayDirty = false;
    fillDisplay(data.display);
    $('displayStatus').textContent = 'Defaults restored.';
  }

  function subInfoHtml(e){
    const c = e.counts || {};
    let html = '';
    if (c.subMonths) html += `<span class="badge sub">${c.subMonths} mo sub</span>`;
    if (c.giftedSubs) html += `<span class="badge gift">${c.giftedSubs} gifted</span>`;
    if (c.bits) html += `<span class="badge bits">${c.bits} bits</span>`;
    if (e.note) html += `<div class="note-text">${escapeHtml(e.note)}</div>`;
    html += `<button class="note-btn" data-name="${escapeHtml(e.username)}" onclick="editNote(this.dataset.name)">${e.note ? 'edit note' : '+ note'}</button>`;
    return `<div class="subinfo">${html}</div>`;
  }

  async function editNote(name){
    const key = Object.keys(state.entrants || {}).find(k => k.toLowerCase() === name.toLowerCase());
    const current = key ? (state.entrants[key].note || '') : '';
    const note = prompt(`Note for ${name} (e.g. "subbed since March", "tier 3", "VIP"):`, current);
    if (note === null) return;
    await fetch('/api/giveaway/note', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: name, note }) });
  }

  let blockedDirty = false;
  $('blockedList').addEventListener('input', () => { blockedDirty = true; $('blockedStatus').textContent = 'Unsaved changes'; });
  function fillBlocked(list){
    if (!list || blockedDirty) return;
    $('blockedList').value = list.join('\n');
  }
  async function saveBlocked(){
    const names = $('blockedList').value.split('\n').map(n => n.trim()).filter(Boolean);
    const res = await fetch('/api/giveaway/blocked', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ names }) });
    const data = await res.json();
    if (!data.ok) { $('blockedStatus').textContent = data.error || 'Could not save.'; return; }
    blockedDirty = false; fillBlocked(data.blocked);
    $('blockedStatus').textContent = data.removed.length ? `Saved — removed ${data.removed.join(', ')} from the giveaway.` : 'Saved.';
  }

  function renderListener(){
    const l = (state && state.listener) || {};
    const badge = $('listenerBadge'), text = $('listenerText');
    const age = l.lastSeen ? (Date.now() - Date.parse(l.lastSeen)) / 1000 : Infinity;
    const ago = t => { if (!t) return ''; const s = Math.round((Date.now() - Date.parse(t)) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s/60)} min ago` : `${Math.round(s/3600)} h ago`; };
    if (age > 20) {
      badge.className = 'listener bad';
      text.innerHTML = 'Meld listener is NOT running <span class="sub2">— add giveaway-listener.html as a layer in Meld (it must be in your live scene)</span>';
    } else if (l.firehose === 'connected') {
      badge.className = 'listener ok';
      text.innerHTML = `Meld listener connected ✓ <span class="sub2">— ${l.lastEvent ? 'last: ' + escapeHtml(l.lastEvent) + ', ' + ago(l.lastEventAt) : 'no chat events yet (type something in your chat to test)'}</span>`;
    } else if (l.firehose === 'connecting') {
      badge.className = 'listener warn';
      text.innerHTML = 'Listener running, waiting for Meld\'s connection <span class="sub2">— is Meld open? Reload the listener layer if this stays yellow</span>';
    } else {
      badge.className = 'listener bad';
      text.innerHTML = 'Listener running but Firehose didn\'t load <span class="sub2">— check your internet, then reload the listener layer in Meld</span>';
    }
  }
  setInterval(renderListener, 2000);

  let ratesDirty = false;
  ['rChat','rSub','rGift','rBits'].forEach(id => $(id).addEventListener('input', () => { ratesDirty = true; $('ratesStatus').textContent = 'Unsaved changes'; }));
  function fillRates(r){
    if (!r || ratesDirty) return;
    $('rChat').value = r.chatWindow; $('rSub').value = r.subMonth; $('rGift').value = r.giftedSub; $('rBits').value = r.bitsPerUnicorn;
  }
  async function saveRates(){
    const body = { chatWindow: $('rChat').value, subMonth: $('rSub').value, giftedSub: $('rGift').value, bitsPerUnicorn: $('rBits').value };
    const res = await fetch('/api/giveaway/rates', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) { $('ratesStatus').textContent = data.error || 'Could not save.'; return; }
    ratesDirty = false; state.rates = data.rates; fillRates(data.rates); updateGivePreview();
    $('ratesStatus').textContent = 'Saved — everyone re-counted.';
  }

  function render(giveaway){
    state = giveaway;
    fillDisplay(giveaway.display);
    fillRates(giveaway.rates);
    fillBlocked(giveaway.blocked);
    renderJarStatus(giveaway);
    renderListener();
    updateGivePreview();
    const entrants = Object.values(giveaway.entrants || {})
      .map(e => ({ ...e, total: totalTickets(e) }))
      .filter(e => e.total > 0 || e.note)
      .sort((a,b) => b.total - a.total);

    const body = $('entrantsBody');
    if (!entrants.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No entries yet.</td></tr>';
    } else {
      body.innerHTML = entrants.map(e => `
        <tr>
          <td>${escapeHtml(e.username)}${e.mysteryOutfitWon ? ' <span class="breakdown">(won mystery outfit)</span>' : ''}</td>
          <td class="total"><img class="uni-icon" src="${UNI_ICON}" alt="">${e.total}</td>
          <td class="breakdown">${breakdownText(e)}</td>
          <td>${subInfoHtml(e)}</td>
          <td style="text-align:right;"><button class="row-give" data-name="${escapeHtml(e.username)}" onclick="prefillGive(this.dataset.name)">+ Give</button></td>
        </tr>
      `).join('');
    }

    renderGiveLog(giveaway.manualLog);

    const winners = (giveaway.winners || []).slice().reverse();
    const wList = $('winnersList');
    if (!winners.length) {
      wList.innerHTML = '<div style="color:var(--text-dim); font-size:13px;">None yet.</div>';
    } else {
      wList.innerHTML = winners.map(w => `
        <div class="wrow">
          <span>${escapeHtml(w.username)}</span>
          <span class="prize">${w.prize === 'mystery-outfit' ? 'Mystery Outfit' : 'Plushie'} · ${new Date(w.at).toLocaleTimeString()}</span>
        </div>
      `).join('');
    }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function draw(prize){
    const res = await fetch('/api/giveaway/draw', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prize }),
    });
    const data = await res.json();
    const toast = $('winnerToast');
    if (!data.ok) {
      toast.style.display = 'block';
      toast.textContent = data.error || 'Could not draw a winner.';
      toast.style.borderColor = 'var(--bad)';
      return;
    }
    // The stream reveals the winner ~20 s before the draw song ends
    // (~82 s: DEFAULT_SONG_MS 101720 - REVEAL_BEFORE_END_MS 20000 in unicorn-jar.html).
    // Keep it a secret here until then.
    const prizeName = data.winner.prize === 'mystery-outfit' ? 'Mystery Outfit' : 'Plushie';
    const revealAt = Date.now() + 81720;
    toast.style.display = 'block';
    toast.style.borderColor = 'var(--accent)';
    clearInterval(window.__drawTimer);
    const tick = () => {
      const left = Math.ceil((revealAt - Date.now()) / 1000);
      if (left > 0) { toast.textContent = `🎲 ${prizeName} drawing on stream now… winner revealed in ${left}s`; return; }
      clearInterval(window.__drawTimer);
      toast.textContent = `🎉 ${data.winner.username} won the ${prizeName}!`;
    };
    tick(); window.__drawTimer = setInterval(tick, 500);
  }

  async function testDraw(){
    const status = $('testDrawStatus');
    status.textContent = 'Running demo…';
    const res = await fetch('/api/giveaway/draw-test', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prize: 'plushie' }),
    });
    const data = await res.json();
    if (!data.ok) { status.textContent = 'Could not start the demo.'; return; }
    status.textContent = '🧪 Demo running on stream now — IJustABabyTv "wins" every time. Nothing real was touched.';
    setTimeout(() => { if (status.textContent.indexOf('Demo running') === 0 || status.textContent.indexOf('🧪') === 0) status.textContent = ''; }, 8000);
  }

  function setGiveAmount(n){ $('giveAmount').value = n; updateGivePreview(); }

  const KIND_INFO = {
    unicorns:   { label: 'How many fluffy unicorns each', unit: n => `${n} fluffy unicorn${n === 1 ? '' : 's'}`, reason: null },
    subMonths:  { label: 'How many months subscribed', unit: n => `${n} month${n === 1 ? '' : 's'} subbed`, reason: 'Already subbed' },
    giftedSubs: { label: 'How many gifted subs', unit: n => `${n} gifted sub${n === 1 ? '' : 's'}`, reason: 'Gifted subs' },
    bits:       { label: 'How many bits', unit: n => `${n} bits`, reason: 'Cheered bits' },
  };

  function unicornsFor(kind, n){
    const r = state.rates || { subMonth: 2, giftedSub: 4, bitsPerUnicorn: 100 };
    if (kind === 'subMonths') return n * r.subMonth;
    if (kind === 'giftedSubs') return n * r.giftedSub;
    if (kind === 'bits') return Math.floor(n / r.bitsPerUnicorn);
    return n;
  }

  function onKindChange(){
    const k = $('giveKind').value;
    $('giveAmountLabel').textContent = KIND_INFO[k].label;
    if (KIND_INFO[k].reason) $('giveReason').value = KIND_INFO[k].reason;
    const chips = k === 'bits' ? [100, 500, 1000, 5000] : (k === 'subMonths' ? [1, 3, 6, 12] : [1, 2, 5, 10]);
    document.querySelectorAll('.amt-chip').forEach((c, i) => { c.textContent = chips[i]; });
    if (k === 'bits' && parseInt($('giveAmount').value, 10) < 100) $('giveAmount').value = 100;
    updateGivePreview();
  }

  function updateGivePreview(){
    const k = $('giveKind').value, n = parseInt($('giveAmount').value, 10);
    if (k === 'unicorns' || !Number.isFinite(n) || n <= 0) { $('givePreview').textContent = ''; return; }
    const u = unicornsFor(k, n);
    let text = `= ${u} fluffy unicorn${u === 1 ? '' : 's'} each`;
    if (k === 'bits' && n % ((state.rates || {}).bitsPerUnicorn || 100)) text += ' (leftover bits still count toward their next one)';
    $('givePreview').textContent = text;
  }

  function prefillGive(name){
    $('giveNames').value = name;
    $('giveCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('giveAmount').focus();
    $('giveAmount').select();
  }

  function showGiveResult(text, ok){
    const el = $('giveResult');
    el.textContent = text;
    el.className = 'give-result ' + (ok ? 'ok' : 'err');
  }

  async function giveUnicorns(sign){
    const usernames = $('giveNames').value.split(/[,\n]+/).map(n => n.trim()).filter(Boolean);
    const amount = parseInt($('giveAmount').value, 10);
    const kind = $('giveKind').value;
    if (!usernames.length) return showGiveResult('Type at least one name.', false);
    if (!Number.isFinite(amount) || amount <= 0) return showGiveResult('Amount must be 1 or more.', false);
    const delta = sign * amount;
    if (sign < 0 && !confirm(`Take ${KIND_INFO[kind].unit(amount)} away from ${usernames.length === 1 ? usernames[0] : usernames.length + ' people'}?`)) return;
    let data;
    try {
      const res = await fetch('/api/giveaway/manual', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ usernames, kind, amount: delta, reason: $('giveReason').value }),
      });
      data = await res.json();
    } catch (err) {
      return showGiveResult('Could not reach ICB — is it running?', false);
    }
    if (!data.ok) return showGiveResult(data.error || 'Could not save.', false);
    const r = data.results;
    const unit = n => `${Math.abs(n)} fluffy unicorn${Math.abs(n) === 1 ? '' : 's'}`;
    let msg;
    const what = kind === 'unicorns' ? '' : ` (${KIND_INFO[kind].unit(Math.abs(r[0].appliedAmount))})`;
    if (r.length === 1) {
      msg = sign > 0
        ? `Gave ${r[0].username} ${unit(r[0].applied)}${what} — they now have ${r[0].totalTickets}.`
        : `Took ${unit(r[0].applied)}${what} from ${r[0].username} — they now have ${r[0].totalTickets}.`;
    } else {
      msg = `${sign > 0 ? 'Added' : 'Took away'} ${KIND_INFO[kind].unit(amount)}${kind === 'unicorns' ? '' : ' = ' + unit(unicornsFor(kind, amount))} ${sign > 0 ? 'for' : 'from'} each of ${r.length} people.`;
    }
    if (data.skipped && data.skipped.length) msg += ` (skipped blocked: ${data.skipped.join(', ')})`;
    const newOnes = r.filter(x => x.wasNew).length;
    if (newOnes && sign > 0) msg += ` (${newOnes} new to the giveaway)`;
    showGiveResult(msg, true);
    $('giveNames').value = '';
  }

  function renderGiveLog(log){
    const el = $('giveLog');
    const rows = (log || []).slice().reverse().slice(0, 50);
    if (!rows.length) {
      el.innerHTML = '<div style="color:var(--text-dim); font-size:13px;">Nothing given by hand yet.</div>';
      return;
    }
    el.innerHTML = rows.map(x => `
      <div class="log-row">
        <span><span class="amt ${x.delta >= 0 ? 'plus' : 'minus'}">${x.delta >= 0 ? '+' : ''}${x.delta}</span> ${escapeHtml(x.username)}${x.kind && x.kind !== 'unicorns' && KIND_INFO[x.kind] ? ` <span class="meta">(${x.amount < 0 ? '−' : ''}${KIND_INFO[x.kind].unit(Math.abs(x.amount))})</span>` : ''}</span>
        <span class="meta">${escapeHtml(x.reason || '')} · ${new Date(x.at).toLocaleDateString([], {month:'short', day:'numeric'})} ${new Date(x.at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</span>
      </div>`).join('');
  }

  async function emptyJar(){
    if (!confirm('Empty the unicorn jar on stream? Everyone keeps their fluffy unicorns — only the jar starts over.')) return;
    await fetch('/api/giveaway/jar/empty', { method: 'POST' });
  }
  function renderJarStatus(g){
    const j = g && g.jar; if (!j) return;
    const since = j.startedAt ? new Date(j.startedAt).toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' }) : '';
    $('jarStatus').textContent = `In the jar this stream: ${j.total} 🦄${since ? ' · since ' + since : ''}`;
  }

  async function resetWinnersOnly(){
    if (!confirm('Clear the Winners Circle history? This also lets anyone who already won a Mystery Outfit be drawn for one again. Entrants, fluffy unicorn counts, and sub info are NOT touched. This cannot be undone.')) return;
    await fetch('/api/giveaway/winners/reset', { method: 'POST' });
    $('winnerToast').style.display = 'none';
  }

  async function resetGiveaway(){
    if (!confirm('Reset the whole giveaway? This wipes EVERY entrant, fluffy unicorn, sub info, note, winner, and give-history record. Board text and rates are kept. A backup is saved first, so it can be restored from the Backups card.')) return;
    await fetch('/api/giveaway/reset', { method: 'POST' });
    $('winnerToast').style.display = 'none';
  }

  const BACKUP_KIND = { auto: 'Every 5 min', daily: 'Daily', before: 'Before a change', corrupt: 'Damaged file (kept)' };
  async function loadBackups(){
    const box = $('backupList');
    try {
      const data = await (await fetch('/api/giveaway/backups')).json();
      if (!data.ok || !data.backups.length) { box.innerHTML = '<div style="color:var(--text-dim);">No backups yet — the first one is made when ICB starts.</div>'; return; }
      box.innerHTML = data.backups.map(b => {
        const when = new Date(b.at).toLocaleString();
        const tag = b.file.replace(/^[a-z]+_[0-9_-]+_?/i, '').replace(/\.json$/, '').replace(/-/g, ' ');
        const stats = b.entrants === null ? 'unreadable' : `${b.entrants} people · ${b.unicorns} 🦄 · ${b.winners} winners`;
        const btn = b.kind === 'corrupt' || b.entrants === null ? '' : `<button class="btn-ghost" style="padding:3px 10px; font-size:12px;" onclick="restoreBackup('${escapeHtml(b.file)}', '${escapeHtml(when)}')">Restore</button>`;
        return `<div style="display:flex; gap:10px; align-items:center; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="flex:1;"><b>${escapeHtml(when)}</b> <span style="color:var(--text-dim);">— ${escapeHtml(BACKUP_KIND[b.kind] || b.kind)}${tag ? ' (' + escapeHtml(tag) + ')' : ''}</span><br><span style="color:var(--text-dim); font-size:12px;">${escapeHtml(stats)}</span></div>${btn}</div>`;
      }).join('');
    } catch (e) { box.innerHTML = '<div style="color:var(--bad);">Could not load backups.</div>'; }
  }
  async function backupNow(){
    const data = await (await fetch('/api/giveaway/backups/now', { method: 'POST' })).json();
    $('backupStatus').textContent = data.ok ? 'Backed up ✓' : 'Backup failed';
    loadBackups();
  }
  async function restoreBackup(file, when){
    if (!confirm(`Restore the giveaway to how it was at ${when}?\n\nEveryone's fluffy unicorns, winners, notes and settings go back to that moment. A copy of how things are right now is saved first, so you can undo this.`)) return;
    const data = await (await fetch('/api/giveaway/backups/restore', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ file }) })).json();
    $('backupStatus').textContent = data.ok ? `Restored ✓ (current state saved as ${data.safetyCopy})` : (data.error || 'Restore failed');
    loadBackups();
  }
  loadBackups();
  setInterval(loadBackups, 60000);

  async function load(){
    const res = await fetch('/api/giveaway/state');
    const data = await res.json();
    if (data.ok) render(data.giveaway);
  }

  const events = new EventSource('/events?role=control');
  events.addEventListener('giveaway', e => render(JSON.parse(e.data)));
  events.onerror = () => { $('health').classList.add('offline'); $('health').textContent = 'OFFLINE'; };
  events.onopen = () => { $('health').classList.remove('offline'); $('health').textContent = 'connected'; };

  load();

  // The listener's heartbeat only reaches this page when something else
  // changes, so on a quiet chat the badge used to go stale and say
  // "NOT running" after 20 s even though the layer was fine. Ask ICB for
  // the fresh listener status every 5 s instead.
  async function refreshListener(){
    try {
      const d = await (await fetch('/api/giveaway/state')).json();
      if (d.ok && d.giveaway && d.giveaway.listener) { state.listener = d.giveaway.listener; renderListener(); }
    } catch (e) {}
  }
  setInterval(refreshListener, 5000);
