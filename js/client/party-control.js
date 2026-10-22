var $ = function(id){ return document.getElementById(id); };
var A = null, cur = null, roles = [], formFor = null;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function q(s){ return esc(s).replace(/'/g, '&#39;'); }
function toast(t){ var e = $('toast'); e.textContent = t; e.className = 'toast show'; clearTimeout(e._t); e._t = setTimeout(function(){ e.className = 'toast'; }, 2400); }
function api(path, body){
  return fetch(path, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ return r.json(); }).then(function(d){ if (!d.ok) throw new Error(d.error || 'Failed'); return d; });
}
function act(path, body, msg){ return api(path, body).then(function(d){ if (msg) toast(msg); return load().then(function(){ return d; }); }).catch(function(e){ toast('⚠️ ' + e.message); }); }
function copyUrl(b){ var u = 'http://127.0.0.1:8790/party.html?board=' + (b || 1); try { navigator.clipboard.writeText(u); toast('Copied ' + u); } catch (e) { prompt('Copy this link:', u); } }
function ev(){ for (var i = 0; i < A.full.length; i++) if (A.full[i].id === cur) return A.full[i]; return A.full[0]; }

function fillForm(){
  var e = ev(); formFor = e.id;
  $('title').value = e.title || ''; $('when').value = e.when || ''; $('subtitle').value = e.subtitle || ''; $('open').checked = e.open;
  $('startAt').value = e.startAt ? toLocalInput(e.startAt) : ''; $('warnMin').value = e.warnMin || 10; syncTime();
  roles = e.roles.map(function(r){ return { id: r.id, emoji: r.emoji, label: r.label, command: r.command, spots: r.spots, group: r.group || '', bring: r.bring || '' }; });
  renderRoles();
  fillLook(e);
}
function renderRoles(){
  var h = '';
  roles.forEach(function(r, i){
    h += '<div class="rbox2"><div class="rrow"><input type="text" value="' + q(r.emoji) + '" maxlength="8" oninput="roles[' + i + '].emoji=this.value" style="text-align:center">' +
      '<input type="text" value="' + q(r.label) + '" maxlength="40" placeholder="Tomato" oninput="roles[' + i + '].label=this.value">' +
      '<span class="cmdw">!<input type="text" value="' + q(r.command) + '" maxlength="24" placeholder="tomato" oninput="roles[' + i + '].command=this.value"></span>' +
      '<input type="number" min="1" max="50" value="' + r.spots + '" oninput="roles[' + i + '].spots=Number(this.value)">' +
      '<span class="acts"><button class="btn-sm" onclick="mvRole(' + i + ',-1)">↑</button><button class="btn-sm" onclick="mvRole(' + i + ',1)">↓</button><button class="btn-sm" onclick="rmRole(' + i + ')">✕</button></span></div>' +
      '<div class="rrow2"><span>Section</span><input type="text" list="groupList" value="' + q(r.group) + '" maxlength="30" placeholder="e.g. Overprep, Cooking, Helpers" oninput="roles[' + i + '].group=this.value"></div>' +
      '<div class="rrow2"><span>🧺 Must bring</span><input type="text" value="' + q(r.bring) + '" maxlength="200" placeholder="e.g. 50 Tomatoes + 10 Onions" oninput="roles[' + i + '].bring=this.value"></div></div>';
  });
  $('roles').innerHTML = h || '<div class="empty">No roles yet — add one.</div>';
}
function mvRole(i, d){ var j = i + d; if (j < 0 || j >= roles.length) return; var t = roles[i]; roles[i] = roles[j]; roles[j] = t; renderRoles(); }
function rmRole(i){ roles.splice(i, 1); renderRoles(); }
function addRole(){ var last = roles[roles.length - 1]; roles.push({ emoji:'', label:'', command:'', spots:2, group: last ? last.group : '', bring:'' }); renderRoles(); }
function saveRoles(){
  for (var i = 0; i < roles.length; i++) if (!String(roles[i].command).replace(/[^a-z0-9_]/gi, '')) { toast('Every role needs a chat command'); return; }
  act('/api/party/event', { id: cur, roles: roles }, 'Roles saved').then(function(){ fillForm(); });
}
function saveDetails(){ act('/api/party/event', { id: cur, title: $('title').value, when: $('when').value, subtitle: $('subtitle').value, open: $('open').checked }, 'Saved'); }

function render(){
  var e = ev();
  var opts = A.events.map(function(x){ return '<option value="' + x.id + '"' + (x.id === cur ? ' selected' : '') + '>' + (x.slot ? '📺' + x.slot + ' ' : '') + esc(x.title || 'Untitled') + (x.when ? ' — ' + esc(x.when) : '') + ' (' + x.count + ')</option>'; }).join('');
  $('evPick').innerHTML = opts;
  var mySlot = null; A.events.forEach(function(x){ if (x.id === cur) mySlot = x.slot; });
  $('liveTag').textContent = mySlot ? '● LIVE · Board ' + mySlot : 'not on stream'; $('liveTag').className = 'live' + (mySlot ? ' on' : '');
  $('takeOff').style.display = mySlot ? '' : 'none';
  if (document.activeElement !== $('putBoard')) { if (mySlot) $('putBoard').value = String(mySlot); else { var free = A.slots.indexOf(null); $('putBoard').value = String(free >= 0 ? free + 1 : 1); } }
  renderBoards();
  $('visible').checked = A.visible; $('showTwitch').checked = A.showTwitch;
  $('chatHid').textContent = A.chatHidden ? 'Hidden by !hide cake right now (chat types !show cake or click Show all now).' : '';
  $('onDemand').checked = !!A.onDemand; $('showOnSignup').checked = A.showOnSignup !== false; if (document.activeElement !== $('showSec')) $('showSec').value = A.showSec || 30;
  $('countNote').textContent = '— ' + e.filled + ' / ' + e.spots + ' spots filled' + (e.open ? '' : ' · sign-ups closed');
  var roleOpts = e.roles.map(function(r){ return '<option value="' + r.id + '">' + esc((r.emoji ? r.emoji + ' ' : '') + r.label) + '</option>'; }).join('');
  var keepRole = $('addRole').value; $('addRole').innerHTML = roleOpts; if (keepRole) $('addRole').value = keepRole;
  var byKey = {}; e.signups.forEach(function(s){ byKey[s.twitch.toLowerCase()] = s; });
  var h = '';
  e.roles.forEach(function(r){
    h += '<div class="rbox"><h3><span>' + esc((r.emoji ? r.emoji + ' ' : '') + r.label) + ' <span class="note">!' + esc(r.cmdShown || r.command) + '</span></span><span><button class="btn-sm" title="Fold or open this role on the stream board" onclick="foldRole(\'' + r.id + '\',' + (r.collapsed ? 'false' : 'true') + ')">' + (r.collapsed ? '▸ Folded on stream' : '▾ Fold on stream') + '</button> <span class="ct">' + r.people.length + ' / ' + r.spots + '</span></span></h3>' + (r.bring ? '<div class="bring-note">🧺 ' + esc(r.bring) + '</div>' : '');
    if (!r.people.length && !r.waitlist.length) h += '<div class="empty">Nobody yet.</div>';
    r.people.forEach(function(p){ h += sRow(p, r, roleOpts, false); });
    if (r.waitlist.length) { h += '<div class="wl">⏳ Waitlist</div>'; r.waitlist.forEach(function(p){ h += sRow(p, r, roleOpts, true); }); }
    h += '</div>';
  });
  $('signups').innerHTML = h || '<div class="empty">Add roles first.</div>';
  var sels = document.querySelectorAll('#signups select[data-r]');
  for (var i = 0; i < sels.length; i++) sels[i].value = sels[i].getAttribute('data-r');
}
function phaseNow(e){ if (!e.startAt) return ''; var left = e.startAt - (Date.now() + (A.skew || 0)); return left <= 0 ? 'late' : (left <= (e.warnMin || 10) * 60000 ? 'soon' : ''); }
function sRow(p, r, roleOpts, waiting){
  var k = q(p.twitch.toLowerCase()), ph = phaseNow(ev()), cls = p['in'] ? 'in' : ph;
  return '<div class="srow"><span class="who"><b class="' + cls + '">' + (p['in'] ? '✔ ' : '') + esc(p.palia) + '</b><small>@' + esc(p.twitch) + '</small></span>' +
    '<select data-r="' + r.id + '" onchange="setRole(\'' + k + '\',this.value)">' + roleOpts + '</select>' +
    '<span class="acts"><button class="btn-sm btn-in' + (p['in'] ? ' on' : '') + '" onclick="checkIn(\'' + k + '\',' + (p['in'] ? 'false' : 'true') + ')">' + (p['in'] ? '✔ Signed in' : 'Sign in') + '</button>' + (waiting ? '<button class="btn-sm" onclick="moveIn(\'' + k + '\')">Move in</button>' : '') +
    '<button class="btn-sm" onclick="rename(\'' + k + '\')">✎</button><button class="btn-sm btn-danger" onclick="removeP(\'' + k + '\')">✕</button></span></div>';
}
function checkIn(k, on){ act('/api/party/signup', { id: cur, key: k, checkedIn: on }, on ? 'Signed in ✔' : 'Sign-in removed'); }
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function toLocalInput(ms){ var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function cdIn(min){ $('startAt').value = toLocalInput(Date.now() + min * 60000); syncTime(); }
// "7 PM" style: today at that time, or tomorrow if it already passed.
function fromTime(hh, mm){ var d = new Date(); d.setHours(hh, mm || 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }
function atTime(hh){ $('startTime').value = pad2(hh) + ':00'; $('startAt').value = toLocalInput(fromTime(hh, 0)); }
function syncTime(){ var v = $('startAt').value; $('startTime').value = v ? v.slice(11, 16) : ''; }
$('startTime').addEventListener('change', function(){ var v = $('startTime').value; if (!v) return; $('startAt').value = toLocalInput(fromTime(Number(v.slice(0, 2)), Number(v.slice(3, 5)))); });
$('startAt').addEventListener('change', syncTime);
function saveCountdown(){
  var v = $('startAt').value; if (!v) { toast('Pick when the party starts'); return; }
  var ms = new Date(v).getTime(); if (!(ms > 0)) { toast('That time doesn\'t look right'); return; }
  act('/api/party/event', { id: cur, startAt: ms, warnMin: Number($('warnMin').value) || 10 }, 'Countdown set ⏰');
}
function clearCountdown(){ $('startAt').value = ''; act('/api/party/event', { id: cur, startAt: null }, 'Countdown stopped'); }
function resetCheckins(){ if (!confirm('Clear everyone\'s sign-in for this event?')) return; act('/api/party/event', { id: cur, resetCheckins: true }, 'Sign-ins cleared'); }
function cdText(){
  if (!A) return; var e = ev(), el = $('cdLive');
  if (!e.startAt) { el.textContent = '— not running'; return; }
  var left = Math.round((e.startAt - (Date.now() + (A.skew || 0))) / 1000);
  if (left <= 0) { el.innerHTML = '— <span class="cdl">🎉 party started</span> · ' + e.checkedIn + ' / ' + e.filled + ' signed in'; return; }
  var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), sec = left % 60;
  el.innerHTML = '— starts in <span class="cdl">' + (h ? h + 'h ' : '') + m + 'm ' + pad2(sec) + 's</span> · ' + e.checkedIn + ' / ' + e.filled + ' signed in';
}
setInterval(cdText, 1000);
function artOptions(sel){ var o = '<option value="">(none)</option>'; (A.art || []).forEach(function(f){ o += '<option' + (f === sel ? ' selected' : '') + '>' + esc(f) + '</option>'; }); return o; }
function showThumb(sel, img){ var f = $(sel).value, im = $(img); if (f) { im.src = '/assets/party/' + encodeURIComponent(f); im.style.display = 'block'; } else im.style.display = 'none'; }
function fillLook(e){
  var a = e.art || {};
  $('bgImage').innerHTML = artOptions(a.bgFile); $('titleImage').innerHTML = artOptions(a.titleFile);
  $('bgFit').value = a.fit || 'cover'; $('panel').value = a.panel === undefined ? 86 : a.panel; $('roleCards').value = a.roleCards === undefined ? 40 : a.roleCards;
  $('border').checked = a.border !== false; slid(); showThumb('bgImage', 'bgThumb'); showThumb('titleImage', 'titleThumb');
}
function slid(){ $('panelV').textContent = $('panel').value + '%'; $('roleCardsV').textContent = $('roleCards').value + '%'; }
function lookBody(){ return { id: cur, bgImage: $('bgImage').value || null, titleImage: $('titleImage').value || null, bgFit: $('bgFit').value, panel: Number($('panel').value), roleCards: Number($('roleCards').value), border: $('border').checked }; }
function saveLook(all){
  var b = lookBody(); if (all) { if (!confirm('Use this background, banner and darkness on every party?')) return; b.artToAll = true; }
  act('/api/party/event', b, all ? 'Look copied to all parties 🎨' : 'Look saved 🎨');
}
// Live preview while sliding: save after you stop moving for a moment.
var slideT = null;
function slideSave(){ slid(); clearTimeout(slideT); slideT = setTimeout(function(){ api('/api/party/event', lookBody()).catch(function(){}); }, 350); }
// Upload: big pictures are shrunk in the browser first (max 2560 px wide) so they fit.
function uploadArt(input, target){
  var f = input.files && input.files[0]; if (!f) return;
  var send = function(dataUrl){ toast('Uploading…'); api('/api/party/image', { dataUrl: dataUrl, name: f.name }).then(function(d){
      A.art = (A.art || []).concat([d.file]).sort(); var keepBg = $('bgImage').value, keepT = $('titleImage').value;
      $('bgImage').innerHTML = artOptions(target === 'bgImage' ? d.file : keepBg); $('titleImage').innerHTML = artOptions(target === 'titleImage' ? d.file : keepT);
      showThumb('bgImage', 'bgThumb'); showThumb('titleImage', 'titleThumb'); saveLook(); input.value = '';
    }).catch(function(e){ toast('⚠️ ' + e.message); }); };
  var r = new FileReader();
  r.onload = function(){
    if (f.size <= 8 * 1024 * 1024) return send(r.result);
    var im = new Image(); im.onload = function(){ var w = Math.min(2560, im.width), h = Math.round(im.height * w / im.width), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); send(c.toDataURL('image/png').length < 11e6 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9)); };
    im.src = r.result;
  };
  r.readAsDataURL(f);
}
function foldRole(roleId, on){ act('/api/party/collapse', { id: cur, roleId: roleId, collapsed: on }, on ? 'Folded on stream' : 'Opened on stream'); }
function foldAll(on){ act('/api/party/collapse', { id: cur, all: on }, on ? 'All roles folded' : 'All roles opened'); }
function setRole(k, role){ act('/api/party/signup', { id: cur, key: k, role: role }, 'Moved'); }
function moveIn(k){ act('/api/party/signup', { id: cur, key: k, top: true }, 'Moved off the waitlist'); }
function rename(k){ var old = ''; ev().signups.forEach(function(s){ if (s.key === k) old = s.palia; }); var v = prompt('Palia name:', old); if (!v) return; act('/api/party/signup', { id: cur, key: k, palia: v }, 'Renamed'); }
function removeP(k){ act('/api/party/signup', { id: cur, key: k, remove: true }, 'Removed'); }
function addPerson(){
  var t = $('addTwitch').value.trim(), p = $('addPalia').value.trim();
  if (!t && !p) { toast('Type a name'); return; }
  act('/api/party/signup', { id: cur, twitch: t || p, palia: p || t, role: $('addRole').value }, 'Added').then(function(){ $('addTwitch').value = ''; $('addPalia').value = ''; });
}
function copyList(){
  var e = ev(), lines = [e.title + (e.when ? ' — ' + e.when : '')];
  var lastGroup = null;
  e.roles.forEach(function(r){
    if ((r.group || '') !== lastGroup) { lastGroup = r.group || ''; if (lastGroup) lines.push('', '== ' + lastGroup + ' =='); }
    lines.push((r.emoji ? r.emoji + ' ' : '') + r.label + ' (' + r.people.length + '/' + r.spots + '): ' + (r.people.map(function(p){ return p.palia; }).join(', ') || '—'));
    if (r.bring) lines.push('   bring: ' + r.bring);
    if (r.waitlist.length) lines.push('   waitlist: ' + r.waitlist.map(function(p){ return p.palia; }).join(', '));
  });
  try { navigator.clipboard.writeText(lines.join('\n')); toast('List copied'); } catch (x) { prompt('Copy this:', lines.join(' | ')); }
}
function clearSignups(){ if (!confirm('Remove everyone from this event?')) return; act('/api/party/event', { id: cur, clearSignups: true }, 'Cleared'); }
function makeLive(){ var n = Number($('putBoard').value); act('/api/party/settings', { board: n, eventId: cur }, 'Now on Board ' + n + ' 📺'); }
function takeOff(){ var n = null; A.events.forEach(function(x){ if (x.id === cur) n = x.slot; }); if (n) act('/api/party/settings', { board: n, eventId: null }, 'Taken off Board ' + n); }
function setBoard(n, id){ act('/api/party/settings', { board: n, eventId: id || null }, id ? 'Board ' + n + ' updated' : 'Board ' + n + ' cleared'); }
function spotShow(n){ act('/api/party/settings', { spotShow: n }, 'Spotlight → Board ' + n); }
function saveSpot(){ act('/api/party/settings', { spotRotateSec: Number($('spotRotate').value), spotHoldSec: Number($('spotHold').value), spotChat: $('spotChat').checked }, 'Spotlight saved'); }
var spotFilled = false;
function renderBoards(){
  var a = document.activeElement; if (a && a.getAttribute && a.getAttribute('data-board')) return;
  var h = '';
  for (var n = 1; n <= 7; n++) {
    var id = A.slots[n - 1], o = '<option value="">— empty —</option>';
    A.events.forEach(function(x){ o += '<option value="' + x.id + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.title || 'Untitled') + (x.when ? ' — ' + esc(x.when) : '') + '</option>'; });
    h += '<div class="brow"><b>Board ' + n + '</b><select data-board="' + n + '" onchange="setBoard(' + n + ',this.value)">' + o + '</select>' +
      '<button class="btn-sm" onclick="copyUrl(' + n + ')">Copy link</button>' + (id ? '<button class="btn-sm" onclick="spotShow(' + n + ')">📣 Spotlight</button>' : '<span></span>') + '</div>';
  }
  $('boards').innerHTML = h;
  var sp = A.spot || {};
  $('spotNow').textContent = sp.slot ? '— now showing Board ' + sp.slot + (sp.held ? ' (asked by ' + sp.by + ', ' + sp.leftSec + 's left)' : ' (rotating)') : '— no live boards';
  if (!spotFilled) { $('spotRotate').value = sp.rotateSec || 20; $('spotHold').value = sp.holdSec || 60; $('spotChat').checked = sp.chat !== false; spotFilled = true; }
}
function newEvent(copy){ act('/api/party/event/new', copy ? { copyFrom: cur } : {}, copy ? 'Event copied' : 'New event').then(function(d){ if (d) { cur = d.id; fillForm(); render(); } }); }
function delEvent(){ var e = ev(); if (!confirm('Delete "' + (e.title || 'this event') + '" and its sign-ups?')) return; act('/api/party/event', { id: cur, delete: true }, 'Deleted').then(function(){ cur = A.liveId; fillForm(); render(); }); }
function sendTest(){ api('/api/party/test', { name: $('tName').value, text: $('tText').value }).then(function(d){ $('tResult').textContent = d.result; load(); }).catch(function(e){ $('tResult').textContent = e.message; }); }
$('panel').addEventListener('input', slideSave); $('roleCards').addEventListener('input', slideSave);
$('bgImage').addEventListener('change', function(){ showThumb('bgImage', 'bgThumb'); saveLook(); });
$('titleImage').addEventListener('change', function(){ showThumb('titleImage', 'titleThumb'); saveLook(); });
$('bgFit').addEventListener('change', function(){ saveLook(); }); $('border').addEventListener('change', function(){ saveLook(); });
$('tText').addEventListener('keydown', function(e){ if (e.key === 'Enter') sendTest(); });
$('evPick').addEventListener('change', function(){ cur = $('evPick').value; fillForm(); render(); });
['onDemand','showOnSignup'].forEach(function(id){ $(id).addEventListener('change', function(){ var b = {}; b[id] = $(id).checked; act('/api/party/settings', b, 'Saved'); }); });
$('showSec').addEventListener('change', function(){ act('/api/party/settings', { showSec: Number($('showSec').value) }, 'Saved'); });
['visible','showTwitch'].forEach(function(id){ $(id).addEventListener('change', function(){ var b = {}; b[id] = $(id).checked; act('/api/party/settings', b, 'Saved'); }); });
$('open').addEventListener('change', function(){ act('/api/party/event', { id: cur, open: $('open').checked }, $('open').checked ? 'Sign-ups open' : 'Sign-ups closed'); });

function load(){
  return api('/api/party/admin').then(function(d){
    A = d; A.skew = (d.now || Date.now()) - Date.now(); cdText(); $('health').textContent = 'ICB connected'; $('health').className = 'health';
    if (!cur || !A.full.some(function(e){ return e.id === cur; })) cur = A.liveId;
    if (formFor !== cur) fillForm();
    var a = document.activeElement;
    if (a && a.tagName === 'SELECT' && a.hasAttribute('data-r')) return;
    render();
  }).catch(function(){ $('health').textContent = 'ICB offline'; $('health').className = 'health offline'; });
}
load(); setInterval(load, 2000);
