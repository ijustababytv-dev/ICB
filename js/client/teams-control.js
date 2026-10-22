var $ = function(id){ return document.getElementById(id); };
var S = null, filled = false;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function toast(t){ var e = $('toast'); e.textContent = t; e.className = 'toast show'; clearTimeout(e._t); e._t = setTimeout(function(){ e.className = 'toast'; }, 2200); }
function api(path, body){
  return fetch(path, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ return r.json(); }).then(function(d){ if (!d.ok) throw new Error(d.error || 'Failed'); return d; });
}
function act(path, body, msg){ return api(path, body).then(function(d){ if (msg) toast(msg); return load(); }).catch(function(e){ toast('⚠️ ' + e.message); }); }
function copyUrl(){ try { navigator.clipboard.writeText($('ovUrl').textContent); toast('Copied'); } catch (e) {} }

function fillForm(){
  $('title').value = S.title; $('showPlayers').value = S.showPlayers;
  $('command').value = S.item.command; $('aliases').value = S.item.aliases; $('label').value = S.item.label;
  var opts = '<option value="">(no picture)</option>';
  S.art.forEach(function(f){ opts += '<option' + (f === S.item.image ? ' selected' : '') + '>' + esc(f) + '</option>'; });
  $('image').innerHTML = opts; showThumb();
  var tc = ''; for (var n = 2; n <= 8; n++) tc += '<option' + (n === S.teamCount ? ' selected' : '') + '>' + n + '</option>';
  $('teamCount').innerHTML = tc;
  renderTeamRows();
}
function renderTeamRows(){
  var n = Number($('teamCount').value), html = '';
  for (var i = 0; i < n; i++) { var t = S.teams[i];
    html += '<div class="teamrow"><span class="lt">!team ' + t.letter + '</span><input type="text" data-l="' + t.letter + '" class="tn" value="' + esc(t.name) + '" maxlength="40"><input type="color" data-l="' + t.letter + '" class="tc" value="' + t.color + '"></div>'; }
  $('teamRows').innerHTML = html;
}
function showThumb(){ var f = $('image').value, im = $('thumb'); if (f) { im.src = '/assets/resources/' + encodeURIComponent(f); im.style.display = 'block'; } else im.style.display = 'none'; }

