// Aniimo Dex quick checker (Baby, 2026-10-14) - small panel for a clickable Desktop Widget over the game.
var S = null, EL = { Fire: '#ff7a45', Water: '#4aa8ff', Grass: '#5fd068', Electric: '#ffd84a', Ice: '#8fe3ff', Rock: '#c49a6c', Wind: '#a8f0d0', Dark: '#a77bff', Holy: '#fff2a8' };
var $ = function(id){ return document.getElementById(id); };
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function col(e){ return EL[String(e || '').split('/')[0].replace(/\s/g, '')] || '#7dd3fc'; }
function draw(){
  if (!S) return;
  $('pct').textContent = S.stats.pct + '%';
  var q = $('q').value.trim().toLowerCase(), list;
  if (!q) list = S.recent.slice(0, 3).map(function(r){ return S.roster.filter(function(a){ return a.id === r.id; })[0]; }).filter(Boolean)
    .filter(function(a, i, arr){ return arr.indexOf(a) === i; });
  else list = S.roster.filter(function(a){ return a.name.toLowerCase().indexOf(q) >= 0 || a.number.replace(/^0+/, '') === q.replace(/^0+/, ''); })
    .sort(function(x, y){ return (x.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (y.name.toLowerCase().indexOf(q) === 0 ? 0 : 1); }).slice(0, 4);
  $('res').innerHTML = list.length ? list.map(function(a){
    var n = a.variants.filter(function(v){ return S.checked[a.id + '|' + v]; }).length;
    return '<div class="a" style="--c:' + col(a.element) + '">' + (a.img ? '<img src="' + esc(a.img) + '" alt="">' : '') + '<span class="n">' + esc(a.name) + '</span><span class="m">No. ' + esc(a.number) + ' · ' + n + '/' + a.variants.length + '</span><br>' +
      a.variants.map(function(v){ var fi = (a.formImgs || {})[v], isLast = last && last.id === a.id && last.v === v;
        return '<span class="v' + (S.checked[a.id + '|' + v] ? ' on' : '') + (isLast ? ' last' : '') + '" data-id="' + esc(a.id) + '" data-v="' + esc(v) + '">' + (fi ? '<img src="' + esc(fi) + '" alt="">' : '') + esc(v) + '</span>'; }).join('') + '</div>';
  }).join('') : '<div class="empty">' + (q ? 'No Aniimo matches "' + esc(q) + '"' : 'Search for an Aniimo to tick its forms.') + '</div>';
  $('recent').textContent = S.recent.length ? 'Latest: ' + S.recent.slice(0, 3).map(function(r){ return r.name + ' (' + r.variant + ')'; }).join(' · ') : '';
}
// After ticking a form, a snip pasted with Ctrl+V becomes that form's photo (2026-10-14).
var last = null;
function hint(){ var h = $('hint'); if (last) { h.style.display = 'block'; h.textContent = '📋 Ctrl+V now adds a snip as the photo for ' + last.name + ' — ' + last.v; } else h.style.display = 'none'; }
function prepPic(file){
  return new Promise(function(ok, fail){
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function(){
      var c = document.createElement('canvas'), w = img.naturalWidth, h = img.naturalHeight; c.width = w; c.height = h;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      var px = x.getImageData(0, 0, w, h).data, minX = w, minY = h, maxX = -1, maxY = -1;
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) if (px[(yy * w + xx) * 4 + 3] > 8) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
      if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
      var cw = maxX - minX + 1, ch = maxY - minY + 1, sc = Math.min(1, 512 / Math.max(cw, ch));
      var o = document.createElement('canvas'); o.width = Math.round(cw * sc); o.height = Math.round(ch * sc);
      o.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, o.width, o.height);
      URL.revokeObjectURL(u); ok(o.toDataURL('image/webp', 0.92));
    };
    img.onerror = function(){ URL.revokeObjectURL(u); fail(); };
    img.src = u;
  });
}
document.addEventListener('paste', function(e){
  if (!last) return;
  var it = [].slice.call((e.clipboardData || {}).items || []).filter(function(i){ return i.type.indexOf('image') === 0; })[0];
  if (!it) return; e.preventDefault();
  var target = last;
  prepPic(it.getAsFile()).then(function(d){ return fetch('/api/aniimo/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id, variant: target.v, dataUrl: d, tick: true }) }); })
    .then(function(){ $('hint').textContent = '✅ Photo saved for ' + target.name + ' — ' + target.v; return load(); }).catch(function(){});
});
document.addEventListener('click', function(e){
  var t = e.target; if (t.tagName === 'IMG' && t.parentNode.classList.contains('v')) t = t.parentNode;
  if (!t.classList || !t.classList.contains('v')) return;
  var on = !t.classList.contains('on'); t.classList.toggle('on');
  var aa = S.roster.filter(function(x){ return x.id === t.getAttribute('data-id'); })[0];
  last = on ? { id: t.getAttribute('data-id'), v: t.getAttribute('data-v'), name: aa ? aa.name : '' } : null; hint();
  fetch('/api/aniimo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: { id: t.getAttribute('data-id'), variant: t.getAttribute('data-v'), on: on } }) }).then(load);
});
$('q').addEventListener('input', draw);
$('q').addEventListener('keydown', function(e){ if (e.key === 'Escape') { $('q').value = ''; draw(); } });
function load(){ return fetch('/api/aniimo/admin?_=' + Date.now()).then(function(r){ return r.json(); }).then(function(d){ S = d; draw(); }).catch(function(){}); }
load(); setInterval(load, 3000);
