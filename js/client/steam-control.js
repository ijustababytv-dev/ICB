var $ = function(id){ return document.getElementById(id); };
var S = null, filled = false;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function toast(t){ var e = $('toast'); e.textContent = t; e.className = 'toast show'; clearTimeout(e._t); e._t = setTimeout(function(){ e.className = 'toast'; }, 2600); }
function api(path, body){
  return fetch(path, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ return r.json(); }).then(function(d){ if (!d.ok) throw new Error(d.error || 'Failed'); return d; });
}
function cp(v){ try { navigator.clipboard.writeText('http://127.0.0.1:8790/steam.html?view=' + v); toast('Copied'); } catch (e) {} }
function showErr(m){ var e = $('err'); e.style.display = m ? 'block' : 'none'; e.textContent = m || ''; }
function connect(){
  var b = { appId: $('appId').value };
  if ($('apiKey').value.trim()) b.apiKey = $('apiKey').value.trim();
  if ($('steamId').value.trim()) b.steamId = $('steamId').value.trim();
  toast('Saving…');
  api('/api/steam/settings', b).then(function(){ $('apiKey').value = ''; return checkNow(); }).catch(function(e){ showErr(e.message); });
}
function checkNow(){
  toast('Asking Steam…');
  return api('/api/steam/check', {}).then(function(){ showErr(''); toast('Connected to Steam ✓'); filled = false; load(); })
    .catch(function(e){ showErr(e.message); load(); });
}
function saveOpts(){
  api('/api/steam/settings', { progressTitle: $('progressTitle').value, popupSec: Number($('popupSec').value), pollSec: Number($('pollSec').value), showRarity: $('showRarity').checked, enabled: $('enabled').checked })
    .then(function(){ toast('Saved'); load(); }).catch(function(e){ toast('⚠️ ' + e.message); });
}
function saveCard(){
  api('/api/steam/settings', { cardImage: $('cardImage').value || null, cardBox: { left: $('bl').value, top: $('bt').value, width: $('bw').value, height: $('bh').value } })
    .then(function(){ toast('Card saved'); load(); }).catch(function(e){ toast('⚠️ ' + e.message); });
}
function testPop(api_){ api('/api/steam/test-popup', { apiname: api_ }).then(function(){ toast('Pop-up sent to stream'); }).catch(function(e){ toast('⚠️ ' + e.message); }); }
function saveStats(){
  var rows = document.querySelectorAll('.st'), list = [];
  for (var i = 0; i < rows.length; i++) { var c = rows[i].querySelector('input[type=checkbox]'); if (c.checked) list.push({ name: c.getAttribute('data-n'), label: rows[i].querySelector('input[type=text]').value }); }
  api('/api/steam/settings', { pinnedStats: list }).then(function(){ toast('Stats saved'); }).catch(function(e){ toast('⚠️ ' + e.message); });
}
function showThumb(){ var f = $('cardImage').value, im = $('thumb'); if (f) { im.src = '/assets/resources/' + encodeURIComponent(f); im.style.display = 'block'; } else im.style.display = 'none'; }
$('cardImage').addEventListener('change', showThumb);
function ago(ms){ if (!ms) return 'never'; var s = Math.round((Date.now() - ms) / 1000); return s < 60 ? s + 's ago' : Math.round(s / 60) + ' min ago'; }

function fill(){
  $('appId').value = S.appId; $('steamId').placeholder = S.steamId ? 'saved: ' + S.steamId : 'https://steamcommunity.com/id/yourname';
  $('apiKey').placeholder = S.keySet ? 'saved (' + S.keyHint + ') — paste a new one to replace' : 'paste the 32-character key';
  $('progressTitle').value = S.title || ''; $('popupSec').value = S.popupSec; $('pollSec').value = S.pollSec; $('showRarity').checked = S.showRarity; $('enabled').checked = S.enabled;
  var o = '<option value="">(none — use the built-in Progress card)</option>';
  S.art.forEach(function(f){ o += '<option' + (f === S.cardImage ? ' selected' : '') + '>' + esc(f) + '</option>'; });
  $('cardImage').innerHTML = o; showThumb();
  var b = S.cardBox || { left: 25, top: 60, width: 50, height: 25 };
  $('bl').value = b.left; $('bt').value = b.top; $('bw').value = b.width; $('bh').value = b.height;
}
function render(){
  var st = $('status');
  if (!S.configured) { st.textContent = 'not set up'; st.className = 'pill'; }
  else if (S.lastError) { st.textContent = 'Steam problem'; st.className = 'pill bad'; }
  else if (S.lastOk) { st.textContent = 'connected · ' + S.gameName; st.className = 'pill ok'; }
  else { st.textContent = 'checking…'; st.className = 'pill'; }
  if (S.lastError) showErr(S.lastError);
  $('keyNote').textContent = S.configured ? 'Saved profile: ' + S.steamId + ' · key ' + S.keyHint : '';
  $('lastCheck').textContent = '— last checked ' + ago(S.lastPoll);
  $('count').textContent = S.total ? S.unlocked + ' / ' + S.total + ' unlocked' : '— / —';
  var h = '';
  S.achievements.forEach(function(a){
    var when = a.unlocktime ? new Date(a.unlocktime * 1000).toLocaleDateString([], { month:'short', day:'numeric' }) : '';
    h += '<div class="a' + (a.unlocked ? '' : ' locked') + '">' + (a.icon ? '<img src="' + esc(a.icon) + '" alt="">' : '<span></span>') +
      '<div><div class="n">' + esc(a.name) + '</div><div class="d">' + esc(a.desc || (a.hidden ? '(hidden achievement)' : '')) + '</div></div>' +
      '<div class="m">' + (a.unlocked ? '✅ ' + when : '🔒') + (a.rarity !== null ? '<br>' + a.rarity + '% of players' : '') + '<br><button class="btn-sm" onclick="testPop(\'' + esc(a.apiname).replace(/'/g, '') + '\')">Test</button></div></div>';
  });
  $('ach').innerHTML = h || '<div class="note">Connect to Steam to load the achievement list.</div>';
  if (S.statList.length) {
    $('statsCard').style.display = '';
    if (!$('stats').getAttribute('data-filled')) {
      var sh = '';
      S.statList.forEach(function(x){
        var pin = (S.pinnedStats || []).filter(function(p){ return p.name === x.name; })[0];
        sh += '<div class="st"><input type="checkbox" data-n="' + esc(x.name) + '"' + (x.pinned ? ' checked' : '') + '><span>' + esc(x.label) + '</span><b>' + esc(x.value) + '</b><input type="text" maxlength="40" placeholder="name on stream" value="' + esc(pin && pin.label ? pin.label : '') + '"></div>';
      });
      $('stats').innerHTML = sh; $('stats').setAttribute('data-filled', '1');
    }
  }
}
function load(){
  return api('/api/steam/admin').then(function(d){ S = d; if (!filled) { fill(); filled = true; } render(); })
    .catch(function(){ $('status').textContent = 'ICB offline'; $('status').className = 'pill bad'; });
}
load(); setInterval(load, 5000);
