function $(id){ return document.getElementById(id); }
function api(p, b){ return fetch(p, b === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(b) }).then(function(r){ return r.json(); }); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
$('url').value = location.origin + '/sprite-jar.html';
function copyUrl(){ $('url').select(); try { navigator.clipboard.writeText($('url').value); } catch(e){ document.execCommand('copy'); } }
function scalePrev(){ var w = $('prev').clientWidth; $('pf').style.transform = 'scale(' + (w / 1920) + ')'; }
window.addEventListener('resize', scalePrev); scalePrev();

var D = null, filled = false, timers = {};
function save(k, v){ var o = {}; o[k] = v; clearTimeout(timers[k]); timers[k] = setTimeout(function(){ api('/api/sprites/jar', o); }, 200); }
function showVal(k, v){ var s = document.querySelector('[data-v="' + k + '"]'); if (s) s.textContent = v + (s.getAttribute('data-u') || ''); }
[].forEach.call(document.querySelectorAll('[data-k]'), function(el){
  var k = el.getAttribute('data-k');
  if (el.type === 'checkbox') el.onchange = function(){ save(k, el.checked); };
  else if (el.type === 'range') el.oninput = function(){ showVal(k, el.value); save(k, Number(el.value)); };
  else el.oninput = function(){ save(k, el.value); };
});
function boxes(){ var f = $('modeSel').value === 'floor'; $('floorBox').style.display = f ? '' : 'none'; $('jarBox').style.display = f ? 'none' : ''; var p = $('bookStyleSel').value === 'propped'; $('propBox').style.display = p ? '' : 'none'; $('popBox').style.display = p ? 'none' : ''; }
$('bookStyleSel').addEventListener('change', boxes);
$('modeSel').addEventListener('change', boxes);
function fill(s){
  [].forEach.call(document.querySelectorAll('[data-k]'), function(el){
    var k = el.getAttribute('data-k'); if (s[k] === undefined) return;
    if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k];
    if (el.type === 'range') showVal(k, s[k]);
  });
}
function load(){
  return api('/api/sprites/jar').then(function(d){
    D = d; $('health').textContent = 'ICB connected'; $('health').className = 'health';
    if (!filled) {
      fill(d.settings); filled = true; boxes();
      $('pageSel').innerHTML = '<option value="">Turn to…</option>' + d.sprites.map(function(s){ return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
      $('tS').innerHTML = d.sprites.map(function(s){ return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join(''); fillVars();
    }
    D.open = !!d.settings.bookOpen;
    $('openBtn').textContent = D.open ? '📕 Close the book' : '📖 Open the book';
    $('openNote').textContent = d.settings.bookStyle === 'propped' ? (D.open ? 'Open on stream' : 'Closed on the floor') : 'Only for the propped book';
    $('jarPic').src = d.settings.jarUrl || d.settings.jarBack;
    var have = 0, tot = 0, chips = [];
    d.sprites.forEach(function(sp){ var n = Object.keys(sp.art || {}).length; have += n; tot += sp.variants.length; if (n) chips.push('<span class="note" style="background:#121219;border:1px solid var(--line);border-radius:99px;padding:2px 9px;color:' + (n === sp.variants.length ? 'var(--good)' : 'var(--text)') + '">' + esc(sp.name) + ' ' + n + '/' + sp.variants.length + '</span>'); });
    $('artCount').textContent = have + ' of ' + tot + ' stickers have art';
    $('artList').innerHTML = chips.join('');
    $('artMaking').textContent = d.needArt && d.needArt.length ? 'Getting ' + d.needArt.length + ' new sticker' + (d.needArt.length === 1 ? '' : 's') + ' ready…' : '';
    makeStickers(d.needArt || []);
    $('jarNote').textContent = d.settings.jarUrl ? 'Using your uploaded jar picture.' : 'Using your unicorn jar (JAR_BACK + JAR_FRONT).';
    $('jarReset').style.display = d.settings.jarUrl ? '' : 'none';
  }).catch(function(){ $('health').textContent = 'ICB offline — run restart-icb-clean.bat'; $('health').className = 'health offline'; });
}
function fillVars(){ var s = D.sprites.filter(function(x){ return x.id === $('tS').value; })[0]; $('tV').innerHTML = (s ? s.variants : []).map(function(v){ return '<option>' + esc(v) + '</option>'; }).join(''); }
function playTest(){ if (!D || !D.sprites.length) return; api('/api/sprites/jar', { play: { id: $('tS').value || D.sprites[0].id, variant: $('tV').value } }); }
function catchIt(){ var c = $('cmd').value.trim(); if (!c) return; api('/api/sprites/jar', { catchCmd: c }).then(function(r){ if (r.ok === false) alert(r.error); else $('cmd').value = ''; }); }
$('jf').onchange = function(e){
  var f = e.target.files[0]; e.target.value = ''; if (!f) return;
  var r = new FileReader(); r.onload = function(){ api('/api/sprites/jar/image', { dataUrl: r.result }).then(function(x){ if (x.ok === false) alert(x.error); load(); }); }; r.readAsDataURL(f);
};
var making = false;
function makeStickers(need){
  if (making || !need.length) return; making = true;
  var job = need[0], img = new Image(), done = function(){ making = false; setTimeout(load, 200); };
  img.onload = function(){
    try {
      var w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      var px = x.getImageData(0, 0, w, h).data, a = w, b = h, cc = -1, dd = -1;
      for (var yy = 0; yy < h; yy += 2) for (var xx = 0; xx < w; xx += 2) if (px[(yy * w + xx) * 4 + 3] > 8) { if (xx < a) a = xx; if (xx > cc) cc = xx; if (yy < b) b = yy; if (yy > dd) dd = yy; }
      if (cc < 0) { a = 0; b = 0; cc = w - 1; dd = h - 1; }
      a = Math.max(0, a - 2); b = Math.max(0, b - 2); cc = Math.min(w - 1, cc + 2); dd = Math.min(h - 1, dd + 2);
      var cw = cc - a + 1, ch = dd - b + 1, sc = Math.min(1, 256 / Math.max(cw, ch)), o = document.createElement('canvas');
      o.width = Math.round(cw * sc); o.height = Math.round(ch * sc);
      var ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, a, b, cw, ch, 0, 0, o.width, o.height);
      api('/api/sprites/jar/sticker', { id: job.id, variant: job.variant, dataUrl: o.toDataURL('image/webp', 0.9) }).then(done, done);
    } catch (e) { done(); }
  };
  img.onerror = done; img.src = job.src;
}
function toggleOpen(){ api('/api/sprites/jar', { bookOpen: !D.open }).then(load); }
load(); setInterval(load, 5000);
