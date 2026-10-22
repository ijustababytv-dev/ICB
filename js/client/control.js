const $ = id => document.getElementById(id);
  let state = null;
  let lastHealth = null;
  let panelOrderApplied = false;
  // Tracker card order + cards removed from the dashboard (saved in ICB's settings via /api/layout).
  let rtLay = {order:[],hidden:[]};
  let rtLayLocal = false;   // true once she has changed it here, so a stale broadcast can't undo it
  let rtDragging = null, rtRenderWaiting = false;
  const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString();
  const stamp = value => value ? new Date(value).toLocaleString() : '—';
  const phEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function log(message, kind='event'){ const row=document.createElement('div'); row.textContent=`${new Date().toLocaleTimeString()}  ${kind}: ${message}`; $('log').prepend(row); while($('log').children.length>60)$('log').lastChild.remove(); }
  function render(next){
    state=next; const s=state.settings||{}, l=state.live||{};
    $('heading').value=s.countdown?.heading||''; $('targetAt').value=s.countdown?.targetAt||''; $('timezone').value=s.countdown?.timezone||'';
    $('title').value=s.stream?.title||''; $('category').value=s.stream?.category||''; $('message').value=s.stream?.goLiveMessage||'';
    if(document.activeElement!==$('tickerText')) $('tickerText').value=s.ticker?.text||'';
    if(document.activeElement!==$('tickerSpeed')) $('tickerSpeed').value=s.ticker?.speed??90;
    if(document.activeElement!==$('tickerPause')) $('tickerPause').value=s.ticker?.pause??1;
    $('amber').textContent=fmt(l.resources?.amber); $('essence').textContent=fmt(l.resources?.essence); $('sweetLeaf').textContent=fmt(l.resources?.sweetLeaf);
    $('readerState').textContent=(l.reader?.state||'offline').toUpperCase(); $('sessionMode').textContent=(l.session?.mode||'offline').toUpperCase(); $('logFile').textContent=l.reader?.file||'—'; $('lastUpdate').textContent=stamp(l.reader?.lastUpdateAt);
    const needsReconciliation=Boolean(l.reconciliation?.required); $('reconcilePanel').hidden=!needsReconciliation; document.querySelectorAll('[data-correct]').forEach(button=>button.disabled=needsReconciliation);
    renderGuide();
    if(!panelOrderApplied){ applyPanelOrder(s.layout?.panelOrder); panelOrderApplied=true; }
    if(!rtLayLocal){ rtLay={order:Array.isArray(s.layout?.trackerOrder)?s.layout.trackerOrder:[],hidden:Array.isArray(s.layout?.trackerHidden)?s.layout.trackerHidden:[]}; if(typeof rtRender==='function') rtRender(); }
  }
  // ---------------- panel reordering ----------------
  function applyPanelOrder(order){
    const grid=$('panelGrid'); if(!grid||!Array.isArray(order)||!order.length) { updateMoveButtons(); return; }
    const sections=Array.from(grid.children);
    const byKey={}; sections.forEach(s=>byKey[s.dataset.panel]=s);
    order.forEach(key=>{ if(byKey[key]) grid.appendChild(byKey[key]); });
    // any panel not mentioned in a saved order (e.g. added after the order was last saved) keeps
    // falling to the end in its original relative order, since appendChild only moves the ones we know.
    updateMoveButtons();
  }
  function updateMoveButtons(){
    const grid=$('panelGrid'); if(!grid) return;
    const sections=Array.from(grid.children);
    sections.forEach((s,i)=>{
      const up=s.querySelector('[data-move="up"]'), down=s.querySelector('[data-move="down"]');
      if(up) up.disabled=(i===0);
      if(down) down.disabled=(i===sections.length-1);
    });
  }
  function movePanel(panelId,dir){
    const grid=$('panelGrid'); if(!grid) return;
    const sections=Array.from(grid.children);
    const idx=sections.findIndex(s=>s.dataset.panel===panelId);
    if(idx<0) return;
    const swapWith=dir==='up'?idx-1:idx+1;
    if(swapWith<0||swapWith>=sections.length) return;
    if(dir==='up') grid.insertBefore(sections[idx],sections[swapWith]);
    else grid.insertBefore(sections[swapWith],sections[idx]);
    updateMoveButtons();
    savePanelOrder();
  }
  async function savePanelOrder(){
    const order=Array.from($('panelGrid').children).map(s=>s.dataset.panel);
    try{ await fetch('/api/layout',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({panelOrder:order})}); log('panel order saved','layout'); }
    catch(_error){ /* order still holds visually for this session even if the save failed */ }
  }
  $('panelGrid').addEventListener('click',e=>{
    const b=e.target.closest('button[data-move]'); if(!b||b.disabled) return;
    const section=b.closest('section[data-panel]'); if(!section) return;
    movePanel(section.dataset.panel,b.dataset.move);
  });
  function guideSteps(){
    const l=state?.live||{};
    const serverUp=Boolean(lastHealth?.ok);
    const overlayConnected=(lastHealth?.connectedClients?.overlay||0)>0;
    return [
      {label:'Start the ICB Clean server',done:serverUp,
       detail:'Run <code>start-icb-clean.bat</code> in the ICB-Clean folder. This page connects automatically and the status badge above turns ONLINE. Leave the server window running.'},
      {label:'Enter your three current in-game totals (one time)',done:serverUp&&!l.reconciliation?.required,
       detail:'Open Palia and read your exact Amber Echo, Infected Essence, and Sweet Leaf totals from your inventory. Type all three into the red panel below and click the button. You only ever do this once — after it, ICB tracks every new pickup automatically.'},
      {label:'Start Palia Assistant, then Palia',done:l.reader?.state==='live',
       detail:'Launch Palia Assistant first so it can log the game, then start Palia. The reader flips to LIVE as soon as new log activity appears — collecting or moving any item works. If it stays OFFLINE after a minute of play, click "Rescan Palia logs" in Runtime status.'},
      {label:'Add the overlay to Meld Studio',done:overlayConnected,
       detail:'In Meld Studio, add a Browser layer with the URL <code>http://127.0.0.1:8790/overlay.html</code> — never control.html. This step turns green by itself the moment Meld actually connects, so you know it worked.'},
      {label:'Go on-air',done:l.session?.mode==='on-air',
       detail:'When your stream starts, click "Set on-air" in Runtime status. Use "Set break" and "Set offline" the same way. That\'s it — trackers update live in Chrome and in Meld from here on.'},
    ];
  }
  function renderGuide(){
    const list=$('guide'); if(!list)return; list.innerHTML='';
    let currentAssigned=false;
    guideSteps().forEach((step,index)=>{
      let cls='pending'; if(step.done)cls='done'; else if(!currentAssigned){cls='current';currentAssigned=true;}
      const li=document.createElement('li'); li.className='step '+cls;
      li.innerHTML=`<div class="step-head"><span class="badge">${step.done?'✓':index+1}</span><span class="step-label">${step.label}</span><span class="step-state">${step.done?'DONE':cls==='current'?'DO THIS NOW':'WAITS FOR THE STEP ABOVE'}</span></div>${cls==='current'?`<div class="step-detail">${step.detail}</div>`:''}`;
      list.appendChild(li);
    });
  }
  async function refreshHealth(){ try{ const h=await (await fetch('/api/health?_='+Date.now(),{cache:'no-store'})).json(); lastHealth=h; $('health').classList.toggle('offline',!h.ok); $('healthText').textContent=h.ok?'ONLINE':'ERROR'; $('version').textContent=`${h.version} // port ${h.port}`; renderGuide(); return h.ok; }catch(error){ lastHealth={ok:false}; $('health').classList.add('offline'); $('healthText').textContent='DISCONNECTED'; $('version').textContent='Unable to reach ICB Clean'; renderGuide(); return false; } }
  async function load(){ const r=await fetch('/api/state?_='+Date.now(),{cache:'no-store'}); const p=await r.json(); render(p); await refreshHealth(); log('state loaded','system'); }
  async function saveSettings(){ const p={countdown:{heading:$('heading').value,targetAt:$('targetAt').value,timezone:$('timezone').value},stream:{title:$('title').value,category:$('category').value,goLiveMessage:$('message').value}}; const r=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}); const out=await r.json(); $('settingsToast').textContent=out.ok?'Saved and broadcast.':out.error||'Save failed'; if(out.ok)log('settings saved','settings'); }
  async function action(target,payload={}){ const r=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,payload})}); const out=await r.json(); $('actionToast').textContent=out.action?.message||out.error||'Action failed'; log(`${target} -> ${out.action?.status||'error'}`,'command'); }
  async function correct(resource){ const value=$(resource==='sweetLeaf'?'sweetLeafInput':resource+'Input').value; const r=await fetch('/api/live/'+resource+'/correct',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:Number(value)})}); const out=await r.json(); log(out.ok?`${resource} corrected to ${out.value}`:out.error,'tracker'); }
  async function reconcile(){ const values={amber:$('reconcileAmber').value,essence:$('reconcileEssence').value,sweetLeaf:$('reconcileSweetLeaf').value}; if(Object.values(values).some(value=>value.trim()==='')){ $('actionToast').textContent='Enter all three current totals first.'; return; } const r=await fetch('/api/live/reconcile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)}); const out=await r.json(); $('actionToast').textContent=out.ok?'Current totals saved. Live tracking is ready.':out.error||'Could not reconcile totals.'; log(out.ok?'All tracker totals reconciled':'Reconciliation failed','tracker'); }
  async function saveTicker(){
    const text=$('tickerText').value.trim();
    if(!text){ $('tickerToast').textContent='Type something for it to scroll.'; return; }
    const speed=Number($('tickerSpeed').value), pause=Number($('tickerPause').value);
    if(!Number.isFinite(speed)||speed<10||speed>500){ $('tickerToast').textContent='Speed must be between 10 and 500.'; return; }
    if(!Number.isFinite(pause)||pause<0||pause>30){ $('tickerToast').textContent='Pause must be between 0 and 30 seconds.'; return; }
    const r=await fetch('/api/ticker',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,speed,pause})});
    const out=await r.json();
    $('tickerToast').textContent=out.ok?'Saved — updates live on the overlay.':out.error||'Save failed';
    if(out.ok)log('ticker settings saved','settings');
  }
  $('saveSettings').onclick=saveSettings;
  $('tickerSave').onclick=saveTicker;
  [$('tickerText'),$('tickerSpeed'),$('tickerPause')].forEach(el=>el.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); saveTicker(); } }));
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>action('session.set-mode',{mode:b.dataset.mode}));
  document.querySelectorAll('[data-correct]').forEach(b=>b.onclick=()=>correct(b.dataset.correct));
  $('reconcileTotals').onclick=reconcile;
  const events=new EventSource('/events?role=control');
  events.addEventListener('snapshot',e=>{render(JSON.parse(e.data));refreshHealth();});
  events.addEventListener('settings',e=>{if(state)render({...state,settings:JSON.parse(e.data)});log('settings updated','sse');});
  events.addEventListener('live',e=>{if(state)render({...state,live:JSON.parse(e.data)});log('live state updated','sse');});
  events.addEventListener('action',e=>{const a=JSON.parse(e.data);log(`${a.target} ${a.status}`,'action');});
  events.onerror=()=>{ $('health').classList.add('offline'); $('healthText').textContent='EVENT FEED OFFLINE'; };
  setInterval(refreshHealth,5000);
  load().catch(error=>{ $('health').classList.add('offline'); $('healthText').textContent='START SERVER'; log(error.message,'error'); });

  // ---- Weekly Accomplishments ----------------------------------------
  let WK={items:[]};
  function wkRender(){
    const g=$('wkGrid'); if(!g) return;
    const items=WK.items||[];
    const reset=WK.nextResetAt?new Date(WK.nextResetAt):null;
    $('wkState').textContent = `${WK.completed||0} of ${WK.total||0} done · resets ${reset?reset.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'}):'—'}`;
    const groups=[];
    for(const it of items){
      const name=it.group||'';
      let grp=groups.find(x=>x.name===name);
      if(!grp){grp={name,items:[]};groups.push(grp);}
      grp.items.push(it);
    }
    g.innerHTML=groups.map(grp=>`<div class="wk-g"><h3>${phEsc(grp.name)}</h3>
      ${grp.items.map(it=>{
        // An unverified rule is flagged rather than silently trusted.
        const badge = it.type==='manual'
          ? `<span class="wk-man" title="${phEsc(it.whyManual||'Manual')}">MANUAL</span>`
          : (it.verified===false
              ? `<span class="wk-warn" title="${phEsc(it.note||'Not yet proven against a real log')}">AUTO?</span>`
              : '<span class="wk-auto">AUTO</span>');
        const n = it.type==='manual' ? '' : `<span class="wk-n">${it.count}/${it.target}</span>`;
        return `<div class="wk-i ${it.done?'done':''}" data-wk="${phEsc(it.id)}">
          <span class="wk-b">${it.done?'✓':'☐'}</span>
          <span class="wk-t">${phEsc(it.label)}</span>${n}${badge}</div>`;
      }).join('')}</div>`).join('');
    $('wkUndo').innerHTML = !WK.canUndoReset ? '' :
      `<div class="rt-undo">The weekly list was reset${WK.lastResetAt?` at ${new Date(WK.lastResetAt).toLocaleString()}`:''}.
       <button class="secondary" id="wkUndoBtn" style="margin-left:8px">Undo — put last week's ticks back</button></div>`;
  }
  async function wkCall(url,body,method='PUT'){
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    const d=await r.json().catch(()=>({}));
    if(d.weekly){WK=d.weekly;wkRender();}
    if(!r.ok&&d.error) log('weekly: '+d.error);
    return d;
  }
  document.addEventListener('click',async e=>{
    const row=e.target.closest('.wk-i');
    if(row){ await wkCall(`/api/weekly/${row.dataset.wk}/toggle`,{},'POST'); return; }
    const b=e.target.closest('button'); if(!b) return;
    if(b.id==='wkUndoBtn') await wkCall('/api/weekly/undo-reset',{},'POST');
    else if(b.id==='wkReset'){if(confirm('Zero the whole weekly list now? You can undo this.')) await wkCall('/api/weekly/reset',{},'POST');}
  });
  fetch('/api/weekly',{cache:'no-store'}).then(r=>r.json()).then(d=>{WK=d.weekly||WK;wkRender();});
  events.addEventListener('weekly',e=>{WK=JSON.parse(e.data);wkRender();});

  // ---- Resource Trackers ---------------------------------------------
  let RT={cards:[]};
  function rtRender(){
    const g=$('rtGrid'); if(!g) return;
    if(rtDragging){ rtRenderWaiting=true; return; }  // don't redraw under her mouse mid-drag
    rtBindDrag(g);
    const allCards=RT.cards||[];
    const hiddenIds=rtLay.hidden||[];
    const pos=id=>{ const i=(rtLay.order||[]).indexOf(id); return i<0 ? 100000+allCards.findIndex(x=>x.id===id) : i; };
    const cards=allCards.filter(c=>!hiddenIds.includes(c.id)).sort((a,b)=>pos(a.id)-pos(b.id));
    const removed=allCards.filter(c=>hiddenIds.includes(c.id));
    $('rtState').textContent = RT.lastLoginAt
      ? `last Palia login seen ${new Date(RT.lastLoginAt).toLocaleTimeString()}` : '';
    g.innerHTML=cards.map(c=>rtWrap(c,(()=>{
      if(c.slots){
        // Multi-slot 'collection' card (e.g. Queen Ushindi Collection): one
        // dashboard card, N independent materials each with its own −/+/Reset,
        // plus a single "Reset All" for after a full turn-in.
        const rows=(c.slots||[]).map(slot=>`<div class="rt-btns" style="justify-content:space-between">
          <span style="min-width:150px">${(slot.count||0).toLocaleString()} <span class="muted" style="font-size:12px">${phEsc(slot.label||slot.id)}</span></span>
          <span>
            <button data-rtslot="${phEsc(c.id)}/${phEsc(slot.id)}" data-d="-1">−</button>
            <button data-rtslot="${phEsc(c.id)}/${phEsc(slot.id)}" data-d="1">+</button>
            <button class="secondary" data-rtslotreset="${phEsc(c.id)}/${phEsc(slot.id)}" data-rtresetname="${phEsc(slot.label||slot.id)}">Reset</button>
          </span>
        </div>`).join('');
        return `<div class="rt">
      <img src="/resource-art/${encodeURIComponent(c.image)}" alt="" onerror="this.style.display='none'">
      <div class="rt-meta">
        <div class="rt-url">/${phEsc(c.id)}.html</div>
        <div class="rt-life">NEVER AUTO-RESETS · manual reset only, per material</div>
      </div>
      <div class="rt-v" style="font-size:16px;line-height:1.6;display:block">${rows}</div>
      <div class="rt-btns">
        <button class="secondary" data-rtslotsreset="${phEsc(c.id)}" data-rtresetname="all ${(c.slots||[]).length} counts on ${phEsc(c.name)}">Reset All</button>
      </div>
    </div>`;
      }
      if(c.secondary){
        // Combined card (e.g. Ramen Plush): two independent counts sharing
        // one overlay box - "<cooked> Ramen Cooked VS <count> Plushies".
        const secLabel=phEsc(c.secondary.label||'Cooked');
        const priLabel=phEsc(c.secondary.primaryLabel||c.name);
        return `<div class="rt">
      <img src="/resource-art/${encodeURIComponent(c.image)}" alt="" onerror="this.style.display='none'">
      <div class="rt-meta">
        <div class="rt-url">/${phEsc(c.id)}.html</div>
        <div class="rt-life">NEVER AUTO-RESETS · manual reset only, both counts</div>
      </div>
      <div class="rt-v" style="font-size:20px;line-height:1.5">
        <div>${(c.secondaryCount||0).toLocaleString()} <span class="muted" style="font-size:12px">${secLabel}</span></div>
        <div>${(c.count||0).toLocaleString()} <span class="muted" style="font-size:12px">${priLabel}</span></div>
      </div>
      <div class="rt-btns">
        <button data-rtsec="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rtsec="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtsecreset="${phEsc(c.id)}" data-rtresetname="${secLabel}">Reset ${secLabel}</button>
      </div>
      <div class="rt-btns">
        <button data-rt="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rt="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${priLabel}">Reset ${priLabel}</button>
      </div>
    </div>`;
      }
      return `<div class="rt">
      <img src="/resource-art/${encodeURIComponent(c.image)}" alt="" onerror="this.style.display='none'">
      <div class="rt-meta">
        <div class="rt-url">/${phEsc(c.id)}.html</div>
        ${c.mode==='lifetime'?`<div class="rt-life">${c.source?'NEVER AUTO-RESETS · this is your live total everywhere':'NEVER AUTO-RESETS · manual reset only'}</div>`:''}
        ${c.mode==='countdown'?`<div class="rt-life" style="color:var(--muted)">COUNTS DOWN · restocks to batch size on server restart</div>`:''}
      </div>
      <div class="rt-v">${(c.count||0).toLocaleString()}${c.mode==='countdown'?` <span class="muted" style="font-size:13px">/ ${(c.startAt||0).toLocaleString()}</span>`:''}</div>
      ${c.mode==='lifetime'&&c.source?`<div class="rt-btns">
        <button class="secondary" data-rtlivereset="${phEsc(c.source.split('.').pop())}" data-rtresetname="${phEsc(c.name)}">Reset</button></div>`
      :c.mode==='lifetime'?`<div class="rt-btns">
        <button data-rt="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rt="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${phEsc(c.name)}">Reset</button></div>`
      :c.mode==='countdown'?`<div class="correct">
        <input id="startInput-${phEsc(c.id)}" type="number" min="0" placeholder="batch size (e.g. 200)">
        <button class="secondary" data-rtstart="${phEsc(c.id)}">Set &amp; restock now</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${phEsc(c.name)}">Reset to 0</button></div>`
      :`<div class="rt-btns">
        <button data-rt="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rt="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${phEsc(c.name)}">Reset</button></div>`}
    </div>`;
    })())).join('');
    $('rtHidden').innerHTML = !removed.length ? '' :
      `<div class="rt-hidden"><b>Removed from dashboard</b> <span class="muted">(still counting in the background)</span><br>${
        removed.map(c=>`<span class="chip">${phEsc(c.name||c.id)} <button class="secondary" data-rtshow="${phEsc(c.id)}">Bring back</button></span>`).join('')}</div>`;
    // She logs into Palia many times a day, so a reset she did not want has to
    // be recoverable rather than just explained.
    $('rtUndo').innerHTML = !RT.canUndoReset ? '' :
      `<div class="rt-undo">Session cards were zeroed${RT.lastResetReason==='palia-login'?' because you logged into Palia':''}
       ${RT.lastResetAt?` at ${new Date(RT.lastResetAt).toLocaleTimeString()}`:''}.
       <button class="secondary" id="rtUndoBtn" style="margin-left:8px">Undo — put the numbers back</button></div>`;
  }
  function rtWrap(c,html){
    // Adds the move handle + remove button to the top of each tracker card.
    const bar=`<div class="rt-bar"><span class="rt-handle" draggable="true" title="Drag to move">⠿ move</span><span class="rt-name" style="flex:1">${phEsc(c.name||c.id)}</span><button class="secondary" data-rttop="${phEsc(c.id)}" title="Move this tracker to the top">⇧ Top</button><button class="secondary" data-rthide="${phEsc(c.id)}" title="Take this tracker off the dashboard">✕ Remove</button></div>`;
    return html.replace('<div class="rt">',`<div class="rt" data-rtid="${phEsc(c.id)}">${bar}`);
  }
  async function rtSaveLayout(){
    rtLayLocal=true;
    try{ await fetch('/api/layout',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackerOrder:rtLay.order,trackerHidden:rtLay.hidden})}); log('tracker layout saved','layout'); }
    catch(_error){ log('could not save tracker layout - is ICB running?','layout'); }
  }
  function rtBindDrag(g){
    if(g.dataset.dnd) return; g.dataset.dnd='1';
    // Only the handle starts a drag, so typing in a box or clicking buttons never moves a card.
    g.addEventListener('dragstart',e=>{ const h=e.target.closest&&e.target.closest('.rt-handle'); const card=h&&h.closest('.rt[data-rtid]'); if(!card) return;
      rtDragging=card; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move';
      try{ e.dataTransfer.setData('text/plain',card.dataset.rtid); e.dataTransfer.setDragImage(card,20,20); }catch(_){ } });
    g.addEventListener('dragover',e=>{ if(!rtDragging) return; e.preventDefault();
      const over=e.target.closest('.rt[data-rtid]'); if(!over||over===rtDragging) return;
      const r=over.getBoundingClientRect(); const after=(e.clientX-r.left)>r.width/2;
      g.insertBefore(rtDragging, after?over.nextSibling:over); });
    g.addEventListener('drop',e=>{ if(rtDragging) e.preventDefault(); });
    g.addEventListener('dragend',()=>{ if(!rtDragging) return;
      rtDragging.classList.remove('dragging'); rtDragging=null;
      const shown=Array.from(g.querySelectorAll('.rt[data-rtid]')).map(x=>x.dataset.rtid);
      rtLay.order=shown.concat((rtLay.order||[]).filter(id=>!shown.includes(id)));
      rtSaveLayout(); rtRenderWaiting=false; rtRender(); });
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.rthide){
      const name=(b.closest('.rt')?.querySelector('.rt-name')?.textContent)||'this tracker';
      if(!confirm(`Remove ${name} from the dashboard?\n\nIt keeps counting and its Meld layer keeps working. You can bring it back from the "Removed from dashboard" list at the bottom.`)) return;
      rtLay.hidden=Array.from(new Set((rtLay.hidden||[]).concat(b.dataset.rthide))); rtSaveLayout(); rtRender();
    } else if(b.dataset.rttop){
      const shown=Array.from($('rtGrid').querySelectorAll('.rt[data-rtid]')).map(x=>x.dataset.rtid).filter(id=>id!==b.dataset.rttop);
      rtLay.order=[b.dataset.rttop].concat(shown, (rtLay.order||[]).filter(id=>id!==b.dataset.rttop&&!shown.includes(id))); rtSaveLayout(); rtRender();
    } else if(b.dataset.rtshow){
      rtLay.hidden=(rtLay.hidden||[]).filter(id=>id!==b.dataset.rtshow); rtSaveLayout(); rtRender();
    }
  });
  async function rtCall(url,body,method='PUT'){
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    const d=await r.json().catch(()=>({}));
    if(d.resourceTrackers){RT=d.resourceTrackers;rtRender();}
    if(!r.ok&&d.error) log('resource: '+d.error);
    return d;
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.rt) await rtCall(`/api/resource-trackers/${b.dataset.rt}/adjust`,{delta:Number(b.dataset.d)});
    else if(b.dataset.rtsec) await rtCall(`/api/resource-trackers/${b.dataset.rtsec}/secondary/adjust`,{delta:Number(b.dataset.d)});
    else if(b.dataset.rtsecreset){if(confirm(`Reset ${b.dataset.rtresetname||'this'} to 0? This cannot be undone.`)) await rtCall(`/api/resource-trackers/${b.dataset.rtsecreset}/secondary/set`,{value:0});}
    else if(b.dataset.rtslot) await rtCall(`/api/resource-trackers/${b.dataset.rtslot.replace('/', '/slot/')}/adjust`,{delta:Number(b.dataset.d)});
    else if(b.dataset.rtslotreset){if(confirm(`Reset ${b.dataset.rtresetname||'this'} to 0? This cannot be undone.`)) await rtCall(`/api/resource-trackers/${b.dataset.rtslotreset.replace('/', '/slot/')}/set`,{value:0});}
    else if(b.dataset.rtslotsreset){if(confirm(`Reset ${b.dataset.rtresetname||'this'} to 0? This cannot be undone.`)) await rtCall(`/api/resource-trackers/${b.dataset.rtslotsreset}/slots-reset`,{},'POST');}
    else if(b.dataset.rtstart){
      const inp=document.getElementById('startInput-'+b.dataset.rtstart);
      const v=inp?inp.value:'';
      if(v===''||Number(v)<0){ if(inp) inp.focus(); return; }
      const out=await rtCall(`/api/resource-trackers/${b.dataset.rtstart}/set-start`,{startAt:Number(v)});
      if(out&&out.ok&&inp) inp.value='';
    }
    else if(b.dataset.rtreset){if(confirm(`Reset ${b.dataset.rtresetname||'this'} to 0? This cannot be undone.`)) await rtCall(`/api/resource-trackers/${b.dataset.rtreset}/set`,{value:0});}
    else if(b.dataset.rtlivereset){
      if(confirm(`Reset ${b.dataset.rtresetname||'this'} to 0? This is your actual live total, used everywhere ICB shows it — not just this card. This cannot be undone.`)){
        const r=await fetch(`/api/live/${b.dataset.rtlivereset}/correct`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:0})});
        const out=await r.json().catch(()=>({}));
        log(out.ok?`${b.dataset.rtlivereset} reset to 0`:out.error||'Reset failed','tracker');
        if(out.ok){ const rt=await (await fetch('/api/resource-trackers',{cache:'no-store'})).json(); if(rt.resourceTrackers){RT=rt.resourceTrackers;rtRender();} }
      }
    }
    else if(b.id==='rtReset'){if(confirm('Zero every session resource card? Amber and Essence are not touched, and you can undo this.')) await rtCall('/api/resource-trackers/reset-session',{},'POST');}
    else if(b.id==='rtUndoBtn') await rtCall('/api/resource-trackers/undo-reset',{},'POST');
  });
  fetch('/api/resource-trackers',{cache:'no-store'}).then(r=>r.json()).then(d=>{RT=d.resourceTrackers||RT;rtRender();});
  events.addEventListener('resourcetrackers',e=>{RT=JSON.parse(e.data);rtRender();});

  // ---- Daily / Weekly To-Do -------------------------------------------
  // Dashboard-only, no auto-reset (confirmed with Baby 2026-08-25) — she adds and deletes these
  // herself. 'daily'/'weekly' here are the API list keys; TODO_DOM maps each to its input ids.
  let TODOS={daily:[],weekly:[]};
  const TODO_DOM={daily:'todoDaily',weekly:'todoWeekly'};
  function todoRowHtml(list,it){
    if(it.kind==='goal'){
      const complete=it.current>=it.target;
      return `<div class="td-i${complete?' done':''}" data-td="${it.id}" data-list="${list}">
        <span class="td-t" data-td-edit data-td="${it.id}" data-list="${list}" title="Click to edit progress or target">${phEsc(it.text)}</span>
        <span class="td-goal">${it.current.toLocaleString()}/${it.target.toLocaleString()}</span>
        <div class="td-btns">
          <button data-td-adj="-1" data-td="${it.id}" data-list="${list}">−</button>
          <button data-td-adj="1" data-td="${it.id}" data-list="${list}">+</button>
        </div>
        <button class="td-del" data-td-del data-td="${it.id}" data-list="${list}" title="Delete">×</button>
      </div>`;
    }
    return `<div class="td-i${it.done?' done':''}" data-td="${it.id}" data-list="${list}">
      <span class="td-check" data-td-toggle data-td="${it.id}" data-list="${list}">${it.done?'✓':'☐'}</span>
      <span class="td-t" data-td-toggle data-td="${it.id}" data-list="${list}">${phEsc(it.text)}</span>
      <button class="td-del" data-td-del data-td="${it.id}" data-list="${list}" title="Delete">×</button>
    </div>`;
  }
  function todoRender(){
    for(const list of ['daily','weekly']){
      const el=$(TODO_DOM[list]+'List'); if(!el) continue;
      const items=TODOS[list]||[];
      el.innerHTML = items.length ? items.map(it=>todoRowHtml(list,it)).join('') : '<div class="td-empty">Nothing here yet.</div>';
    }
  }
  async function todoCall(url,body,method='PUT'){
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    const d=await r.json().catch(()=>({}));
    if(d.todos){TODOS=d.todos;todoRender();}
    if(!r.ok&&d.error){ alert(d.error); log('todo: '+d.error); }
    return d;
  }
  function todoFindItem(list,id){ return (TODOS[list]||[]).find(x=>x.id===id); }
  function todoAdd(list){
    const p=TODO_DOM[list];
    const textInput=$(p+'Text'), kindSelect=$(p+'Kind'), targetInput=$(p+'Target');
    const text=textInput.value.trim();
    if(!text){ textInput.focus(); return; }
    const kind=kindSelect.value;
    const body={text,kind};
    if(kind==='goal'){
      const target=Number(targetInput.value);
      if(!target||target<=0){ targetInput.focus(); return; }
      body.target=target;
    }
    todoCall(`/api/todos/${list}`,body,'POST').then(out=>{
      if(out&&out.ok){ textInput.value=''; targetInput.value=''; textInput.focus(); }
    });
  }
  for(const list of ['daily','weekly']){
    const p=TODO_DOM[list];
    const kindSelect=$(p+'Kind'), targetInput=$(p+'Target'), textInput=$(p+'Text');
    if(kindSelect&&targetInput) kindSelect.addEventListener('change',()=>{ targetInput.style.display = kindSelect.value==='goal' ? '' : 'none'; });
    if(textInput) textInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); todoAdd(list); } });
  }
  document.querySelectorAll('[data-todo-add]').forEach(b=>b.onclick=()=>todoAdd(b.dataset.todoAdd));
  document.addEventListener('click',async e=>{
    const toggle=e.target.closest('[data-td-toggle]');
    if(toggle){
      const item=todoFindItem(toggle.dataset.list,toggle.dataset.td);
      if(item&&item.kind==='check') await todoCall(`/api/todos/${toggle.dataset.list}/${toggle.dataset.td}`,{done:!item.done});
      return;
    }
    const adj=e.target.closest('[data-td-adj]');
    if(adj){ await todoCall(`/api/todos/${adj.dataset.list}/${adj.dataset.td}`,{delta:Number(adj.dataset.tdAdj)}); return; }
    const editEl=e.target.closest('[data-td-edit]');
    if(editEl){
      const item=todoFindItem(editEl.dataset.list,editEl.dataset.td); if(!item) return;
      const input=prompt(`Edit "${item.text}" — progress as current/target:`,`${item.current}/${item.target}`);
      if(input===null) return;
      const parts=input.split('/').map(s=>Number(s.trim()));
      if(parts.length!==2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1])||parts[1]<=0||parts[0]<0){ alert('Enter it as current/target, e.g. 5/100'); return; }
      await todoCall(`/api/todos/${editEl.dataset.list}/${editEl.dataset.td}`,{current:parts[0],target:parts[1]});
      return;
    }
    const delBtn=e.target.closest('[data-td-del]');
    if(delBtn){
      const item=todoFindItem(delBtn.dataset.list,delBtn.dataset.td);
      if(item&&!confirm(`Delete "${item.text}"?`)) return;
      await todoCall(`/api/todos/${delBtn.dataset.list}/${delBtn.dataset.td}`,{},'DELETE');
    }
  });
  fetch('/api/todos',{cache:'no-store'}).then(r=>r.json()).then(d=>{TODOS=d.todos||TODOS;todoRender();});
  events.addEventListener('todos',e=>{TODOS=JSON.parse(e.data);todoRender();});
