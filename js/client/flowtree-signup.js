// ICB Flow Tree Sign-Up overlay (copy of the Poke Bowl Sign-up overlay, 2026-10-20). Meld layer:
//   http://127.0.0.1:8790/flowtree-signup.html
// Plain ES5 (Meld rule). Polls /api/flowtree-signup every 2 s; the countdown ticks every second.
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var seen = {}, first = true, lastKey = '', D = null, skew = 0;
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
  function hexA(hex, a){ var n = parseInt(String(hex).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function fit(){
    var W = window.innerWidth, H = window.innerHeight, w = $('wrap');
    if (!W || !H) return;                      // Meld can report 0x0 while loading
    var s = Math.min(1, W / w.offsetWidth, H / w.offsetHeight);
    w.style.transform = 'scale(' + s + ')'; w.style.webkitTransform = 'scale(' + s + ')';
  }
  function fmt(ms, tz, opts){ try { opts.timeZone = tz; return new Date(ms).toLocaleString('en-US', opts); } catch (e) { return ''; } }
  function abbr(ms, tz){
    try { var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms));
      for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value; } catch (e) {}
    return '';
  }
  function tick(){
    if (!D || !D.event || !D.event.start || !D.showCountdown) { $('cd').style.display = 'none'; return; }
    var left = D.event.start - (new Date().getTime() + skew), t;
    if (left > 0) {
      var s = Math.floor(left / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      t = 'Starts in ' + (d ? d + 'd ' + h + 'h' : h ? h + 'h ' + (m < 10 ? '0' : '') + m + 'm' : m + 'm ' + (sec < 10 ? '0' : '') + sec + 's');
    } else t = left > -3 * 3600000 ? 'Happening now!' : 'Ended';
    $('cd').textContent = t; $('cd').style.display = '';
  }
  function guestHtml(g, wPct, ac, wait){
    var id = D.event.id + ':' + g.name.toLowerCase(), pop = !seen[id] && !first;
    seen.__now[id] = 1;
    return '<div class="g" style="width:' + wPct + '"><div class="gi' + (pop ? ' pop' : '') + (wait ? ' wait' : '') + '" style="' + (pop ? 'border-color:' + ac : '') + '">' +
      '<span class="n" style="background:' + ac + '">' + g.pos + '</span>' + esc(g.name) + '</div></div>';
  }
  function render(d){
    D = d; skew = d.now ? d.now - new Date().getTime() : 0;
    var p = $('panel'), ev = d.event, ac = d.accent || '#ff8fd8';
    p.className = d.visible ? '' : 'hidden';
    p.style.fontSize = d.font + 'px'; p.style.borderColor = ac;
    p.style.background = hexA(d.panelColor || '#1c0e28', (d.panelOpacity === undefined ? 85 : d.panelOpacity) / 100);
    p.style.width = Math.round(d.font * (d.cols > 1 ? 11 * d.cols : 16)) + 'px';
    $('title').textContent = d.title || '';
    $('count').textContent = d.max ? d.total + ' / ' + d.max : d.total + ' signed up'; $('count').style.background = ac;
    $('evname').textContent = ev ? ev.name : '';
    $('desc').textContent = ev && ev.desc ? ev.desc : ''; $('desc').style.display = ev && ev.desc ? '' : 'none';
    // When: her own time big, then the world clocks.
    if (ev && ev.start) {
      $('wmain').textContent = '🕒 ' + fmt(ev.start, ev.tz, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + fmt(ev.start, ev.tz, { hour: 'numeric', minute: '2-digit' }) + ' ' + abbr(ev.start, ev.tz);
      $('when').style.display = '';
      $('cd').style.background = ac;
      var homeDay = fmt(ev.start, ev.tz, { weekday: 'short' }), zh = '';
      if (d.showZones) for (var i = 0; i < d.zones.length; i++) {
        var z = d.zones[i], day = fmt(ev.start, z.tz, { weekday: 'short' });
        zh += '<span class="z"><b>' + esc(z.label) + '</b>' + (day !== homeDay ? day + ' ' : '') + fmt(ev.start, z.tz, { hour: 'numeric', minute: '2-digit' }) + ' ' + esc(abbr(ev.start, z.tz)) + '</span>';
      }
      $('zones').innerHTML = zh; $('zones').style.display = zh ? '' : 'none';
    } else { $('when').style.display = 'none'; $('zones').style.display = 'none'; }
    tick();
    var roles = ev ? ev.roles : [], full = d.max && d.total >= d.max;
    var b = function(t){ return '<b style="background:' + ac + '">' + esc(t) + '</b>'; };
    if (!d.open) $('foot').innerHTML = 'Sign-ups are closed';
    else if (full) $('foot').innerHTML = 'This event is full!';
    else if (roles.length) $('foot').innerHTML = 'Sign up: ' + roles.map(function(r){ return b('!' + r.cmd); }).join(' ') + ' + your ' + esc(ev.game || 'game') + ' name · ' + b('!leave') + ' to drop out';
    else $('foot').innerHTML = 'Type ' + b('!Your' + String(ev && ev.game || 'Palia').replace(/\s+/g, '') + 'Name') + ' to sign up · ' + b('!leave') + ' to drop out';
    var key = JSON.stringify([ev && ev.guests, ev && ev.roles, ev && ev.id, d.cols, ac]);
    if (key !== lastKey) {
      lastKey = key; seen.__now = {};
      var h = '', gs = ev ? ev.guests : [], wPct = (100 / (d.cols || 1)).toFixed(3) + '%', i2, g;
      if (roles.length) {
        var groups = roles.concat(gs.some(function(x){ return !x.role; }) ? [{ id: '', label: 'Other', cmd: '', spots: 0 }] : []);
        for (var r = 0; r < groups.length; r++) {
          var R = groups[r], col = R.color || ac, mine = gs.filter(function(x){ return x.role === R.id; }), main = '', wait = '';
          for (i2 = 0; i2 < mine.length; i2++) {
            g = { name: mine[i2].name, pos: i2 + 1 };
            if (R.spots && i2 >= R.spots) { g.pos = i2 - R.spots + 1; wait += guestHtml(g, wPct, col, true); } else main += guestHtml(g, wPct, col, false);
          }
          var filled = Math.min(mine.length, R.spots || mine.length);
          h += '<div class="role"><div class="rh" style="background:' + hexA(col, .3) + ';border-left:5px solid ' + col + '">' + esc(R.label) +
            ' <span style="opacity:.8">(' + filled + (R.spots ? '/' + R.spots : '') + ')</span>' + (R.cmd ? '<span class="cmd">!' + esc(R.cmd) + '</span>' : '') + '</div>' +
            '<div style="margin:0 -4px">' + (main || '<div class="empty" style="padding:3px;font-size:.7em">Open</div>') + '</div>' +
            (wait ? '<div class="wl">Waitlist</div><div style="margin:0 -4px">' + wait + '</div>' : '') + '</div>';
        }
      } else {
        for (i2 = 0; i2 < gs.length; i2++) h += guestHtml({ name: gs[i2].name, pos: gs[i2].n }, wPct, ac, false);
        h = h ? '<div style="margin:0 -4px">' + h + '</div>' : '';
      }
      seen = seen.__now;
      $('list').innerHTML = h || '<div class="empty">No one yet - be the first!</div>';
      first = false;
    }
    fit();
  }
  function poll(){
    var r = new XMLHttpRequest();
    r.open('GET', '/api/flowtree-signup?_=' + new Date().getTime(), true);
    r.onreadystatechange = function(){
      if (r.readyState !== 4 || r.status !== 200) return;
      try { var d = JSON.parse(r.responseText); if (d && d.ok) render(d); } catch (e) {}
    };
    r.send();
  }
  window.onresize = fit;
  poll(); setInterval(poll, 2000); setInterval(tick, 1000);
})();
