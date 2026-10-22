function $(id){ return document.getElementById(id); }
function api(p, b){ return fetch(p, b === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(b) }).then(function(r){ return r.json(); }); }
function post(b){ return api('/api/hunt', b).then(function(r){ load(); return r; }); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
$('url').value = location.origin + '/hunt.html';
function copyUrl(){ $('url').select(); try { navigator.clipboard.writeText($('url').value); } catch(e){ document.execCommand('copy'); } }
function scalePrev(){ $('pf').style.transform = 'scale(' + ($('prev').clientWidth / 1920) + ')'; }
window.addEventListener('resize', scalePrev); scalePrev();
var D = null, T = { status:'idle' }, off = 0, filled = false, timers = {}, ITEMS = [], TEAMS = [], art = [], itemsDirty = false, teamsDirty = false;
var COLORS = ['#06b6d4','#d946ef','#f59e0b','#22c55e','#f43f5e','#8b5cf6','#14b8a6','#eab308','#3b82f6','#ec4899','#84cc16','#f97316'];

// settings inputs
function o1(k, v){ var o = {}; o[k] = v; return o; }
[].forEach.call(document.querySelectorAll('[data-s]'), function(el){
  var k = el.getAttribute('data-s');
  if (el.type === 'checkbox') el.onchange = function(){ post({ set: o1(k, el.checked) }); };
  else el.oninput = function(){ clearTimeout(timers[k]); timers[k] = setTimeout(function(){ post({ set: o1(k, el.value) }); }, 300); };
});
function showVal(k, v){ var s = document.querySelector('[data-v="' + k + '"]'); if (s) s.textContent = v + (s.getAttribute('data-u') || ''); }
[].forEach.call(document.querySelectorAll('[data-l]'), function(el){
  var k = el.getAttribute('data-l');
  if (el.type === 'checkbox') el.onchange = function(){ post({ set: { look: o1(k, el.checked) } }); };
  else if (el.type === 'range') el.oninput = function(){ showVal(k, el.value); clearTimeout(timers[k]); timers[k] = setTimeout(function(){ post({ set: { look: o1(k, Number(el.value)) } }); }, 200); };
  else el.onchange = function(){ post({ set: { look: o1(k, el.value) } }); };
});

// timer
function timer(a, ms){ var b = { action: a }; if (a === 'start') b.minutes = Number($('tmins').value) || 60; if (ms) b.ms = ms; post({ timer: b }); }
function two(n){ return (n < 10 ? '0' : '') + n; }
function showTimer(){
  if (!D) return; var now = Date.now() + off, left = T.status === 'running' ? Math.max(0, T.endsAt - now) : T.left, st = T.status;
  if (st === 'running' && left <= 0) st = 'ended';
  var s = Math.ceil(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  $('tleft').textContent = (h ? h + ':' + two(m) : two(m)) + ':' + two(s % 60);
  $('tstate').textContent = st === 'ended' ? 'finished' : st;
  $('tpause').textContent = T.status === 'paused' ? '▶ Resume' : '⏸ Pause';
}
setInterval(showTimer, 250);

// items
function drawItems(){
  var opts = '<option value="">(emoji only)</option>' + art.map(function(f){ return '<option>' + esc(f) + '</option>'; }).join('');
  $('items').innerHTML = ITEMS.map(function(it, i){
    return '<tr><td><input type="text" value="' + esc(it.icon) + '" oninput="ITEMS[' + i + '].icon=this.value;dirtyI()"></td>' +
      '<td><input type="text" value="' + esc(it.label) + '" oninput="ITEMS[' + i + '].label=this.value;dirtyI()"></td>' +
      '<td><input type="text" value="' + esc(it.command) + '" oninput="ITEMS[' + i + '].command=this.value;dirtyI()"></td>' +
      '<td><input type="text" value="' + esc(it.aliases) + '" oninput="ITEMS[' + i + '].aliases=this.value;dirtyI()"></td>' +
      '<td><input type="number" value="' + it.pts + '" oninput="ITEMS[' + i + '].pts=Number(this.value);dirtyI()"></td>' +
      '<td><select onchange="ITEMS[' + i + '].image=this.value;dirtyI()">' + opts.replace('<option>' + esc(it.image) + '</option>', '<option selected>' + esc(it.image) + '</option>') + '</select></td>' +
      '<td><button class="btn-sm btn-danger" onclick="ITEMS.splice(' + i + ',1);drawItems();dirtyI()">✕</button></td></tr>';
  }).join('') || '<tr><td colspan="7" class="note">Nothing to hunt yet — add an item.</td></tr>';
}
function dirtyI(){ itemsDirty = true; $('itemsNote').textContent = 'Not saved yet'; }
function addItem(o){ ITEMS.push(o || { icon:'⭐', label:'', command:'', aliases:'', pts:5, image:'' }); drawItems(); dirtyI(); }
function saveItems(){ post({ items: ITEMS }).then(function(){ itemsDirty = false; $('itemsNote').textContent = 'Saved ✓'; ITEMS = D ? JSON.parse(JSON.stringify(D.items)) : ITEMS; }); }

// teams
function drawTeams(){
  $('teams').innerHTML = TEAMS.map(function(t, i){
    return '<tr><td><input type="text" value="' + esc(t.key.toUpperCase()) + '" oninput="TEAMS[' + i + '].key=this.value;dirtyT()"></td>' +
      '<td><input type="text" value="' + esc(t.name) + '" oninput="TEAMS[' + i + '].name=this.value;dirtyT()"></td>' +
      '<td><input type="color" value="' + esc(t.color) + '" oninput="TEAMS[' + i + '].color=this.value;dirtyT()"></td>' +
      '<td><button class="btn-sm btn-danger" onclick="if(TEAMS.length>1){TEAMS.splice(' + i + ',1);drawTeams();dirtyT()}">✕</button></td></tr>';
  }).join('');
}
function dirtyT(){ teamsDirty = true; $('teamsNote').textContent = 'Not saved yet'; }
function addTeam(){ var used = {}; TEAMS.forEach(function(t){ used[t.key.toLowerCase()] = 1; }); var L = 'abcdefghijklmnopqrstuvwxyz', k = 'a';
  for (var i = 0; i < 26; i++) if (!used[L[i]]) { k = L[i]; break; }
  TEAMS.push({ key: k, name: 'Team ' + k.toUpperCase(), color: COLORS[TEAMS.length % COLORS.length] }); drawTeams(); dirtyT(); }
function saveTeams(){ post({ teams: TEAMS }).then(function(){ teamsDirty = false; $('teamsNote').textContent = 'Saved ✓'; }); }

// players
function teamColor(k){ var t = D.teams.filter(function(x){ return x.key === k; })[0]; return t ? t.color : '#888'; }
function drawPlayers(pl){
  $('pcount').textContent = pl.length;
  var topts = D.teams.map(function(t){ return '<option value="' + esc(t.key) + '">' + esc(t.name) + '</option>'; }).join('');
  if (!pl.length) { $('players').innerHTML = '<div class="note">Nobody yet — chat types <b>!team A</b>.</div>'; return; }
  $('players').innerHTML = pl.map(function(p){
    var btns = D.items.map(function(it){ var n = p.finds[it.command] || 0;
      return '<span class="note" title="' + esc(it.label) + '">' + esc(it.icon || it.command) + ' ' + n + '</span><button class="btn-sm" onclick="pAdd(\'' + esc(p.key) + '\',\'' + esc(it.command) + '\',-1)">−</button><button class="btn-sm" onclick="pAdd(\'' + esc(p.key) + '\',\'' + esc(it.command) + '\',1)">+</button>'; }).join(' ');
    return '<div class="pl"><span class="nm"><span class="dot" style="background:' + teamColor(p.team) + '"></span>' + esc(p.name) + '</span><span class="pts">' + p.points + '</span>' +
      '<select onchange="post({player:{key:\'' + esc(p.key) + '\',team:this.value}})">' + topts.replace('value="' + esc(p.team) + '"', 'value="' + esc(p.team) + '" selected') + '</select>' +
      '<button class="btn-sm btn-danger" onclick="if(confirm(\'Remove ' + esc(p.name).replace(/\'/g, '') + '?\'))post({player:{key:\'' + esc(p.key) + '\',remove:true}})">✕</button>' +
      '<div style="width:100%;display:flex;gap:4px;align-items:center;flex-wrap:wrap">' + btns + '</div></div>';
  }).join('');
}
function pAdd(key, item, n){ post({ player: { key: key, item: item, n: n } }); }
function addPlayer(){ var n = $('addName').value.trim(); if (!n) return; post({ add: { name: n, team: $('addTeam').value } }).then(function(){ $('addName').value = ''; }); }
function drawLog(log){
  $('log').innerHTML = log.length ? log.map(function(e){
    var t = new Date(e.at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }), s = '';
    if (e.kind === 'find') s = '<b>' + esc(e.name) + '</b> ' + (e.n > 0 ? '+' : '') + e.n + ' ' + esc(e.icon || '') + ' ' + esc(e.label || e.item) + ' (' + (e.pts > 0 ? '+' : '') + e.pts + ' pts)' + (e.how === 'dashboard' ? ' <span class="tag">you</span>' : '') +
      (e.undone ? '' : ' <button class="btn-sm" onclick="post({undo:' + e.id + '})">Undo</button>');
    else if (e.kind === 'join') s = '<b>' + esc(e.name) + '</b> joined <span style="color:' + teamColor(e.team) + '">' + esc(teamName(e.team)) + '</span>';
    else if (e.kind === 'move') s = '<b>' + esc(e.name) + '</b> moved to ' + esc(teamName(e.team));
    else if (e.kind === 'noteam') s = '<b>' + esc(e.name) + '</b> typed !' + esc(e.item) + ' but isn\'t on a team';
    else if (e.kind === 'start') s = '▶ Hunt started'; else if (e.kind === 'end') s = '🏁 Hunt ended';
    return '<div class="' + (e.undone ? 'u' : '') + '"><span class="note">' + t + '</span> ' + s + '</div>';
  }).join('') : '<div class="note">Nothing yet.</div>';
}
function teamName(k){ var t = D.teams.filter(function(x){ return x.key === k; })[0]; return t ? t.name : k; }
function test(){ api('/api/hunt', { test: { name: $('tName').value, text: $('tText').value } }).then(function(r){ $('tOut').textContent = '→ ' + (r.result || r.error || ''); load(); }); }

function fill(){
  var map = { visible: D.visible, joinOpen: D.joinOpen, scoring: D.scoring, lockTeams: D.settings.lockTeams, stopAtEnd: D.settings.stopAtEnd, title: D.title, subtitle: D.subtitle, ignore: D.settings.ignore };
  [].forEach.call(document.querySelectorAll('[data-s]'), function(el){ var k = el.getAttribute('data-s'); if (el === document.activeElement) return; if (el.type === 'checkbox') el.checked = !!map[k]; else if (!filled) el.value = map[k] || ''; });
  [].forEach.call(document.querySelectorAll('[data-l]'), function(el){ var k = el.getAttribute('data-l'); if (el === document.activeElement || filled && el.type !== 'checkbox') return; if (el.type === 'checkbox') el.checked = !!D.look[k]; else el.value = D.look[k]; if (el.type === 'range') showVal(k, D.look[k]); });
  if (!filled) $('tmins').value = D.timer.minutes;
}
function load(){
  return api('/api/hunt/admin').then(function(d){
    D = d; T = d.timer; off = d.now - Date.now(); art = d.art || [];
    $('health').textContent = 'ICB connected'; $('health').className = 'health';
    fill(); filled = true;
    if (!itemsDirty) { ITEMS = JSON.parse(JSON.stringify(d.items)).map(function(it){ delete it.imageUrl; return it; }); drawItems(); }
    if (!teamsDirty) { TEAMS = JSON.parse(JSON.stringify(d.teams)); drawTeams(); }
    var sel = $('addTeam'), keep = sel.value; sel.innerHTML = d.teams.map(function(t){ return '<option value="' + esc(t.key) + '">' + esc(t.name) + '</option>'; }).join(''); if (keep) sel.value = keep;
    if (!document.activeElement || document.activeElement.tagName !== 'SELECT') drawPlayers(d.players);
    drawLog(d.log); showTimer();
  }).catch(function(){ $('health').textContent = 'ICB offline — run restart-icb-clean.bat'; $('health').className = 'health offline'; });
}
load(); setInterval(load, 2500);
