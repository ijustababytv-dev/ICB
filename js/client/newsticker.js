// ICB News Ticker overlay (Baby, 2026-10-08). Meld layer:
//   http://127.0.0.1:8790/newsticker.html
// Make the layer full-screen (the bar sits at the bottom) or a strip as wide as the stream.
// Plain ES5 (Meld rule). Polls /api/newsticker every 2 s; scrolls with requestAnimationFrame.
// One message on screen at a time: it must fully leave before the next one starts.
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var bar = $('bar'), track = $('track'), state = null, x = 0, last = 0, speed = 110;
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
  function hexA(hex, a){ var n = parseInt(String(hex).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }

  // ONE message at a time (2026-10-09): it enters from the right edge, scrolls until it has fully
  // left on the left, the bar stays empty for `gap` seconds, then the next message comes in.
  var items = [], idx = 0, w = 0, phase = 'wait', waitUntil = 0, wasAlert = false;
  function viewW(){ return $('view').offsetWidth || window.innerWidth || 1920; }
  function startNext(){
    if (!items.length) { track.innerHTML = ''; phase = 'wait'; waitUntil = new Date().getTime() + 500; return; }
    idx = idx % items.length;
    track.innerHTML = '<span class="msg">' + esc(items[idx]) + '</span>';
    w = track.firstChild.offsetWidth || 1;
    x = viewW(); phase = 'run';
  }

  function render(d){
    state = d; speed = d.speed || 110;
    var alert = d.alert, h = Math.round(d.font * 1.75);
    bar.className = (d.visible ? '' : 'hidden') + (alert ? ' alert' : '');
    bar.style.height = h + 'px'; bar.style.fontSize = d.font + 'px'; bar.style.color = d.textColor;
    bar.style.background = hexA(d.barColor, (d.barOpacity === undefined ? 88 : d.barOpacity) / 100);
    bar.style.borderTopColor = alert ? alert.color : d.accent;
    var lab = $('label');
    if (alert) { lab.className = ''; lab.textContent = '⚠️ ALERT'; lab.style.background = alert.color; lab.style.color = '#fff'; }
    else { lab.className = d.showLabel && d.label ? '' : 'hide'; lab.textContent = d.label; lab.style.background = d.labelColor; lab.style.color = d.labelText; }
    lab.style.fontSize = Math.round(d.font * 0.9) + 'px';
    items = alert ? [alert.text] : (d.messages || []);
    // An alert starting or stopping takes over right away; message edits apply from the next pass.
    if (!!alert !== wasAlert) { wasAlert = !!alert; idx = 0; waitUntil = 0; startNext(); }
    else if (phase === 'wait' && !waitUntil) startNext();   // first load / nothing showing yet
  }

  function frame(t){
    var dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    if (phase === 'run') {
      x -= speed * dt;
      if (x <= -w) { phase = 'wait'; idx++; track.innerHTML = ''; waitUntil = new Date().getTime() + ((state && state.gap !== undefined ? state.gap : 1) * 1000); }
    } else if (waitUntil && new Date().getTime() >= waitUntil) { waitUntil = 0; startNext(); }
    var v = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
    track.style.transform = v; track.style.webkitTransform = v;
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  function poll(){
    var r = new XMLHttpRequest();
    r.open('GET', '/api/newsticker?_=' + new Date().getTime(), true);
    r.onreadystatechange = function(){
      if (r.readyState !== 4 || r.status !== 200) return;
      try { var d = JSON.parse(r.responseText); if (d && d.ok) render(d); } catch (e) {}
    };
    r.send();
  }
  poll(); setInterval(poll, 2000);
})();
