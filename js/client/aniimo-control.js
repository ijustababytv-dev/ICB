var S = null, $ = function(id){ return document.getElementById(id); }, rosterSig = '', editing = null;
var EL = { Fire: '#ff7a45', Water: '#4aa8ff', Grass: '#5fd068', Electric: '#ffd84a', Ice: '#8fe3ff', Rock: '#c49a6c', Wind: '#a8f0d0', Dark: '#a77bff', Holy: '#fff2a8' };
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function api(path, body){ return fetch(path, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }).then(function(r){ return r.json(); }); }
function set(o){ return api('/api/aniimo', o).then(load); }
function cp(p){ navigator.clipboard.writeText('http://127.0.0.1:8790' + p); }
function key(a, v){ return a.id + '|' + v; }
function elColor(e){ return EL[String(e || '').split('/')[0].replace(/\s/g, '')] || '#7dd3fc'; }
function haveN(a){ return a.variants.filter(function(v){ return S.checked[key(a, v)]; }).length; }
function A(id){ return S.roster.filter(function(a){ return a.id === id; })[0]; }
// ---------- checklist: built once per roster change, then updated in place ----------
function build(){
  var list = $('list'), open = {};
  [].forEach.call(list.querySelectorAll('details[open]'), function(d){ open[d.getAttribute('data-id')] = 1; });
  list.innerHTML = '';
  S.roster.forEach(function(a){
    var d = document.createElement('details'); d.className = 'cr'; d.setAttribute('data-id', a.id); d.style.setProperty('--c', elColor(a.element)); if (open[a.id]) d.open = true;
    d.innerHTML = '<summary><div style="display:flex;gap:10px;align-items:center">' + thumb(a, '') + '<div><div class="nm">' + esc(a.name) + '</div><div class="meta">No. ' + esc(a.number) + ' · ' + esc(a.element) + '</div></div></div><div class="tag"></div></summary>' +
      '<div class="checks">' + a.variants.map(function(v){ var fi = (a.formImgs || {})[v];
        return '<label data-v="' + esc(v) + '"><input type="checkbox"><span class="vt">' + esc(v) + '</span><button class="cam' + (fi ? ' has' : '') + '" title="Photo of this form">' + (fi ? '<img src="' + esc(fi) + '" alt="">' : '📷') + '</button></label>'; }).join('') + '</div>' +
      '<div class="acts"><button class="btn-sm" data-act="all">✓ Tick all</button><button class="btn-sm" data-act="none">Untick all</button><button class="btn-sm" data-act="show">📺 Show on stream</button><button class="btn-sm" data-act="edit">✏️ Edit</button></div>';
    [].forEach.call(d.querySelectorAll('label[data-v]'), function(l){
      var v = l.getAttribute('data-v');
      l.querySelector('input').onchange = function(){ set({ check: { id: a.id, variant: v, on: this.checked } }); };
      l.querySelector('.cam').onclick = function(e){ e.preventDefault(); e.stopPropagation(); openForm(a.id, v); };
      // Drop a photo onto a form to attach it (and tick that form).
      l.addEventListener('dragover', function(e){ e.preventDefault(); e.stopPropagation(); l.classList.add('drop'); });
      l.addEventListener('dragleave', function(){ l.classList.remove('drop'); });
      l.addEventListener('drop', function(e){ e.preventDefault(); e.stopPropagation(); l.classList.remove('drop'); var f = e.dataTransfer.files[0]; if (f) uploadForm(a.id, v, f, true); });
    });
    d.querySelector('[data-act=all]').onclick = function(){ set({ checkAll: { id: a.id, on: true } }); };
    d.querySelector('[data-act=none]').onclick = function(){ if (confirm('Untick everything for ' + a.name + '?')) set({ checkAll: { id: a.id, on: false } }); };
    d.querySelector('[data-act=show]').onclick = function(){ set({ lookup: a.number || a.name }); };
    d.querySelector('[data-act=edit]').onclick = function(){ editA(a.id); };
    // Drop a picture file straight onto a card to set that Aniimo's picture.
    d.addEventListener('dragover', function(e){ e.preventDefault(); d.classList.add('drop'); });
    d.addEventListener('dragleave', function(){ d.classList.remove('drop'); });
    d.addEventListener('drop', function(e){ e.preventDefault(); d.classList.remove('drop'); var f = e.dataTransfer.files[0]; if (f) uploadPic(a.id, f); });
    list.appendChild(d);
  });
}
function refresh(){
  var q = $('q').value.trim().toLowerCase(), el = $('el').value, view = $('view').value, shown = 0;
  S.roster.forEach(function(a){
    var d = $('list').querySelector('details[data-id="' + a.id + '"]'); if (!d) return;
    var n = haveN(a), full = n === a.variants.length, caught = !!S.checked[key(a, 'Basic Form')];
    [].forEach.call(d.querySelectorAll('label[data-v]'), function(l){ var on = !!S.checked[key(a, l.getAttribute('data-v'))]; l.querySelector('input').checked = on; l.className = on ? 'done' : ''; });
    d.querySelector('.tag').textContent = n + '/' + a.variants.length + (full ? ' 🏆' : '');
    d.className = 'cr' + (full ? ' full' : '');
    var ok = (!q || a.name.toLowerCase().indexOf(q) >= 0 || a.number.indexOf(q) >= 0) && (!el || a.element.split(/\s*\/\s*/).indexOf(el) >= 0) &&
      (view === 'all' || (view === 'full' ? full : view === 'missing' ? !full : !caught));
    d.style.display = ok ? '' : 'none'; if (ok) shown++;
  });
  $('shown').textContent = 'Showing ' + shown + ' of ' + S.roster.length + ' Aniimo';
}
['q', 'el', 'view'].forEach(function(id){ $(id).addEventListener('input', refresh); });
function expandAll(){ var ds = [].slice.call($('list').querySelectorAll('details')).filter(function(d){ return d.style.display !== 'none'; }); var o = ds.some(function(d){ return !d.open; }); ds.forEach(function(d){ d.open = o; }); $('expand').textContent = o ? 'Collapse all' : 'Expand all'; }
// ---------- pictures ----------
function thumb(a, cls){ return '<div class="th ' + cls + '" style="' + (a.img ? '' : 'background:' + elColor(a.element)) + '">' + (a.img ? '<img src="' + esc(a.img) + '" alt="">' : esc((a.name || '?').charAt(0))) + '</div>'; }
// Trim see-through edges, shrink to max 512 px, save as WEBP (keeps transparency, small file).
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
      var ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, minX, minY, cw, ch, 0, 0, o.width, o.height);
      URL.revokeObjectURL(u); ok(o.toDataURL('image/webp', 0.92));
    };
    img.onerror = function(){ URL.revokeObjectURL(u); fail(new Error('That file is not a picture.')); };
    img.src = u;
  });
}
function uploadPic(id, file){
  return prepPic(file).then(function(dataUrl){ return api('/api/aniimo/image', { id: id, dataUrl: dataUrl }); })
    .then(function(r){ if (r.ok === false) alert(r.error); return load().then(function(){ if (editing === id) showPic(); }); })
    .catch(function(e){ alert(e.message || 'Upload failed'); });
}
function showPic(){ var a = A(editing); $('mPic').outerHTML = a ? thumb(a, 'big').replace('class="th big"', 'id="mPic" class="th big"') : '<div id="mPic" class="th big">?</div>'; $('mRemove').style.display = a && a.img ? '' : 'none'; }
function removePic(){ if (editing && confirm('Remove this picture?')) api('/api/aniimo/image', { id: editing, remove: true }).then(load).then(showPic); }
// ---------- photos of single forms (caught / hatched) ----------
var formEd = null;   // { id, v }
function uploadForm(id, v, file, tick){
  return prepPic(file).then(function(dataUrl){ return api('/api/aniimo/image', { id: id, variant: v, dataUrl: dataUrl, tick: !!tick }); })
    .then(function(r){ if (r.ok === false) alert(r.error); return load().then(function(){ if (formEd && formEd.id === id && formEd.v === v) drawForm(); }); })
    .catch(function(e){ alert(e.message || 'Upload failed'); });
}
function openForm(id, v){ formEd = { id: id, v: v }; drawForm(); $('fmodal').className = 'modal on'; }
function closeForm(){ $('fmodal').className = 'modal'; formEd = null; }
function drawForm(){
  var a = A(formEd.id), u = (a.formImgs || {})[formEd.v];
  $('fTitle').textContent = a.name + ' — ' + formEd.v;
  $('fBig').innerHTML = u ? '<img src="' + esc(u) + '" alt="">' : '📷';
  $('fRemove').style.display = u ? '' : 'none'; $('fMain').style.display = u ? '' : 'none';
  $('fState').textContent = S.checked[key(a, formEd.v)] ? '✅ Ticked' : 'Not ticked yet';
}
function removeForm(){ if (confirm('Remove this photo?')) api('/api/aniimo/image', { id: formEd.id, variant: formEd.v, remove: true }).then(load).then(drawForm); }
function formAsMain(){
  var a = A(formEd.id), u = (a.formImgs || {})[formEd.v]; if (!u) return;
  fetch(u).then(function(r){ return r.blob(); }).then(function(b){ return uploadPic(formEd.id, b); }).then(function(){ alert('Now the main picture for ' + a.name + '.'); });
}
// Paste a snip (Win+Shift+S): into the form-photo window, or the Aniimo's edit window.
document.addEventListener('paste', function(e){
  if (formEd && $('fmodal').className === 'modal on') {
    var it2 = [].slice.call((e.clipboardData || {}).items || []).filter(function(i){ return i.type.indexOf('image') === 0; })[0];
    if (it2) { e.preventDefault(); uploadForm(formEd.id, formEd.v, it2.getAsFile(), $('fTick').checked); }
    return;
  }
  if (!editing || $('modal').className !== 'modal on') return;
  var it = [].slice.call((e.clipboardData || {}).items || []).filter(function(i){ return i.type.indexOf('image') === 0; })[0];
  if (it) { e.preventDefault(); uploadPic(editing, it.getAsFile()); }
});
// ---------- roster editor ----------
function editA(id){
  editing = id; var a = id ? A(id) : { name: '', number: '', element: '', variants: ['Basic Form', 'Prismana (rare)', 'Sparkling mutation', 'Alpha mutation', 'Mini mutation', 'Umbral variant'] };
  $('mTitle').textContent = id ? 'Edit ' + a.name : 'Add an Aniimo';
  $('mName').value = a.name; $('mNum').value = a.number; $('mEl').value = a.element; $('mVars').value = a.variants.join('\n');
  $('mDel').style.display = id ? '' : 'none'; $('modal').className = 'modal on'; $('mName').focus();
  $('picBox').style.display = id ? '' : 'none'; $('picNew').style.display = id ? 'none' : ''; if (id) showPic();
}
function closeM(){ $('modal').className = 'modal'; }
function saveA(){
  var b = { id: editing || '', name: $('mName').value, number: $('mNum').value, element: $('mEl').value, variants: $('mVars').value.split(/\r?\n/) };
  if (editing) { var a = A(editing), gone = a.variants.filter(function(v){ return b.variants.map(function(x){ return x.trim(); }).indexOf(v) < 0 && S.checked[key(a, v)]; });
    if (gone.length && !confirm('These ticked forms will be removed: ' + gone.join(', ') + '. Continue?')) return; }
  api('/api/aniimo', { saveAniimo: b }).then(function(r){ if (r.ok === false) alert(r.error); else { closeM(); load(); } });
}
function delA(){ var a = A(editing); if (confirm('Remove ' + a.name + ' and its ticks from the list?')) set({ removeAniimo: editing }).then(closeM); }
function addFormAll(){ var v = $('formAll').value.trim(); if (v && confirm('Add "' + v + '" to all ' + S.roster.length + ' Aniimo?')) set({ addFormAll: v }).then(function(){ $('formAll').value = ''; }); }
function renameForm(){ var f = $('rnFrom').value.trim(), t = $('rnTo').value.trim(); if (f && t) set({ renameForm: { from: f, to: t } }).then(function(){ $('rnFrom').value = ''; $('rnTo').value = ''; }); }
// ---------- backup ----------
$('imp').onchange = function(e){
  var f = e.target.files[0]; if (!f) return;
  f.text().then(function(t){ var d = JSON.parse(t); return api('/api/aniimo', { import: d }); }).then(function(r){ alert(r.ok ? 'Imported ' + r.imported + ' new checks.' : (r.error || 'Import failed')); load(); })
   .catch(function(){ alert('That file could not be imported.'); });
  e.target.value = '';
};
function csv(){
  var rows = [['Caught', 'Number', 'Aniimo', 'Element', 'Form / Special']];
  S.roster.forEach(function(a){ a.variants.forEach(function(v){ rows.push([S.checked[key(a, v)] ? 'Yes' : 'No', a.number, a.name, a.element, v]); }); });
  var blob = new Blob([rows.map(function(r){ return r.map(function(x){ return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n')], { type: 'text/csv' });
  var u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = 'aniimo-checklist.csv'; document.body.appendChild(l); l.click(); l.remove();
}
function resetAll(){ if (confirm('Untick EVERYTHING? (Download a backup first if you might want it back.)') && confirm('Really reset all checks?')) set({ resetChecks: 'yes' }); }
// ---------- load ----------
function load(){
  return api('/api/aniimo/admin').then(function(d){
    S = d; $('health').textContent = 'ICB connected'; $('health').className = 'health';
    var st = d.stats;
    $('pct').textContent = st.pct + '%'; $('done').textContent = st.done + ' / ' + st.total; $('basic').textContent = st.basic + ' / ' + st.species; $('full').textContent = st.full; $('pbar').style.width = st.pct + '%';
    $('recent').innerHTML = d.recent.length ? d.recent.map(function(r){ return '<div>✅ <b>' + esc(r.name) + '</b> · ' + esc(r.variant) + ' <span class="note">' + new Date(r.at).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) + '</span></div>'; }).join('') : '<div class="empty">Nothing checked yet.</div>';
    if ($('el').options.length < 2) d.elements.forEach(function(e){ var o = document.createElement('option'); o.value = o.textContent = e; $('el').appendChild(o); });
    $('elList').innerHTML = d.elements.map(function(e){ return '<option value="' + e + '">'; }).join('');
    var forms = {}; d.roster.forEach(function(a){ a.variants.forEach(function(v){ forms[v] = 1; }); });
    $('formList').innerHTML = Object.keys(forms).sort().map(function(v){ return '<option value="' + esc(v) + '">'; }).join('');
    var sig = JSON.stringify(d.roster); if (sig !== rosterSig) { rosterSig = sig; build(); }
    refresh();
    ['visible', 'chat', 'showElements'].forEach(function(k){ $(k).checked = !!d[k]; });
    ['title', 'popupSec', 'lookupSec', 'accent', 'panelColor', 'panelOpacity'].forEach(function(k){ if (document.activeElement !== $(k)) $(k).value = d[k]; });
  }).catch(function(){ $('health').textContent = 'ICB offline'; $('health').className = 'health offline'; });
}
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') { closeM(); closeForm(); } });
$('fFile').onchange = function(e){ var f = e.target.files[0]; if (f && formEd) uploadForm(formEd.id, formEd.v, f, $('fTick').checked); e.target.value = ''; };
$('fmodal').addEventListener('dragover', function(e){ e.preventDefault(); });
$('fmodal').addEventListener('drop', function(e){ e.preventDefault(); var f = e.dataTransfer.files[0]; if (f && formEd) uploadForm(formEd.id, formEd.v, f, $('fTick').checked); });
$('picFile').onchange = function(e){ var f = e.target.files[0]; if (f && editing) uploadPic(editing, f); e.target.value = ''; };
$('modal').addEventListener('dragover', function(e){ e.preventDefault(); });
$('modal').addEventListener('drop', function(e){ e.preventDefault(); var f = e.dataTransfer.files[0]; if (f && editing) uploadPic(editing, f); });
load(); setInterval(load, 3000);
