(function () {
  var id = (/[?&]id=([^&]+)/.exec(location.search) || [])[1] || 'main';
  var C = null, off = 0, lastDoneAt = 0, sparked = false;
  function $(x) { return document.getElementById(x); }
  function hex(h, a) { var n = parseInt(h.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function light(h) { var n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return 'rgb(' + Math.round(r + (255 - r) * .55) + ',' + Math.round(g + (255 - g) * .55) + ',' + Math.round(b + (255 - b) * .55) + ')'; }
  var GOLD = { flowtree: '#fde047', spooky: '#ffb24d', pink: '#fff1a8', gold: '#fff3c4', fortnite: '#ffe14d', glass: '#e0f2fe', custom: '#fde047' };
  function two(n) { n = Math.max(0, Math.floor(n)); return n < 10 ? '0' + n : '' + n; }
  function apply() {
    var c = C, card = $('card'), st = card.style, a3 = GOLD[c.theme] || '#fde047';
    st.setProperty('--a1', c.accent1); st.setProperty('--a2', c.accent2); st.setProperty('--a3', a3);
    st.setProperty('--a1s', hex(c.accent1, .16)); st.setProperty('--a2s', hex(c.accent2, .22));
    st.setProperty('--a1g', hex(c.accent1, .5)); st.setProperty('--a2g', hex(c.accent2, .45)); st.setProperty('--a3g', hex(a3, .5));
    st.setProperty('--a1h', hex(c.accent1, .45)); st.setProperty('--a2h', hex(c.accent2, .55)); st.setProperty('--a1l', light(c.accent1));
    st.setProperty('--text', c.textColor); st.setProperty('--plate', hex(c.plate, c.plateAlpha / 100));
    card.style.fontFamily = "'" + c.font + "', 'Outfit', sans-serif";
    $('head').textContent = c.heading; $('sub').textContent = c.subheading; $('icon').textContent = c.icon || '';
    $('badge').style.display = c.showBadge && (c.heading || c.icon) ? '' : 'none';
    $('sub').style.display = c.showSub && c.subheading ? '' : 'none';
    $('dot').style.display = c.pulseDot ? '' : 'none'; $('icon').style.display = c.icon ? '' : 'none';
    $('lh').textContent = c.labelH; $('lm').textContent = c.labelM; $('ls').textContent = c.labelS;
    var lb = document.querySelectorAll('.lbl'); for (var i = 0; i < lb.length; i++) lb[i].style.display = c.showLabels ? '' : 'none';
    $('endBig').textContent = c.endText; $('endSmall').textContent = c.endSub; $('endSmall').style.display = c.endSub ? '' : 'none';
    fit();
  }
  function fit() {
    if (!C) return; var W = window.innerWidth, H = window.innerHeight; if (!W || !H) return;
    var k = H / 1080 * C.scale / 100, w = $('wrap');
    $('card').style.fontSize = (16 * k) + 'px';
    w.style.left = (W * C.x / 100) + 'px'; w.style.top = (H * C.y / 100) + 'px';
    w.style.transform = w.style.webkitTransform = 'translate(-50%,-50%)';
  }
  window.onresize = fit;
  function sparkle() {
    var card = $('card'), ch = ['✦', '✧', '★', '♥', '✨'], cw = card.offsetWidth, chh = card.offsetHeight;
    for (var i = 0; i < 22; i++) (function (i) {
      var e = document.createElement('span'); e.className = 'spark'; e.textContent = ch[i % ch.length];
      e.style.left = (cw / 2) + 'px'; e.style.top = (chh / 2) + 'px'; e.style.color = [C.accent1, C.accent2, GOLD[C.theme] || '#fde047', '#fff'][i % 4];
      card.appendChild(e);
      setTimeout(function () { var a = Math.random() * Math.PI * 2, d = cw * (.25 + Math.random() * .4); e.style.left = (cw / 2 + Math.cos(a) * d) + 'px'; e.style.top = (chh / 2 + Math.sin(a) * d * .6) + 'px'; e.style.opacity = '0'; }, 30);
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 1600);
    })(i);
  }
  function tick() {
    if (!C) return;
    var c = C, card = $('card'), now = Date.now() + off, left = 0, status = c.status;
    if (status === 'running') { left = c.endsAt - now; if (left <= 0) { status = 'done'; left = 0; } }
    else if (status === 'paused') left = c.leftMs;
    var done = status === 'done';
    card.className = (c.floaty ? 'floaty ' : '') + (c.flowBorder ? 'flowb ' : '') + 'th-' + c.theme + (done ? ' isdone' : '') + (status === 'paused' ? ' paused' : '');
    var secs = Math.ceil(left / 1000), h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
    var showH = c.showHours === 'always' || (c.showHours === 'auto' && h > 0);
    $('hWrap').style.display = showH ? '' : 'none';
    if (!showH) m += h * 60;
    $('h').textContent = two(h); $('m').textContent = two(m); $('s').textContent = two(s);
    var op = 1;
    if (status === 'idle') op = c.idleShow === 'hide' ? 0 : c.idleShow === 'dim' ? .25 : 1;
    if (done) {
      var since = now - (c.doneAt || c.endsAt || now);
      if (c.hideAfter && since > c.hideAfter * 1000) op = 0;
      if (!sparked && c.celebrate && since < 8000) { sparked = true; sparkle(); setTimeout(sparkle, 700); }
    } else sparked = false;
    $('wrap').style.opacity = op;
  }
  function poll() {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/countdowns?id=' + encodeURIComponent(id) + '&t=' + Date.now(), true);
    x.timeout = 4000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 200) { try { var d = JSON.parse(x.responseText); off = d.now - Date.now(); C = d.countdown; apply(); tick(); } catch (e) {} }
      setTimeout(poll, 1000);
    };
    x.send();
  }
  setInterval(tick, 250);
  poll();
})();
