const $ = id => document.getElementById(id);
  let state = null;
  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(m){ const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2000); }
  async function api(path, method = 'GET', body){
    const res = await fetch(path, { method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({ ok:false }));
    if (!d.ok) toast(d.error || 'Something went wrong');
    return d;
  }

  const LINK = location.origin + '/walkers.html';
  $('link').textContent = LINK;
  function copyLink(){ navigator.clipboard.writeText(LINK).then(() => toast('Link copied - paste into a full-screen Meld browser layer'), () => prompt('Copy:', LINK)); }

  let dragging = false, remDirty = false;
  $('reminders').addEventListener('input', () => { remDirty = true; $('remStatus').textContent = 'Unsaved changes'; });

  function render(d){
    state = d;
    const s = d.settings;
    $('enabled').checked = s.enabled;
    $('enabledText').innerHTML = s.enabled ? '<b style="color:var(--accent)">ON</b> - chatters\' unicorns appear on stream' : 'OFF - no unicorns on stream';
    $('artFacesLeft').checked = s.artFacesLeft;
    $('faceText').textContent = s.artFacesLeft ? 'left' : 'right';
    if (!dragging) {
      for (const [k, f] of [['size', v => v + 'px'], ['speed', v => v.toFixed(1) + '×'], ['afkMinutes', v => v + ' min'], ['bubbleSeconds', v => v + ' sec'], ['reminderEveryMinutes', v => v ? v + ' min' : 'off']]) {
        $(k).value = s[k]; $(k + '-v').textContent = f(Number(s[k]));
      }
    }
    if (!remDirty) $('reminders').value = s.reminders.join('\n');
    if (d.fonts && !$('nameFont').options.length) $('nameFont').innerHTML = d.fonts.map(f => `<option value="${esc(f)}" style="font-family:'${esc(f)}'">${esc(f)}</option>`).join('');
    $('namePosition').value = s.namePosition; $('nameFont').value = s.nameFont;
    for (const k of ['nameColor', 'nameOutlineColor', 'nameBgColor']) $(k).value = s[k];
    for (const k of ['nameBold', 'nameBackground', 'showChat']) $(k).checked = s[k];
    $('showChatText').textContent = s.showChat ? 'Show what they type in speech bubbles' : 'Chat bubbles are OFF';
    if (!dragging) for (const [k, f] of [['nameSize', v => v + 'px'], ['nameOutlineWidth', v => v ? v + 'px' : 'none'], ['chatTextSize', v => v + 'px']]) { $(k).value = s[k]; $(k + '-v').textContent = f(Number(s[k])); }
    renderAnims();
    renderPreview();
    $('art').innerHTML = d.art.length ? d.art.map(f => `<div class="pt"><img src="/decor-art/unicorn/${encodeURIComponent(f)}" title="${esc(f)}"><span class="fn" title="${esc(f)}">${esc(f)}</span><button onclick="moveArt(${esc(JSON.stringify(f))}, 'subs')" title="Make this a subscriber-only picture">⭐ subs only</button></div>`).join('') : '<span class="note" style="margin:0">No pictures in the random pool yet.</span>';
    const subArt = d.subArt || [];
    $('subArt').innerHTML = subArt.length ? subArt.map(f => `<div class="pt"><img src="/decor-art/unicorn-subs/${encodeURIComponent(f)}" title="${esc(f)}"><span class="fn" title="${esc(f)}">${esc(f)}</span><button onclick="moveArt(${esc(JSON.stringify(f))}, 'all')" title="Put this back in everyone's random pool">🎲 to everyone</button></div>`).join('') : '<span class="note" style="margin:0">No subscriber-only pictures yet — drop some below, or press ⭐ subs only on a picture above.</span>';
    $('subsAuto').checked = s.subsAuto !== false;
    $('subsAutoText').innerHTML = s.subsAuto !== false ? 'Subs with no picture picked get a <b>random subscriber-only</b> picture' : 'Subs with no picture picked get a random picture from <b>everyone\'s pool</b>';
    $('whoGets').value = s.whoGets || 'everyone';
    renderPeople();
  }

  // ---- animations ----
  function renderAnims(){
    const s = state.settings, list = state.anims || [];
    if (state.entrances && !$('entrance').options.length) $('entrance').innerHTML = Object.entries(state.entrances).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    if (state.exits && !$('exitStyle').options.length) $('exitStyle').innerHTML = Object.entries(state.exits).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('entrance').value = s.entrance; $('exitStyle').value = s.exitStyle;
    if (dragging) return;
    $('trickGap').value = s.trickGap; $('trickGap-v').textContent = '~' + s.trickGap + ' sec';
    const row = a => {
      const cur = (s.anims || {})[a.id] || { on: a.on, often: a.often };
      return `<div class="anim ${cur.on ? '' : 'off'}">
        <label class="switch"><input type="checkbox" ${cur.on ? 'checked' : ''} onchange="setAnim('${a.id}', { on: this.checked })"><span></span></label>
        <div><div class="anim-name">${esc(a.label)}</div><div class="anim-desc">${esc(a.desc)}</div></div>
        <input type="range" min="1" max="10" step="1" value="${cur.often}" title="How often" oninput="oftenSlide('${a.id}', this)">
        <output id="often-${a.id}">${cur.often}</output>
        <button onclick="tryAnim('${a.id}')">▶ Try</button>
      </div>`;
    };
    $('animMove').innerHTML = list.filter(a => a.kind === 'move').map(row).join('');
    $('animTrick').innerHTML = list.filter(a => a.kind === 'trick').map(row).join('');
  }
  async function setAnim(id, change){
    const anims = JSON.parse(JSON.stringify(state.settings.anims || {}));
    anims[id] = Object.assign({}, anims[id] || {}, change);
    const d = await api('/api/walkers/settings', 'PUT', { anims });
    if (d.ok) render(d);
  }
  function oftenSlide(id, el){
    const v = Number(el.value); $('often-' + id).textContent = v;
    state.settings.anims[id] = Object.assign({}, state.settings.anims[id] || {}, { often: v });
    dragging = true; clearTimeout(timers['often-' + id]);
    timers['often-' + id] = setTimeout(async () => { dragging = false; await setAnim(id, { often: v }); }, 300);
  }
  async function setGroup(kind, on){
    const anims = JSON.parse(JSON.stringify(state.settings.anims || {}));
    for (const a of state.anims) if (a.kind === kind) anims[a.id] = Object.assign({}, anims[a.id] || {}, { on });
    const d = await api('/api/walkers/settings', 'PUT', { anims });
    if (d.ok) { render(d); toast(on ? 'All on' : 'All off'); }
  }
  async function tryAnim(id){ const d = await api('/api/walkers/try', 'POST', { id }); if (d.ok) toast('Watch the stream!'); }

  function outline(w, c){ if (!w) return 'none'; const o = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; o.push(`${(Math.cos(a) * w).toFixed(2)}px ${(Math.sin(a) * w).toFixed(2)}px 0 ${c}`); } return o.join(','); }
  function renderPreview(){
    const s = state.settings, n = $('pvName'), img = $('pvImg');
    img.src = state.art.length ? '/decor-art/unicorn/' + encodeURIComponent(state.art[0]) : '';
    img.style.display = state.art.length ? '' : 'none';
    n.style.display = s.namePosition === 'hidden' ? 'none' : '';
    n.style.order = s.namePosition === 'below' ? 2 : 0;
    n.style.fontFamily = `"${s.nameFont}", "Comic Sans MS", sans-serif`;
    n.style.fontSize = s.nameSize + 'px';
    n.style.fontWeight = s.nameBold ? 900 : 600;
    n.style.color = s.nameColor;
    n.style.background = s.nameBackground ? s.nameBgColor : 'none';
    n.style.padding = s.nameBackground ? '4px 12px 5px' : '0';
    n.style.borderRadius = '999px';
    n.style.border = s.nameBackground ? '2px solid rgba(255,255,255,.75)' : '0';
    n.style.textShadow = outline(s.nameBackground ? Math.min(2, s.nameOutlineWidth) : s.nameOutlineWidth, s.nameOutlineColor);
  }

  function renderPeople(){
    if (!state) return;
    const q = $('search').value.trim().toLowerCase(), onlyOn = $('onlyOn').checked;
    const rows = state.people.filter(p => (!q || p.name.toLowerCase().includes(q)) && (!onlyOn || p.allowed));
    const subArt = state.subArt || [];
    const artOpts = (sel, isSub, personal) => (personal ? `<option value="personal:${esc(personal)}" ${sel === 'personal:' + personal ? 'selected' : ''}>📷 Their own picture</option>` : '') + `<option value="">${isSub && state.settings.subsAuto !== false && subArt.length ? 'Random ⭐ sub picture' : 'Random'}</option>` +
      (isSub && subArt.length ? `<optgroup label="⭐ Subscriber-only">${subArt.map(f => `<option value="subs:${esc(f)}" ${sel === 'subs:' + f ? 'selected' : ''}>⭐ ${esc(f)}</option>`).join('')}</optgroup>` : '') +
      `<optgroup label="Everyone's pictures">${state.art.map(f => `<option value="${esc(f)}" ${sel === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</optgroup>`;
    $('people').innerHTML = rows.length ? rows.map(p => `<tr>
        <td class="chk"><input type="checkbox" ${p.allowed ? 'checked' : ''} onchange="setAllowed(${esc(JSON.stringify(p.name))}, this.checked)"></td>
        <td>${esc(p.name)}${p.isSub ? '<span class="badge b-sub">SUB</span>' : ''}${p.override === null ? ((p.isSub || state.settings.whoGets !== 'subs') ? '<span class="badge b-auto">auto</span>' : '') : '<span class="badge b-you">your pick</span>'}</td>
        <td><div class="pic-cell">
          ${p.art ? `<img class="pv-thumb" src="${picUrl(p.art)}" alt="" title="Current picture">` : '<span class="pv-thumb rnd" title="Random picture">🎲</span>'}
          <select onchange="setArt(${esc(JSON.stringify(p.name))}, this.value)">${artOpts(p.art, p.isSub, p.personal)}</select>
          <button class="reset" title="Upload a picture just for ${esc(p.name)}" onclick="pickPersonal(${esc(JSON.stringify(p.name))})">📷 Their own</button>
        </div></td>
        <td>${p.override === null ? '' : `<button class="reset" onclick="resetPerson(${esc(JSON.stringify(p.name))})">Reset</button>`}</td>
      </tr>`).join('') : `<tr><td colspan="4" class="note">${state.people.length ? 'No matches.' : 'Nobody yet - people show up here as soon as they chat.'}</td></tr>`;
  }

  const timers = {};
  function slide(el, key, fmt){
    const v = Number(el.value); $(key + '-v').textContent = fmt(v);
    if (state) { state.settings[key] = v; renderPreview(); }
    dragging = true; clearTimeout(timers[key]);
    timers[key] = setTimeout(async () => { await saveSetting(key, v); dragging = false; }, 250);
  }
  async function saveSetting(key, value){ const d = await api('/api/walkers/settings', 'PUT', { [key]: value }); if (d.ok) render(d); }
  async function saveReminders(){
    const reminders = $('reminders').value.split('\n').map(s => s.trim()).filter(Boolean);
    const d = await api('/api/walkers/settings', 'PUT', { reminders });
    if (d.ok) { remDirty = false; $('remStatus').textContent = 'Saved'; render(d); }
  }
  async function setAllowed(name, on){ const d = await api('/api/walkers/person', 'PUT', { name, allowed: on }); if (d.ok) render(d); }
  async function resetPerson(name){ const d = await api('/api/walkers/person', 'PUT', { name, allowed: null }); if (d.ok) render(d); }
  function picUrl(ref){
    if (ref.indexOf('personal:') === 0) return '/decor-art/unicorn-personal/' + encodeURIComponent(ref.slice(9));
    if (ref.indexOf('subs:') === 0) return '/decor-art/unicorn-subs/' + encodeURIComponent(ref.slice(5));
    return '/decor-art/unicorn/' + encodeURIComponent(ref);
  }
  // "📷 Their own": upload a picture that only this person will ever get.
  const personalInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  personalInput.style.display = 'none'; document.body.appendChild(personalInput);
  let personalFor = null;
  function pickPersonal(name){ personalFor = name; personalInput.value = ''; personalInput.click(); }
  personalInput.addEventListener('change', async () => {
    const f = personalInput.files && personalInput.files[0]; if (!f || !personalFor) return;
    const dataUrl = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(f); });
    const d = await api('/api/walkers/person-art', 'POST', { name: personalFor, dataUrl });
    if (d.ok) { render(d); toast(`${personalFor} now has their own picture`); }
  });
  async function setArt(name, art){ const d = await api('/api/walkers/person', 'PUT', { name, art: art || null }); if (d.ok) render(d); }
  async function test(){
    const d = await api('/api/walkers/test', 'POST', { name: $('testName').value.trim(), text: $('testText').value.trim() });
    if (d.ok) toast(`${d.name} is saying hi on stream`);
  }
  async function uploadArt(files, pool){
    const list = Array.from(files || []).filter(f => /^image\//.test(f.type));
    if (!list.length) return toast('Pick PNG, JPG, WEBP or GIF images');
    let done = 0, last = null;
    for (const f of list) {
      const dataUrl = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(f); });
      const d = await api('/api/walkers/art', 'POST', { dataUrl, name: f.name, pool });
      if (d.ok) { done++; last = d; }
    }
    if (last) render(last);
    toast(`Added ${done} picture${done === 1 ? '' : 's'}${pool === 'subs' ? ' (subscriber-only)' : ''}`);
  }
  async function moveArt(file, to){
    const d = await api('/api/walkers/art/move', 'POST', { file, to });
    if (d.ok) { render(d); toast(to === 'subs' ? `${file} is now subscriber-only` : `${file} is back in everyone's pool`); }
  }
  async function clearAll(){ const d = await api('/api/walkers/clear', 'POST'); if (d.ok) toast('Everyone is heading home'); }

  async function load(){ const d = await api('/api/walkers/admin'); if (d.ok) render(d); $('health').classList.toggle('offline', !d.ok); $('health').textContent = d.ok ? 'connected' : 'ICB offline'; }
  load();
  setInterval(() => { if (!dragging && document.visibilityState === 'visible') load(); }, 5000);
