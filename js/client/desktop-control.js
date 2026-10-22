var S = null, sel = null, $ = function(id){ return document.getElementById(id); }, cards = {}, dragging = null;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function api(path, body){
  return fetch(path, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }).then(function(r){ return r.json(); });
}
function post(o){ return api('/api/desktop', o).then(function(d){ if (d && d.ok) render(d); return d; }); }
function upd(id, o){ o.id = id; return post({ update: o }); }
function W(id){ return S && S.widgets.filter(function(w){ return w.id === id; })[0]; }
function displays(){ return (S && S.app.displays && S.app.displays.length) ? S.app.displays : [{ id:'0', x:0, y:0, w:1920, h:1080, primary:true }]; }
function dispOf(w){
  var cx = w.x + w.w / 2, cy = w.y + w.h / 2, ds = displays();
  for (var i = 0; i < ds.length; i++) { var d = ds[i]; if (cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h) return d; }
  return ds.filter(function(d){ return d.primary; })[0] || ds[0];
}
function addW(){
  var u = $('addUrl').value.trim(); if (!u) return;
  post({ add: { name: $('addName').value.trim() || 'Widget', url: u } }).then(function(d){
    if (d && d.ok) { $('addName').value = ''; $('addUrl').value = ''; $('addMsg').textContent = 'Added ✓'; sel = d.widgets[d.widgets.length - 1].id; }
    else $('addMsg').textContent = (d && d.error) || 'Could not add';
    setTimeout(function(){ $('addMsg').textContent = ''; }, 2500);
  });
}
function addCam(){
  post({ add: { name: 'My webcam', url: '/webcam.html?mirror=1&shape=round&border=ff8fd8&bw=4', w: 480, h: 270 } }).then(function(d){ if (d && d.ok) sel = d.widgets[d.widgets.length - 1].id; });
}
function isCam(w){ return /\/webcam\.html/.test(w.url); }
function camOpts(u){ var o = { cam:'', mirror:'1', shape:'round', border:'ff8fd8', bw:'4' }, i = u.indexOf('?');
  if (i >= 0) u.slice(i + 1).split('&').forEach(function(p){ var k = p.split('='); if (k[0]) o[decodeURIComponent(k[0])] = decodeURIComponent(k[1] || ''); }); return o; }
function camSave(id){
  var c = cards[id], q = function(s){ return c.querySelector(s); }, w = W(id);
  var o = { cam: q('.ccam').value, mirror: q('.cmir').checked ? '1' : '0', shape: q('.cshape').value, border: q('.cbor').value.replace('#', ''), bw: q('.cbw').value };
  var base = w.url.split('?')[0], parts = [];
  for (var k in o) if (o[k] !== '' || k !== 'cam') parts.push(k + '=' + encodeURIComponent(o[k]));
  upd(id, { url: base + '?' + parts.join('&') });
}
function nudge(id, dx, dy){ var w = W(id), st = Number(cards[id].querySelector('.step').value); upd(id, { x: w.x + dx * st, y: w.y + dy * st }); }
function preset(id, where){
  var w = W(id), d = dispOf(w), m = 20, x = w.x, y = w.y;
  if (where.indexOf('l') >= 0) x = d.x + m; if (where.indexOf('r') >= 0) x = d.x + d.w - w.w - m;
  if (where.indexOf('t') >= 0) y = d.y + m; if (where.indexOf('b') >= 0) y = d.y + d.h - w.h - m;
  if (where === 'c') { x = d.x + Math.round((d.w - w.w) / 2); y = d.y + Math.round((d.h - w.h) / 2); }
  upd(id, { x: x, y: y });
}
function removeW(id){ var w = W(id); if (confirm('Remove "' + w.name + '" from your desktop?')) post({ remove: id }); }

