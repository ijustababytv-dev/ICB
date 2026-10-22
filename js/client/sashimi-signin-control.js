var S = null, $ = function(id){ return document.getElementById(id); }, fillFor = '', rolesFor = '', zonesSig = '';
var COMMON_TZ = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function api(path, body){
  return fetch(path, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }).then(function(r){ return r.json(); });
}
function set(o){ return api('/api/sashimi', o).then(load); }
function ev(o){ o.event = S.live; return api('/api/sashimi', o).then(load); }
function flash(id, t){ $(id).textContent = t; setTimeout(function(){ $(id).textContent = ''; }, 2000); }
function copyUrl(){ navigator.clipboard.writeText('http://127.0.0.1:8790/sashimi-signin.html'); }
function newEv(){ var n = prompt('Name for the new event (e.g. Saturday Sashimi)'); if (n) { fillFor = ''; set({ newEvent: n }); } }
function copyEv(){ fillFor = ''; set({ copyEvent: S.live }); }
function delEv(){ if (S && S.events.length > 1 && confirm('Delete "' + (S.event && S.event.name) + '" and its list?')) { fillFor = ''; set({ deleteEvent: S.live }); } }
function saveDetails(){ ev({ name: $('evName').value, game: $('evGame').value, desc: $('evDesc').value, date: $('evDate').value, time: $('evTime').value, tz: $('evTz').value }).then(function(){ flash('detSaved', 'Saved ✓'); }); }
function clearTime(){ $('evDate').value = ''; $('evTime').value = ''; saveDetails(); }
// ----- roles editor (only redrawn when the event changes or after saving, so typing is never lost) -----
function roleRow(r){
  var d = document.createElement('div'); d.className = 'rrow'; d.setAttribute('data-id', r.id || '');
  d.innerHTML = '<input type="text" class="rl" placeholder="Fish Prep"><input type="text" class="rc" placeholder="fish"><input type="number" class="rs" min="0" max="200"><input type="color" class="rcol"><button class="btn-sm btn-danger" title="Remove role">✕</button>';
  d.querySelector('.rl').value = r.label || ''; d.querySelector('.rc').value = r.cmd ? '!' + r.cmd : ''; d.querySelector('.rs').value = r.spots || 0;
  d.querySelector('.rcol').value = r.color || (S && S.accent) || '#ff8fd8';
  d.querySelector('button').onclick = function(){ d.remove(); };
  return d;
}
function addRoleRow(){ var n = $('noroles'); if (n) n.remove(); $('roles').appendChild(roleRow({})); }
function drawRoles(){ var box = $('roles'); box.innerHTML = ''; (S.event ? S.event.roles : []).forEach(function(r){ box.appendChild(roleRow(r)); }); if (!box.children.length) box.innerHTML = '<div class="empty" id="noroles">No roles - chat signs up with ! + their name.</div>'; }
function saveRoles(){
  var rows = [].slice.call($('roles').querySelectorAll('.rrow')).map(function(d){
    return { id: d.getAttribute('data-id'), label: d.querySelector('.rl').value, cmd: d.querySelector('.rc').value, spots: d.querySelector('.rs').value, color: d.querySelector('.rcol').value };
  }).filter(function(r){ return r.label.trim() || r.cmd.trim(); });
  var bad = rows.filter(function(r){ return !r.label.trim() || !r.cmd.replace(/[^a-z0-9_]/gi, ''); });
  if (bad.length) { alert('Every role needs a name and a command.'); return; }
  ev({ roles: rows }).then(function(){ rolesFor = ''; flash('rolesSaved', 'Saved ✓'); });
}
// ----- world clocks -----
function tzNow(tz){ try { return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }); } catch (e) { return '?'; } }
function zonesPayload(){ return [].slice.call($('zones').querySelectorAll('[data-tz]')).map(function(l){ return { tz: l.getAttribute('data-tz'), label: l.querySelector('input[type=text]').value, on: l.querySelector('input[type=checkbox]').checked }; }); }
function drawZones(){
  $('zones').innerHTML = S.allZones.map(function(z){
    return '<label data-tz="' + esc(z.tz) + '"><input type="checkbox"' + (z.on ? ' checked' : '') + '><input type="text" value="' + esc(z.label) + '"><span class="zprev">' + tzNow(z.tz) + '</span></label>';
  }).join('');
  [].forEach.call($('zones').querySelectorAll('input'), function(i){ i.onchange = function(){ zonesSig = ''; set({ zones: zonesPayload() }); }; });
}
function addZone(){
  var tz = $('newTz').value.trim(); if (!tz) return;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { alert('That time zone name was not recognised. Use the form Region/City, e.g. Asia/Seoul.'); return; }
  var z = zonesPayload(); z.push({ tz: tz, label: $('newTzLabel').value.trim(), on: true });
  zonesSig = ''; set({ zones: z }).then(function(){ $('newTz').value = ''; $('newTzLabel').value = ''; });
}
function addGuests(){ ev({ add: $('guests').value.split(/\r?\n/), addRole: $('addRole').value }).then(function(){ $('guests').value = ''; flash('saved', 'Added ✓'); }); }
function rm(n){ ev({ remove: n }); }
function mv(n, d){ ev({ move: { n: n, dir: d } }); }
function rn(n, old){ var v = prompt('Name for #' + n, old); if (v) ev({ rename: { n: n, name: v } }); }
function setRole(n, r){ ev({ setRole: { n: n, role: r } }); }
function forget(tw){ if (confirm('Forget the remembered name for ' + tw + '?')) set({ forget: { game: S.event.game, twitch: tw } }); }
function clearList(){ if (confirm('Remove everyone from this event\'s list?')) ev({ clear: true }); }
function tm(t){ return t ? new Date(t).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : ''; }
function load(){
  return api('/api/sashimi/admin').then(function(d){
    S = d; $('health').textContent = 'ICB connected'; $('health').className = 'health';
    $('evSel').innerHTML = d.events.map(function(e){ return '<option value="' + e.id + '"' + (e.id === d.live ? ' selected' : '') + '>' + esc(e.name) + ' (' + e.count + ')</option>'; }).join('');
    var e = d.event; if (!e) return;
    $('gameList').innerHTML = (d.games || []).map(function(g){ return '<option value="' + esc(g) + '">'; }).join('');
    // time zone choices for "Starts": her ticked zones + common ones + the event's own
    var tzs = []; d.allZones.forEach(function(z){ if (tzs.indexOf(z.tz) < 0) tzs.push(z.tz); }); COMMON_TZ.concat([e.tz]).forEach(function(t){ if (tzs.indexOf(t) < 0) tzs.push(t); });
    var lab = {}; d.allZones.forEach(function(z){ lab[z.tz] = z.label; });
    if (fillFor !== e.id) {
      fillFor = e.id;
      $('evTz').innerHTML = tzs.map(function(t){ return '<option value="' + esc(t) + '">' + esc((lab[t] ? lab[t] + ' — ' : '') + t) + '</option>'; }).join('');
      $('evName').value = e.name; $('evGame').value = e.game || 'Palia'; $('evDesc').value = e.desc || '';
      $('evDate').value = e.date || ''; $('evTime').value = e.time || ''; $('evTz').value = e.tz;
    }
    if (rolesFor !== e.id + JSON.stringify(e.roles)) { rolesFor = e.id + JSON.stringify(e.roles); drawRoles(); }
    $('clash').innerHTML = d.clashes && d.clashes.length ? '<div class="warn">⚠️ ' + d.clashes.map(function(c){ return '!' + c; }).join(', ') + ' is also a command on a live party board or another sign-up widget - chat would sign up for both. Pick a different command.</div>' : '';
    var zs = JSON.stringify(d.allZones); if (zs !== zonesSig && !$('zones').contains(document.activeElement)) { zonesSig = zs; drawZones(); }
    var roleName = {}; e.roles.forEach(function(r){ roleName[r.id] = r.label; });
    var opts = function(sel){ return '<option value="">' + (e.roles.length ? '(no role)' : '—') + '</option>' + e.roles.map(function(r){ return '<option value="' + r.id + '"' + (r.id === sel ? ' selected' : '') + '>' + esc(r.label) + '</option>'; }).join(''); };
    if (document.activeElement !== $('addRole')) { var keep = $('addRole').value; $('addRole').innerHTML = opts(''); $('addRole').value = keep; }
    $('cnt').textContent = d.max ? d.total + ' / ' + d.max : d.total;
    $('builtin').textContent = (d.builtinIgnore || []).map(function(x){ return '!' + x; }).join('  ');
    if (!document.activeElement || !$('list').contains(document.activeElement))
    $('list').innerHTML = e.guests.length ? e.guests.map(function(g){
      return '<div class="gl"><span class="n">' + g.n + '</span><span><a href="#" style="color:inherit;text-decoration:none" onclick="rn(' + g.n + ',\'' + esc(g.name).replace(/'/g, '&#39;') + '\');return false">' + esc(g.name) + '</a>' +
        (e.roles.length ? ' <select class="btn-sm" style="padding:2px 4px;font-size:12px" onchange="setRole(' + g.n + ',this.value)">' + opts(g.role) + '</select>' : '') + '</span>' +
        '<span class="who">' + (g.twitch ? esc(g.twitch) + ' · ' : '✍️ added by you · ') + tm(g.at) + '</span>' +
        '<span><button class="btn-sm" onclick="mv(' + g.n + ',-1)">↑</button> <button class="btn-sm" onclick="mv(' + g.n + ',1)">↓</button> <button class="btn-sm btn-danger" onclick="rm(' + g.n + ')">✕</button></span></div>';
    }).join('') : '<div class="empty">No one yet.</div>';
    $('remGame').textContent = '— ' + (e.game || 'Palia') + ' (' + (d.remembered || []).length + ')';
    $('rem').innerHTML = (d.remembered || []).length ? d.remembered.map(function(r){ return '<div><span><b>' + esc(r.name) + '</b> <span class="note">· ' + esc(r.twitch) + '</span></span><button class="btn-sm btn-danger" onclick="forget(\'' + esc(r.twitch).replace(/'/g, '&#39;') + '\')">✕</button></div>'; }).join('') : '<div class="empty">Nobody yet for this game.</div>';
    ['visible', 'open', 'showZones', 'showCountdown', 'onDemand', 'showOnSignup'].forEach(function(k){ $(k).checked = !!d[k]; });
    if (document.activeElement !== $('showSec')) $('showSec').value = d.showSec;
    $('shownLeft').textContent = d.chatHidden ? 'Hidden by !hide poke - chat types !show poke (or click Show it now)' : d.onDemand ? (d.shownLeft ? 'On screen now - ' + d.shownLeft + 's left' : 'Hidden right now') : '';
    ['title', 'font', 'cols', 'max', 'ignore', 'accent', 'panelColor', 'panelOpacity'].forEach(function(k){ if (document.activeElement !== $(k)) $(k).value = d[k]; });
  }).catch(function(){ $('health').textContent = 'ICB offline'; $('health').className = 'health offline'; });
}
load(); setInterval(load, 3000);
