(function () {
  var D = null, off = 0, lastTotals = {}, lastLog = 0, lastHot = {}, epoch = null, sparked = false;
  function $(x) { return document.getElementById(x); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rgba(h, a) { var n = parseInt(String(h).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fit() {
    if (!D) return; var W = window.innerWidth, H = window.innerHeight; if (!W || !H) return;
    var L = D.look, w = $('wrap'), cw = W * L.width / 100 * L.scale / 100;
    $('card').style.width = cw + 'px'; $('card').style.fontSize = (cw / 30) + 'px';
    w.style.left = (W * L.x / 100) + 'px'; w.style.top = (H * L.y / 100) + 'px';
    w.style.transform = w.style.webkitTransform = 'translate(-50%,-50%)';
    var tms = $('teams').children, n = D.board.length, per = n <= 4 ? n : n <= 6 ? 3 : 4;
    for (var i = 0; i < tms.length; i++) { tms[i].style.width = (100 / Math.max(1, per)) + '%'; tms[i].style.fontSize = (cw / 30) + 'px'; }
  }
  window.onresize = fit;
  function msgFor(e) {
    if (!e) return 'Type !team ' + (D.teams[0] ? D.teams[0].key.toUpperCase() : 'A') + ' to join a team!';
    if (e.kind === 'join') return e.name + ' joined ' + teamName(e.team) + '!';
    if (e.kind === 'find') return e.name + ' found ' + (e.n > 1 ? e.n + ' ' : e.n < 0 ? '(' + e.n + ') ' : '') + (e.icon ? e.icon + ' ' : '') + (e.label || e.item) + ' · ' + (e.pts > 0 ? '+' : '') + e.pts + ' pts';
    if (e.kind === 'noteam') return e.name + ' isn\'t on a team yet - type !team ' + (D.teams[0] ? D.teams[0].key.toUpperCase() : 'A') + ' first!';
    if (e.kind === 'move') return e.name + ' moved to ' + teamName(e.team);
    if (e.kind === 'start') return 'The hunt is ON! Good luck!';
    if (e.kind === 'end') return 'Time\'s up!';
    return '';
  }
  function teamName(k) { for (var i = 0; i < D.teams.length; i++) if (D.teams[i].key === k) return D.teams[i].name; return 'Team ' + String(k).toUpperCase(); }
  var rkey = '';
  function render() {
    var lastE = D.recent[D.recent.length - 1], k = JSON.stringify([D.board, D.items, D.look, D.title, D.subtitle, D.visible, D.teams, lastE ? lastE.id : 0]);
    if (k === rkey) { fit(); return; } rkey = k;
    var L = D.look, card = $('card');
    $('wrap').style.opacity = D.visible ? 1 : 0;
    card.className = L.theme === 'spooky' ? '' : L.theme;
    var t0 = D.board[0], t1 = D.board[1];
    card.children[0].style.background = 'radial-gradient(circle, ' + (t0 ? t0.color : '#06b6d4') + ' 0%, transparent 70%)';
    card.children[1].style.background = 'radial-gradient(circle, ' + (t1 ? t1.color : '#d946ef') + ' 0%, transparent 70%)';
    $('ic').textContent = D.items[0] && D.items[0].icon ? D.items[0].icon : '🎃';
    $('title').textContent = D.title; $('stitle').textContent = D.subtitle; $('stitle').style.display = D.subtitle ? '' : 'none';
    $('timer').style.display = L.showTimer ? '' : 'none';
    // legend: !team keys + what each find is worth
    var lg = '';
    for (var i = 0; i < D.items.length; i++) { var it = D.items[i]; lg += '<span>' + (it.imageUrl ? '<img src="' + esc(it.imageUrl) + '" alt="">' : esc(it.icon || '')) + ' !' + esc(it.command) + ' = <b>' + it.pts + ' pts</b></span>'; }
    $('legend').innerHTML = lg; $('legend').style.display = L.showLegend && lg ? '' : 'none';
    // tug bar
    var sum = 0, b; for (i = 0; i < D.board.length; i++) sum += Math.max(0, D.board[i].total);
    var bh = ''; for (i = 0; i < D.board.length; i++) { b = D.board[i]; bh += '<i style="width:' + (sum ? Math.max(0, b.total) / sum * 100 : 100 / D.board.length) + '%;background:linear-gradient(90deg,' + rgba(b.color, .75) + ',' + b.color + ')"></i>'; }
    $('bar').innerHTML = bh; $('bar').style.display = L.showBar ? '' : 'none';
    // teams
    var hot = {}, last = D.recent[D.recent.length - 1];
    if (last && last.id > lastLog && last.kind === 'find') hot[(last.name || '').toLowerCase()] = 1;
    var h = '';
    for (i = 0; i < D.board.length; i++) {
      b = D.board[i];
      var tc = b.color, tg = rgba(b.color, .55);
      h += '<div class="team' + (b.leading ? ' lead' : '') + '"><div class="pill" style="border-color:' + rgba(tc, .45) + (b.leading ? ';box-shadow:0 0 1em ' + tg : '') + '"><span class="edge" style="background:' + tc + '"></span><span class="crown">👑</span><div class="nm" style="color:' + tc + '">' + esc(b.name) + '</div>' +
        '<div class="mc">' + b.players.length + ' member' + (b.players.length === 1 ? '' : 's') + ' · <span class="cmd">!team ' + esc(b.key.toUpperCase()) + '</span></div>' +
        '<div class="sc" data-k="' + esc(b.key) + '" style="color:' + tc + ';text-shadow:0 0 .4em ' + tg + '">' + b.total + '</div></div>';
      if (L.showPlayers > 0) {
        h += '<div class="roster" style="border-color:' + rgba(tc, .3) + '">';
        if (!b.players.length) h += '<div class="empty">No one yet - type <b>!team ' + esc(b.key.toUpperCase()) + '</b></div>';
        var shown = b.players.slice(0, L.showPlayers);
        for (var j = 0; j < shown.length; j++) h += '<div class="row' + (hot[shown[j].name.toLowerCase()] ? ' hot' : '') + '"><span class="rk">' + (j + 1) + '</span><span class="pn">' + esc(shown[j].name) + '</span><span class="pp" style="color:' + tc + '">' + shown[j].points + '</span></div>';
        if (b.players.length > shown.length) h += '<div class="row more">+' + (b.players.length - shown.length) + ' more</div>';
        h += '</div>';
      }
      h += '</div>';
    }
    $('teams').innerHTML = h;
    for (i = 0; i < D.board.length; i++) { b = D.board[i]; if (lastTotals[b.key] !== undefined && lastTotals[b.key] !== b.total) { var el = document.querySelector('.sc[data-k="' + b.key + '"]'); if (el) { el.className = 'sc bump'; } } lastTotals[b.key] = b.total; }
    if (last) lastLog = last.id;
    $('msg').textContent = msgFor(last);
    $('tick').style.display = L.showTicker ? '' : 'none';
    fit();
  }
  function winner() {
    var max = -1, w = [];
    for (var i = 0; i < D.board.length; i++) { var b = D.board[i]; if (b.total > max) { max = b.total; w = [b]; } else if (b.total === max) w.push(b); }
    if (max <= 0) return 'Time\'s up!';
    if (w.length > 1) return '🤝 It\'s a tie! ' + w.map(function (x) { return x.name; }).join(' & ');
    return '🏆 ' + w[0].name + ' wins with ' + max + ' pts!';
  }
  function sparkle() {
    var card = $('card'), cw = card.offsetWidth, chh = card.offsetHeight, ch = ['✦', '★', '✨', '🎃', '♥'];
    for (var i = 0; i < 26; i++) (function (i) {
      var e = document.createElement('span'); e.className = 'spark'; e.textContent = ch[i % ch.length]; e.style.left = cw / 2 + 'px'; e.style.top = chh * .25 + 'px'; e.style.color = '#fde68a';
      card.appendChild(e);
      setTimeout(function () { var a = Math.random() * Math.PI * 2, d = cw * (.2 + Math.random() * .4); e.style.left = (cw / 2 + Math.cos(a) * d) + 'px'; e.style.top = (chh * .25 + Math.sin(a) * d * .5) + 'px'; e.style.opacity = '0'; }, 30);
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 1500);
    })(i);
  }
  function tick() {
    if (!D) return;
    var T = D.timer, now = Date.now() + off, left = T.status === 'running' ? Math.max(0, T.endsAt - now) : T.left, st = T.status;
    if (st === 'running' && left <= 0) st = 'ended';
    var s = Math.ceil(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    $('tm').textContent = st === 'ended' ? '00:00' : (h ? h + ':' + two(m) : two(m)) + ':' + two(s % 60);
    var stx = st === 'running' ? (D.scoring ? 'Hunting!' : 'Paused scoring') : st === 'paused' ? 'Paused' : st === 'ended' ? 'Finished' : (D.joinOpen ? 'Join now!' : 'Ready');
    $('st').textContent = stx; $('st').style.color = st === 'running' ? '#34d399' : st === 'ended' ? '#f472b6' : '#fcd34d';
    var ended = st === 'ended';
    $('win').style.display = ended ? 'block' : 'none';
    if (ended) { $('winTxt').textContent = winner(); if (!sparked) { sparked = true; sparkle(); setTimeout(sparkle, 700); } } else sparked = false;
  }
  function poll() {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/hunt?t=' + Date.now(), true); x.timeout = 4000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 200) { try { D = JSON.parse(x.responseText); off = D.now - Date.now(); if (epoch !== null && epoch !== D.epoch) lastTotals = {}; epoch = D.epoch; render(); tick(); } catch (e) {} }
      setTimeout(poll, 1000);
    };
    x.send();
  }
  setInterval(tick, 250);
  poll();
})();