function buildCard(w){
  var c = document.createElement('div'); c.className = 'wcard'; c.setAttribute('data-id', w.id);
  c.innerHTML =
    '<h3><label class="switch" title="Show / hide"><input type="checkbox" class="on"><span></span></label><input type="text" class="name"></h3>' +
    '<div class="row"><label style="min-width:40px">Link</label><input type="text" class="url" list="known" style="flex:1"><button class="btn-sm rl" title="Reload">↻</button></div>' +
    '<div class="nums"><div><label>Left (x)</label><input type="number" class="x"></div><div><label>Top (y)</label><input type="number" class="y"></div>' +
    '<div><label>Width</label><input type="number" class="w"></div><div><label>Height</label><input type="number" class="h"></div></div>' +
    '<div class="flexrow"><div><div class="note" style="margin:0 0 3px">Nudge</div><div class="pad">' +
      '<span></span><button class="btn-sm" data-n="0,-1">↑</button><span></span><button class="btn-sm" data-n="-1,0">←</button>' +
      '<select class="step" style="padding:2px;font-size:11px"><option>1</option><option selected>10</option><option>50</option></select>' +
      '<button class="btn-sm" data-n="1,0">→</button><span></span><button class="btn-sm" data-n="0,1">↓</button><span></span></div></div>' +
    '<div><div class="note" style="margin:0 0 3px">Snap to</div><div class="presets2">' +
      '<button class="btn-sm" data-p="tl">↖ Top left</button><button class="btn-sm" data-p="tr">Top right ↗</button><br>' +
      '<button class="btn-sm" data-p="bl">↙ Bottom left</button><button class="btn-sm" data-p="br">Bottom right ↘</button><br>' +
      '<button class="btn-sm" data-p="c">Center</button></div></div></div>' +
    '<div class="camrow" style="display:none;background:#21162e;border-radius:10px;padding:8px 10px;margin-bottom:8px">' +
      '<div class="row"><label style="min-width:70px">📷 Camera</label><select class="ccam" style="flex:1"></select></div>' +
      '<div class="row"><label style="min-width:auto"><input type="checkbox" class="cmir"> Mirror (like a mirror)</label>' +
      '<label style="min-width:auto">Shape</label><select class="cshape"><option value="rect">Square corners</option><option value="round">Rounded</option><option value="circle">Circle</option></select></div>' +
      '<div class="row"><label style="min-width:70px">Border</label><input type="color" class="cbor"><input type="number" class="cbw" min="0" max="20" style="width:70px"><span class="note">px (0 = none)</span></div>' +
      '<div class="note" style="margin:0">For a circle, make the width and height the same.</div><div class="note cstat" style="margin:4px 0 0"></div></div>' +
    '<div class="row"><label style="min-width:90px">See-through</label><input type="range" class="op" min="10" max="100" style="flex:1"><span class="opv" style="width:40px"></span></div>' +
    '<div class="row"><label style="min-width:90px">Zoom</label><input type="range" class="zm" min="25" max="300" step="5" style="flex:1"><span class="zmv" style="width:40px"></span></div>' +
    '<div class="row"><label style="min-width:auto"><input type="checkbox" class="ck"> Clickable (I can click/type in it over my game)</label></div>' +
    '<div class="row"><label style="min-width:auto"><input type="checkbox" class="lk"> Keep locked in Move mode (never clickable)</label><span class="spacer"></span><button class="btn-sm btn-danger rm">Remove</button></div>';
  var q = function(s){ return c.querySelector(s); };
  q('.on').onchange = function(){ upd(w.id, { on: this.checked }); };
  q('.name').onchange = function(){ upd(w.id, { name: this.value }); };
  q('.url').onchange = function(){ upd(w.id, { url: this.value }); };
  q('.rl').onclick = function(){ upd(w.id, { reload: true }); };
  ['x', 'y', 'w', 'h'].forEach(function(k){ q('.' + k).onchange = function(){ var o = {}; o[k] = this.value; upd(w.id, o); }; });
  [].forEach.call(c.querySelectorAll('[data-n]'), function(b){ b.onclick = function(){ var n = b.getAttribute('data-n').split(','); nudge(w.id, Number(n[0]), Number(n[1])); }; });
  [].forEach.call(c.querySelectorAll('[data-p]'), function(b){ b.onclick = function(){ preset(w.id, b.getAttribute('data-p')); }; });
  q('.op').oninput = function(){ q('.opv').textContent = this.value + '%'; }; q('.op').onchange = function(){ upd(w.id, { opacity: this.value }); };
  q('.zm').oninput = function(){ q('.zmv').textContent = this.value + '%'; }; q('.zm').onchange = function(){ upd(w.id, { zoom: this.value }); };
  q('.lk').onchange = function(){ upd(w.id, { locked: this.checked }); };
  q('.ck').onchange = function(){ upd(w.id, { clickable: this.checked }); };
  ['.ccam', '.cmir', '.cshape', '.cbor', '.cbw'].forEach(function(k){ q(k).onchange = function(){ camSave(w.id); }; });
  q('.rm').onclick = function(){ removeW(w.id); };
  c.onclick = function(e){ if (sel !== w.id) { sel = w.id; drawMap(); markSel(); } };
  return c;
}
function setVal(el, v){ if (document.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } }
function markSel(){ for (var id in cards) cards[id].className = 'wcard' + (id === sel ? ' sel' : ''); }
function renderList(){
  var list = $('list'), ids = S.widgets.map(function(w){ return w.id; });
  for (var id in cards) if (ids.indexOf(id) < 0) { cards[id].remove(); delete cards[id]; }
  S.widgets.forEach(function(w){
    var c = cards[w.id] || (cards[w.id] = buildCard(w)); if (!c.parentNode) list.appendChild(c);
    var q = function(s){ return c.querySelector(s); };
    setVal(q('.on'), w.on); setVal(q('.name'), w.name); setVal(q('.url'), w.url);
    setVal(q('.x'), w.x); setVal(q('.y'), w.y); setVal(q('.w'), w.w); setVal(q('.h'), w.h);
    setVal(q('.op'), w.opacity); q('.opv').textContent = w.opacity + '%'; setVal(q('.zm'), w.zoom); q('.zmv').textContent = w.zoom + '%';
    setVal(q('.lk'), w.locked);
    setVal(q('.ck'), w.clickable);
    var cr = q('.camrow'); cr.style.display = isCam(w) ? 'block' : 'none';
    if (isCam(w)) {
      var o = camOpts(w.url), cams = (S.app.cams || []).slice(); if (o.cam && cams.indexOf(o.cam) < 0) cams.unshift(o.cam);
      var sig = cams.join('|') + '#' + o.cam, cs = q('.ccam');
      if (cs.getAttribute('data-sig') !== sig && document.activeElement !== cs) {
        cs.innerHTML = '<option value="">Default camera</option>' + cams.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
        cs.value = o.cam; cs.setAttribute('data-sig', sig);
      }
      q('.cstat').textContent = S.app.camStatus ? 'Camera status: ' + S.app.camStatus : (S.app.online ? 'Camera status: waiting for the widget…' : 'Camera status: desktop app not running');
      setVal(q('.cmir'), o.mirror !== '0'); setVal(q('.cshape'), o.shape); setVal(q('.cbor'), '#' + o.border); setVal(q('.cbw'), o.bw);
    }
  });
  if (!S.widgets.length) list.innerHTML = '<div class="empty">No widgets yet - add one on the left.</div>'; else { var e = list.querySelector('.empty'); if (e) e.remove(); }
  markSel();
}
// ---------- screen map ----------
var MAP = { minX:0, minY:0, sc:0.1 };
function drawMap(){
  if (dragging) return;
  var ds = displays(), minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  ds.forEach(function(d){ minX = Math.min(minX, d.x); minY = Math.min(minY, d.y); maxX = Math.max(maxX, d.x + d.w); maxY = Math.max(maxY, d.y + d.h); });
  var map = $('map'), mw = map.clientWidth || 600, sc = mw / (maxX - minX);
  MAP = { minX:minX, minY:minY, sc:sc };
  map.style.height = Math.round((maxY - minY) * sc) + 'px';
  var h = '';
  ds.forEach(function(d, i){ h += '<div class="disp" style="left:' + (d.x - minX) * sc + 'px;top:' + (d.y - minY) * sc + 'px;width:' + d.w * sc + 'px;height:' + d.h * sc + 'px"><span>Screen ' + (i + 1) + (d.primary ? ' (main)' : '') + ' · ' + d.w + '×' + d.h + '</span></div>'; });
  S.widgets.forEach(function(w){
    h += '<div class="wr' + (w.on ? '' : ' off') + (w.id === sel ? ' sel' : '') + '" data-id="' + w.id + '" style="left:' + (w.x - minX) * sc + 'px;top:' + (w.y - minY) * sc + 'px;width:' + Math.max(8, w.w * sc) + 'px;height:' + Math.max(8, w.h * sc) + 'px">' + esc(w.name) + '<div class="rz"></div></div>';
  });
  map.innerHTML = h;
  $('mapNote').textContent = S.app.online ? '' : '(start the desktop app to see your real screens)';
}
document.addEventListener('pointerdown', function(e){
  var r = e.target.closest && e.target.closest('.wr'); if (!r) return;
  var w = W(r.getAttribute('data-id')); sel = w.id; markSel();
  dragging = { el: r, w: w, rz: e.target.className === 'rz', sx: e.clientX, sy: e.clientY, x: w.x, y: w.y, ww: w.w, hh: w.h };
  r.className += ' sel'; r.setPointerCapture(e.pointerId); e.preventDefault();
});
document.addEventListener('pointermove', function(e){
  if (!dragging) return; var d = dragging, dx = (e.clientX - d.sx) / MAP.sc, dy = (e.clientY - d.sy) / MAP.sc;
  if (d.rz) { d.nw = Math.max(60, Math.round(d.ww + dx)); d.nh = Math.max(40, Math.round(d.hh + dy)); d.el.style.width = d.nw * MAP.sc + 'px'; d.el.style.height = d.nh * MAP.sc + 'px'; }
  else { d.nx = Math.round(d.x + dx); d.ny = Math.round(d.y + dy); d.el.style.left = (d.nx - MAP.minX) * MAP.sc + 'px'; d.el.style.top = (d.ny - MAP.minY) * MAP.sc + 'px'; }
});
document.addEventListener('pointerup', function(){
  if (!dragging) return; var d = dragging; dragging = null;
  if (d.rz && d.nw) upd(d.w.id, { w: d.nw, h: d.nh }); else if (!d.rz && d.nx !== undefined) upd(d.w.id, { x: d.nx, y: d.ny }); else drawMap();
});
function render(d){
  S = d;
  $('health').textContent = 'ICB connected'; $('health').className = 'health';
  $('appStatus').textContent = d.app.online ? 'Desktop app: running ✓' + (d.app.version ? ' v' + d.app.version : '') : 'Desktop app: not running'; $('appStatus').className = 'status' + (d.app.online ? ' ok' : '');
  setVal($('move'), d.move); setVal($('hideAll'), d.hideAll); $('moveBox').className = 'big-toggle' + (d.move ? ' on' : '');
  renderList(); drawMap();
}
function load(){ api('/api/desktop').then(render).catch(function(){ $('health').textContent = 'ICB offline'; $('health').className = 'health offline'; }); }
window.onresize = function(){ if (S) drawMap(); };
load(); setInterval(load, 1500);