function render(){
  $('visible').checked = S.visible; $('joinOpen').checked = S.joinOpen; $('counting').checked = S.counting; $('showBanner').checked = S.showBanner;
  var tag = $('stateTag');
  tag.textContent = (S.joinOpen ? 'joining open' : 'joining closed') + ' · ' + (S.counting ? 'scoring on' : 'scoring paused');
  tag.className = 'state' + (S.counting ? ' on' : '');
  $('itemNote').textContent = '— counting !' + S.item.command + (S.item.label ? ' (' + S.item.label + ')' : '');
  // presets
  var ph = '';
  S.presets.forEach(function(p, i){
    ph += '<span class="preset' + (p.command === S.item.command ? ' on' : '') + '"><b onclick="usePreset(' + i + ')">!' + esc(p.command) + (p.label ? ' · ' + esc(p.label) : '') + '</b><button class="x" title="Remove quick pick" onclick="delPreset(' + i + ')">✕</button></span>';
  });
  $('presets').innerHTML = ph || '<span class="empty">No quick picks yet.</span>';
  // team picker options
  var teamOpts = S.board.map(function(t){ return '<option value="' + t.letter + '">' + esc(t.name) + ' (' + t.letter.toUpperCase() + ')</option>'; }).join('');
  var keep = $('addTeam').value; $('addTeam').innerHTML = teamOpts; if (keep) $('addTeam').value = keep;
  // board
  var byTeam = {}; S.players.forEach(function(p){ (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  var html = '';
  S.board.forEach(function(t){
    var list = (byTeam[t.letter] || []).sort(function(a, b){ return b.points - a.points || a.name.localeCompare(b.name); });
    html += '<div class="tcol" style="--c:' + esc(t.color) + '"><h3><span>' + (t.leading ? '👑 ' : '') + esc(t.name) + ' <span class="note">!team ' + t.letter + ' · ' + list.length + ' ' + (list.length === 1 ? 'person' : 'people') + '</span></span><span class="tt">' + t.total + '</span></h3>';
    if (!list.length) html += '<div class="empty">Nobody yet.</div>';
    list.forEach(function(p){ html += plRow(p, teamOpts); });
    html += '</div>';
  });
  var stray = S.players.filter(function(p){ return !S.board.some(function(t){ return t.letter === p.team; }); });
  if (stray.length) {
    html += '<div class="tcol" style="--c:#666"><h3><span>On a team that\'s turned off <span class="note">(not counted)</span></span></h3>';
    stray.forEach(function(p){ html += plRow(p, teamOpts); }); html += '</div>';
  }
  $('board').innerHTML = html;
  var sels = document.querySelectorAll('#board select[data-k]');
  for (var i = 0; i < sels.length; i++) sels[i].value = sels[i].getAttribute('data-t');
  // log
  var lh = '';
  S.log.forEach(function(e){
    var tm = new Date(e.at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }), txt = '';
    if (e.kind === 'points') txt = '<b>' + esc(e.name) + '</b> ' + (e.amount > 0 ? '+' : '') + e.amount + ' !' + esc(e.item) + ' → ' + e.total + (e.how === 'dashboard' ? ' <span class="note">(you)</span>' : '');
    else if (e.kind === 'join') txt = '<b>' + esc(e.name) + '</b> joined ' + esc(teamName(e.team)) + (e.how === 'dashboard' ? ' <span class="note">(you)</span>' : '');
    else if (e.kind === 'moved') txt = '<b>' + esc(e.name) + '</b> moved to ' + esc(teamName(e.team));
    else if (e.kind === 'removed') txt = '<b>' + esc(e.name) + '</b> removed';
    else if (e.kind === 'reset') txt = 'Points reset (' + esc(e.item) + ')';
    else if (e.kind === 'cleared') txt = 'New contest started';
    lh += '<div class="' + (e.undone ? 'undone' : '') + '"><span class="t">' + tm + '</span><span>' + txt + '</span>' + (e.kind === 'points' && !e.undone ? '<button class="btn-sm" onclick="undo(' + e.id + ')">Undo</button>' : '') + '</div>';
  });
  $('log').innerHTML = lh || '<span class="empty">Nothing yet.</span>';
}
function plRow(p, teamOpts){
  var k = esc(p.key).replace(/'/g, '&#39;');
  return '<div class="pl"><span>' + esc(p.name) + '</span><span class="pts">' + p.points + '</span>' +
    '<span class="acts"><button class="btn-sm" onclick="pts(\'' + k + '\',-1)">−1</button><button class="btn-sm" onclick="pts(\'' + k + '\',1)">+1</button><button class="btn-sm" onclick="setPts(\'' + k + '\',' + p.points + ')">Set</button></span>' +
    '<span class="acts"><select data-k="' + k + '" data-t="' + p.team + '" onchange="move(\'' + k + '\',this.value)">' + teamOpts + '</select><button class="btn-sm btn-danger" title="Remove" onclick="removeP(\'' + k + '\')">✕</button></span></div>';
}
function teamName(l){ for (var i = 0; i < S.teams.length; i++) if (S.teams[i].letter === l) return S.teams[i].name; return 'Team ' + String(l).toUpperCase(); }
function nameOf(k){ for (var i = 0; i < S.players.length; i++) if (S.players[i].key === k) return S.players[i].name; return k; }

function load(){
  return api('/api/teams/admin').then(function(d){
    S = d; $('health').textContent = 'ICB connected'; $('health').className = 'health';
    if (!filled) { fillForm(); filled = true; }
    var a = document.activeElement;
    if (a && a.tagName === 'SELECT' && a.hasAttribute('data-k')) return; // don't close a dropdown she's using
    render();
  }).catch(function(){ $('health').textContent = 'ICB offline'; $('health').className = 'health offline'; });
}

['visible','joinOpen','counting','showBanner'].forEach(function(id){
  $(id).addEventListener('change', function(){ var b = {}; b[id] = $(id).checked; act('/api/teams/settings', b, 'Saved'); });
});
$('title').addEventListener('change', function(){ act('/api/teams/settings', { title: $('title').value }, 'Title saved'); });
$('showPlayers').addEventListener('change', function(){ act('/api/teams/settings', { showPlayers: Number($('showPlayers').value) }, 'Saved'); });
$('image').addEventListener('change', showThumb);
$('teamCount').addEventListener('change', renderTeamRows);

function curItem(){ return { command: $('command').value, aliases: $('aliases').value, label: $('label').value, image: $('image').value || null }; }
function saveItem(){
  if (!$('command').value.replace(/[^a-z0-9_]/gi, '')) { toast('Type a chat command first'); return; }
  act('/api/teams/settings', { item: curItem() }, 'Now counting !' + $('command').value.replace(/^!+/, '').toLowerCase()).then(function(){ filled = false; load(); });
}
function savePreset(){
  var it = curItem(), list = S.presets.filter(function(p){ return p.command !== it.command.replace(/^!+/, '').toLowerCase(); });
  list.push(it); act('/api/teams/settings', { presets: list, item: it }, 'Quick pick saved').then(function(){ filled = false; load(); });
}
function usePreset(i){ act('/api/teams/settings', { item: S.presets[i] }, 'Now counting !' + S.presets[i].command).then(function(){ filled = false; load(); }); }
function delPreset(i){ var list = S.presets.slice(); list.splice(i, 1); act('/api/teams/settings', { presets: list }, 'Removed'); }
function saveTeams(){
  var rows = [], ns = document.querySelectorAll('.tn'), cs = document.querySelectorAll('.tc');
  for (var i = 0; i < ns.length; i++) rows.push({ letter: ns[i].getAttribute('data-l'), name: ns[i].value, color: cs[i].value });
  act('/api/teams/settings', { teamCount: Number($('teamCount').value), teams: rows }, 'Teams saved').then(function(){ filled = false; load(); });
}
function pts(k, n){ act('/api/teams/points', { key: k, amount: n }); }
function setPts(k, cur){ var v = prompt('Set ' + nameOf(k) + '\'s points to:', cur); if (v === null || v === '' || isNaN(Number(v))) return; act('/api/teams/points', { key: k, set: Number(v) }, 'Set'); }
function move(k, team){ act('/api/teams/player', { name: nameOf(k), team: team }, nameOf(k) + ' moved'); }
function removeP(k){ if (!confirm('Take ' + nameOf(k) + ' off their team? Their points go too.')) return; act('/api/teams/player', { name: nameOf(k), team: '' }, 'Removed'); }
function addPlayer(){ var n = $('addName').value.trim(); if (!n) return; act('/api/teams/player', { name: n, team: $('addTeam').value }, n + ' added').then(function(){ $('addName').value = ''; }); }
function undo(id){ act('/api/teams/undo', { id: id }, 'Undone'); }
function resetPts(scope){ if (!confirm(scope === 'all' ? 'Reset EVERYONE\'s points for every item? Teams stay.' : 'Reset everyone\'s !' + S.item.command + ' points to 0? Teams stay.')) return; act('/api/teams/reset', { scope: scope }, 'Points reset'); }
function clearAll(){ if (!confirm('Start a new contest? Everyone comes off their team and all points are cleared.')) return; act('/api/teams/clear', {}, 'New contest'); }
function sendTest(){ api('/api/teams/test', { name: $('tName').value, text: $('tText').value }).then(function(d){ $('tResult').textContent = d.result; load(); }).catch(function(e){ $('tResult').textContent = e.message; }); }
$('tText').addEventListener('keydown', function(e){ if (e.key === 'Enter') sendTest(); });

load(); setInterval(load, 2000);
