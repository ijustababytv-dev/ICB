function $(id){ return document.getElementById(id); }
function api(p, b){ return fetch(p, b === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(b) }).then(function(r){ return r.json(); }); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
$('url').value = location.origin + '/chat-avatars.html';
function copyUrl(){ $('url').select(); try { navigator.clipboard.writeText($('url').value); } catch(e){ document.execCommand('copy'); } }

var D = null, filled = false;
var timers = {};
function save(k, v){ var o = {}; o[k] = v; clearTimeout(timers[k]); timers[k] = setTimeout(function(){ api('/api/avatars', o); }, 250); }
function unit(el){ return el.getAttribute('data-u') || ''; }
function showVal(k, v){ var s = document.querySelector('[data-v="' + k + '"]'); if (s) s.textContent = v + unit(s); }
function swatches(){ var s = (document.querySelector('[data-k=colors]').value || '').split(/[\s,]+/).filter(function(c){ return /^#[0-9a-f]{6}$/i.test(c); });
  $('sw').innerHTML = s.map(function(c){ return '<i style="background:' + c + '"></i>'; }).join(''); }

[].forEach.call(document.querySelectorAll('[data-k]'), function(el){
  var k = el.getAttribute('data-k');
  if (el.type === 'checkbox') el.onchange = function(){ save(k, el.checked); };
  else if (el.type === 'range') el.oninput = function(){ showVal(k, el.value); save(k, Number(el.value)); };
  else el.oninput = function(){ save(k, el.value); if (k === 'colors') swatches(); };
});
[].forEach.call(document.querySelectorAll('#bub button'), function(b){
  b.onclick = function(){ setBub(b.getAttribute('data-b')); api('/api/avatars', { bubbles: b.getAttribute('data-b') }); };
});
function setBub(v){ [].forEach.call(document.querySelectorAll('#bub button'), function(b){ b.className = b.getAttribute('data-b') === v ? 'on' : ''; }); }

function fill(s){
  [].forEach.call(document.querySelectorAll('[data-k]'), function(el){
    var k = el.getAttribute('data-k'); if (s[k] === undefined) return;
    if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k];
    if (el.type === 'range') showVal(k, s[k]);
  });
  setBub(s.bubbles); swatches();
}

function load(){
  return api('/api/avatars/admin').then(function(d){
    D = d; $('health').textContent = 'ICB connected'; $('health').className = 'health';
    if (!filled) { fill(d.settings); filled = true; }
    else { var v = document.querySelector('[data-k=visible]'); if (document.activeElement !== v) v.checked = !!d.settings.visible; }
    drawPool(); drawChatters();
  }).catch(function(){ $('health').textContent = 'ICB offline — run restart-icb-clean.bat'; $('health').className = 'health offline'; });
}
var poolKey = '';
function drawPool(){
  var on = D.avatars.filter(function(a){ return a.on; }).length;
  $('poolNote').textContent = '· ' + on + ' of ' + D.avatars.length + ' on';
  var key = JSON.stringify(D.avatars); if (key === poolKey) return; poolKey = key;
  $('pool').innerHTML = D.avatars.map(function(a){
    return '<div class="av' + (a.on ? '' : ' off') + '" onclick="tog(\'' + a.id + '\')" title="' + esc(a.name) + '"><img src="' + esc(a.url) + '" alt=""><div class="n">' + esc(a.name) + '</div>' +
      '<button class="btn-sm btn-danger x" onclick="event.stopPropagation();rm(\'' + a.id + '\',\'' + esc(a.name).replace(/'/g, '') + '\')">✕</button></div>';
  }).join('') + '<div class="av add" onclick="$(\'file\').click()" title="Add a picture">＋</div>';
}
var chatKey = '';
function drawChatters(){
  var key = JSON.stringify([D.chatters, D.avatars.length]); if (key === chatKey) return;
  if (document.activeElement && document.activeElement.tagName === 'SELECT') return;   // don't redraw while choosing
  chatKey = key;
  if (!D.chatters.length) { $('chatters').innerHTML = '<div class="note">Nobody has chatted since ICB started.</div>'; return; }
  var opts = D.avatars.map(function(a){ return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
  var byId = {}; D.avatars.forEach(function(a){ byId[a.id] = a; });
  $('chatters').innerHTML = D.chatters.map(function(c){
    var a = byId[c.avatar] || {}, ago = Math.round((Date.now() - c.at) / 60000);
    return '<div class="chat"><img src="' + esc(a.url || '') + '" alt=""><div class="who">' + esc(c.name) + (c.assigned ? ' <span class="pin">📌</span>' : '') + '<small>' + (ago < 1 ? 'just now' : ago + ' min ago') + '</small></div>' +
      '<select data-n="' + esc(c.name) + '" onchange="assign(this)"><option value="">' + (c.assigned ? 'Random (unpin)' : 'Random') + '</option>' + opts + '</select></div>';
  }).join('');
  [].forEach.call(document.querySelectorAll('#chatters select'), function(s){ var c = D.chatters.filter(function(x){ return x.name === s.getAttribute('data-n'); })[0]; s.value = (c && c.assigned) || ''; });
}
function tog(id){ api('/api/avatars', { toggleAvatar: id }).then(load); }
function rm(id, n){ if (confirm('Remove the ' + n + ' picture from ICB?')) api('/api/avatars/image', { remove: id }).then(load); }
function assign(s){ api('/api/avatars', { assign: { name: s.getAttribute('data-n'), avatar: s.value || null } }).then(function(){ s.blur(); chatKey = ''; load(); }); }
function test(){ api('/api/avatars', { test: { name: $('tName').value, text: $('tText').value } }).then(load); }
function tEv(t){ api('/api/avatars', { testEvent: t, name: $('tName').value }).then(load); }
function crowd(){
  var names = ['PixelPanda', 'CozyKitsu', 'MossyMoon', 'Sprinkles', 'NovaBean', 'TaroBoba', 'Glimmer', 'Biscuit'], lines = ['hiii!', 'GG', 'lol', '🦄', 'love this', 'hey Baby!', 'so cute', 'yay'];
  names.forEach(function(n, i){ setTimeout(function(){ api('/api/avatars', { test: { name: n, text: lines[i] } }); }, i * 350); });
  setTimeout(load, 3200);
}

// ---------- add pictures ----------
function prepPic(file){
  return new Promise(function(ok, fail){
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function(){
      var c = document.createElement('canvas'), w = img.naturalWidth, h = img.naturalHeight; c.width = w; c.height = h;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      var px = x.getImageData(0, 0, w, h).data, a = w, b = h, cc = -1, dd = -1;
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) if (px[(yy * w + xx) * 4 + 3] > 8) { if (xx < a) a = xx; if (xx > cc) cc = xx; if (yy < b) b = yy; if (yy > dd) dd = yy; }
      if (cc < 0) { a = 0; b = 0; cc = w - 1; dd = h - 1; }
      var cw = cc - a + 1, ch = dd - b + 1, sc = Math.min(1, 256 / Math.max(cw, ch)), o = document.createElement('canvas'); o.width = Math.round(cw * sc); o.height = Math.round(ch * sc);
      o.getContext('2d').drawImage(c, a, b, cw, ch, 0, 0, o.width, o.height); URL.revokeObjectURL(u); ok(o.toDataURL('image/webp', 0.92));
    };
    img.onerror = function(){ URL.revokeObjectURL(u); fail(new Error('That file is not a picture.')); };
    img.src = u;
  });
}
function addFiles(files){
  var list = [].slice.call(files || []).filter(function(f){ return /^image\//.test(f.type); }); if (!list.length) return;
  var go = function(i){
    if (i >= list.length) { poolKey = ''; return load(); }
    var f = list[i], def = (f.name || 'avatar').replace(/\.[a-z0-9]+$/i, '');
    var n = list.length === 1 ? prompt('Name for this avatar (chat types !avatar <name>)', def) : def; if (n === null) return load();
    prepPic(f).then(function(d){ return api('/api/avatars/image', { name: n, dataUrl: d }); }).then(function(r){ if (r.ok === false) alert(r.error); go(i + 1); }).catch(function(e){ alert(e.message); go(i + 1); });
  };
  go(0);
}
$('file').onchange = function(e){ addFiles(e.target.files); e.target.value = ''; };
document.addEventListener('dragover', function(e){ e.preventDefault(); });
document.addEventListener('drop', function(e){ e.preventDefault(); addFiles(e.dataTransfer.files); });
document.addEventListener('paste', function(e){
  if (/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
  var it = [].slice.call((e.clipboardData || {}).items || []).filter(function(i){ return i.type.indexOf('image') === 0; })[0];
  if (it) { e.preventDefault(); addFiles([it.getAsFile()]); }
});

load(); setInterval(load, 4000);
