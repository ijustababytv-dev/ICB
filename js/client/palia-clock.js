(function () {
  var D = null, off = 0, last = null, prevH = null, ringUntil = 0, started = false;
  function $(x) { return document.getElementById(x); }
  function paliaHours(ms) { var d = new Date(ms), m = d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000; return (((6 + (m - 15) / 2.5) % 24) + 24) % 24; }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(h, m, t24) { if (t24) return two(h) + ':' + two(m); var hh = h % 12 === 0 ? 12 : h % 12; return hh + ':' + two(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function tval(t) { var p = t.split(':'); return Number(p[0]) + Number(p[1]) / 60; }
  function fit() {
    if (!D) return; var W = window.innerWidth, H = window.innerHeight; if (!W || !H) return;
    var L = D.look, w = $('wrap');
    $('card').style.fontSize = (16 * H / 1080 * L.scale / 100) + 'px';
    var cw = w.offsetWidth, ch = w.offsetHeight;
    var x = W * L.x / 100 - cw / 2, y = H * L.y / 100 - ch / 2;
    x = Math.max(8, Math.min(W - cw - 8, x)); y = Math.max(8, Math.min(H - ch - 8, y));
    w.style.left = x + 'px'; w.style.top = y + 'px';
  }
  window.onresize = fit;
  var actx = null;
  function chime() {
    if (!D || !D.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var notes = [784, 988, 1175, 1568], v = (D.volume || 60) / 100 * .25;
      for (var i = 0; i < notes.length; i++) (function (f, t) {
        var o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, actx.currentTime + t); g.gain.linearRampToValueAtTime(v, actx.currentTime + t + .02); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + t + .9);
        o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 1);
      })(notes[i], i * .16);
    } catch (e) {}
  }
  function ring(icon, label, time) {
    $('ringT').innerHTML = '<span class="bell">' + (icon || '🔔') + '</span> ' + (time ? time + ' — ' : '') ;
    $('ringT').appendChild(document.createTextNode(label || ''));
    $('ringS').textContent = 'Palia time alarm';
    ringUntil = Date.now() + (D.bannerSec || 8) * 1000; chime();
  }
  function tick() {
    if (!D) return;
    var L = D.look, now = Date.now() + off, ph = paliaHours(now), h = Math.floor(ph), m = Math.floor((ph % 1) * 60);
    $('wrap').style.opacity = D.visible ? 1 : 0;
    $('card').className = L.theme === 'night' ? '' : L.theme;
    $('title').textContent = D.title || 'Palia Time';
    var t = fmt(h, m, L.show24h), sp = t.indexOf(' ');
    $('time').innerHTML = sp > 0 ? t.slice(0, sp) + '<small>' + t.slice(sp + 1) + '</small>' : t;
    var rd = new Date(now);
    $('real').textContent = 'Real time ' + rd.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · new Palia day in ' + Math.ceil(((24 - ph + 6) % 24 || 24) * 2.5) + ' min';
    $('real').style.display = L.showReal ? '' : 'none';
    var day = ph >= 6 && ph < 18;
    $('orbI').textContent = day ? '☀️' : '🌙';
    $('sky').style.background = day ? (ph < 8 || ph >= 16 ? 'linear-gradient(180deg,#fb923c,#fde68a)' : 'linear-gradient(180deg,#38bdf8,#bae6fd)') : 'linear-gradient(180deg,#0f172a,#4338ca)';
    $('pin').style.left = (ph / 24 * 100) + '%';
    $('bar').style.display = $('pin').style.display = L.showDayBar ? '' : 'none';
    document.querySelector('.ticks').style.display = L.showDayBar ? '' : 'none';
    // next alarm
    var best = null, bestDh = 99;
    for (var i = 0; i < D.alarms.length; i++) { var a = D.alarms[i]; if (!a.on) continue; var dh = (tval(a.time) - ph + 24) % 24; if (dh < bestDh) { bestDh = dh; best = a; } }
    if (best && L.showNext) {
      var secs = Math.ceil(bestDh * 150), tp = best.time.split(':');
      $('next').innerHTML = (best.icon || '⏰') + ' <span></span> · <b>' + fmt(Number(tp[0]), Number(tp[1]), L.show24h) + '</b> · in ' + Math.floor(secs / 60) + ':' + two(secs % 60);
      $('next').children[0].textContent = best.label || 'Alarm';
      $('next').style.display = '';
    } else $('next').style.display = 'none';
    // alarms that the clock just passed
    if (prevH !== null) {
      for (i = 0; i < D.alarms.length; i++) {
        a = D.alarms[i]; if (!a.on) continue; var tv = tval(a.time), passed = prevH <= ph ? (tv > prevH && tv <= ph) : (tv > prevH || tv <= ph);
        if (passed && (ph - prevH + 24) % 24 < 1) { var p2 = a.time.split(':'); ring(a.icon, a.label, fmt(Number(p2[0]), Number(p2[1]), L.show24h)); }
      }
    }
    prevH = ph;
    $('ring').style.display = Date.now() < ringUntil ? 'block' : 'none';
    fit();
  }
  function poll() {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/paliaclock?since=' + (started ? last : 999999999) + '&t=' + Date.now(), true); x.timeout = 4000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 200) { try { var d = JSON.parse(x.responseText); D = d; off = d.now - Date.now();
        if (!started) { last = d.last; started = true; } else { for (var i = 0; i < d.events.length; i++) if (d.events[i].id > last) { last = d.events[i].id; ring(d.events[i].icon, d.events[i].label, ''); } if (d.last < last) last = d.last; }
        tick(); } catch (e) {} }
      setTimeout(poll, 1500);
    };
    x.send();
  }
  setInterval(tick, 250);
  poll();
})();
