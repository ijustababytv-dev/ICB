function $(id){ return document.getElementById(id); }
function api(p, b){ return fetch(p, b === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(b) }).then(function(r){ return r.json(); }); }
function post(b){ return api('/api/paliaclock', b).then(function(){ load(); }); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
$('url').value = location.origin + '/palia-clock.html';
function copyUrl(){ $('url').select(); try { navigator.clipboard.writeText($('url').value); } catch(e){ document.execCommand('copy'); } }
function scalePrev(){ $('pf').style.transform = 'scale(' + ($('prev').clientWidth / 1920) + ')'; }
window.addEventListener('resize', scalePrev); scalePrev();
function paliaHours(ms){ var d = new Date(ms), m = d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000; return (((6 + (m - 15) / 2.5) % 24) + 24) % 24; }
function two(n){ return (n < 10 ? '0' : '') + n; }
function fmt(h, m){ var hh = h % 12 === 0 ? 12 : h % 12; return hh + ':' + two(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
var D = null, off = 0, A = [], dirty = false, filled = false, timers = {};
function o1(k, v){ var o = {}; o[k] = v; return o; }
function showVal(k, v){ var s = document.querySelector('[data-v="' + k + '"]'); if (s) s.textContent = v + (s.getAttribute('data-u') || ''); }
[].forEach.call(document.querySelectorAll('[data-s]'), function(el){ var k = el.getAttribute('data-s');
  if (el.type === 'checkbox') el.onchange = function(){ post({ set: o1(k, el.checked) }); };
  else if (el.type === 'range') el.oninput = function(){ showVal(k, el.value); clearTimeout(timers[k]); timers[k] = setTimeout(function(){ post({ set: o1(k, Number(el.value)) }); }, 200); };
  else el.oninput = function(){ clearTimeout(timers[k]); timers[k] = setTimeout(function(){ post({ set: o1(k, el.value) }); }, 300); }; });
[].forEach.call(document.querySelectorAll('[data-l]'), function(el){ var k = el.getAttribute('data-l');
  if (el.type === 'checkbox') el.onchange = function(){ post({ set: { look: o1(k, el.checked) } }); };
  else if (el.type === 'range') el.oninput = function(){ showVal(k, el.value); clearTimeout(timers[k]); timers[k] = setTimeout(function(){ post({ set: { look: o1(k, Number(el.value)) } }); }, 200); };
  else el.onchange = function(){ post({ set: { look: o1(k, el.value) } }); }; });

// alarms
var HOURS = ''; for (var h = 1; h <= 12; h++) HOURS += '<option>' + h + '</option>';
var MINS = ''; for (var m = 0; m < 60; m++) MINS += '<option>' + two(m) + '</option>';
function split(t){ var p = t.split(':'), h = Number(p[0]), mi = Number(p[1]); return { h12: h % 12 === 0 ? 12 : h % 12, m: two(mi), pm: h >= 12 }; }
function join(h12, m, pm){ var h = Number(h12) % 12 + (pm ? 12 : 0); return two(h) + ':' + m; }
function drawAlarms(){
  $('alarms').innerHTML = A.map(function(a, i){ var s = split(a.time);
    return '<div class="al"><label class="sw" title="On/off"><input type="checkbox"' + (a.on ? ' checked' : '') + ' onchange="A[' + i + '].on=this.checked;mark()"><span></span></label>' +
      '<select onchange="setT(' + i + ',this.value,null,null)">' + HOURS.replace('<option>' + s.h12 + '<', '<option selected>' + s.h12 + '<') + '</select>:' +
      '<select onchange="setT(' + i + ',null,this.value,null)">' + MINS.replace('<option>' + s.m + '<', '<option selected>' + s.m + '<') + '</select>' +
      '<select onchange="setT(' + i + ',null,null,this.value===\'PM\')"><option' + (s.pm ? '' : ' selected') + '>AM</option><option' + (s.pm ? ' selected' : '') + '>PM</option></select>' +
      '<input type="text" value="' + esc(a.icon) + '" style="width:48px" oninput="A[' + i + '].icon=this.value;mark()">' +
      '<input type="text" value="' + esc(a.label) + '" placeholder="Message" style="flex:1;min-width:140px" oninput="A[' + i + '].label=this.value;mark()">' +
      '<span class="note">' + (a.once ? 'once' : 'daily') + '</span><span class="in" data-i="' + i + '"></span>' +
      '<button class="btn-sm btn-danger" onclick="A.splice(' + i + ',1);drawAlarms();mark()">✕</button></div>';
  }).join('') || '<div class="note">No alarms yet.</div>';
}
function setT(i, h12, m, pm){ var s = split(A[i].time); A[i].time = join(h12 || s.h12, m || s.m, pm === null ? s.pm : pm); mark(); }
function mark(){ dirty = true; $('aNote').textContent = 'Not saved yet'; }
function addAlarm(t, label, icon){ A.push({ id:'', time: t || '06:00', label: label || '', icon: icon || '⏰', on: true, once: false }); drawAlarms(); mark(); }
function saveAlarms(){ api('/api/paliaclock', { alarms: A }).then(function(){ dirty = false; $('aNote').textContent = 'Saved ✓'; load(); }); }
function quick(){ var h = Number($('qh').value) || 1; post({ inHours: { hours: h, label: $('ql').value } }); $('qNote').textContent = 'Rings in ' + (h * 2.5) + ' real minutes.'; $('ql').value = ''; }

function tickNow(){
  var now = Date.now() + off, ph = paliaHours(now), h = Math.floor(ph), m = Math.floor((ph % 1) * 60);
  $('now').textContent = fmt(h, m);
  $('nowSub').textContent = (ph >= 6 && ph < 18 ? '☀️ Daytime' : '🌙 Night') + ' · real time ' + new Date(now).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', second:'2-digit' });
  [].forEach.call(document.querySelectorAll('.in'), function(el){ var a = A[Number(el.getAttribute('data-i'))]; if (!a) return;
    var p = a.time.split(':'), dh = ((Number(p[0]) + Number(p[1]) / 60) - ph + 24) % 24, secs = Math.ceil(dh * 150), at = new Date(now + secs * 1000);
    el.textContent = 'next in ' + Math.floor(secs / 60) + ':' + two(secs % 60) + ' (' + at.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) + ' real)'; });
}
setInterval(tickNow, 500);
function load(){
  return api('/api/paliaclock').then(function(d){
    D = d; off = d.now - Date.now(); $('health').textContent = 'ICB connected'; $('health').className = 'health';
    [].forEach.call(document.querySelectorAll('[data-s]'), function(el){ var k = el.getAttribute('data-s'); if (el === document.activeElement) return; if (el.type === 'checkbox') el.checked = !!d[k]; else if (!filled) { el.value = d[k]; if (el.type === 'range') showVal(k, d[k]); } });
    [].forEach.call(document.querySelectorAll('[data-l]'), function(el){ var k = el.getAttribute('data-l'); if (el === document.activeElement) return; if (el.type === 'checkbox') el.checked = !!d.look[k]; else if (!filled) { el.value = d.look[k]; if (el.type === 'range') showVal(k, d.look[k]); } });
    filled = true;
    if (!dirty) { A = JSON.parse(JSON.stringify(d.alarms)); drawAlarms(); }
  }).catch(function(){ $('health').textContent = 'ICB offline — run restart-icb-clean.bat'; $('health').className = 'health offline'; });
}
load(); setInterval(load, 4000);
