// ICB Badge Vote overlay (Baby, 2026-10-03). Meld layer, full screen:
//   http://127.0.0.1:8790/poll.html
// Plain ES5 (Meld rule). Polls /api/poll every second.
(function(){
  var stage = document.getElementById('stage');
  function fit(){ var sx = window.innerWidth / 1920, sy = window.innerHeight / 1080; stage.style.transform = 'scale(' + Math.min(sx, sy) + ')'; }
  window.addEventListener('resize', fit); fit();
  var $ = function(id){ return document.getElementById(id); };
  var lastKey = '', lastRevealed = false, clockSkew = 0, state = null;

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function layout(n){
    // Fit up to ~10 badges on one 1920x1080 screen.
    var perRow = n <= 3 ? n : n <= 4 ? 4 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
    var rows = Math.ceil(n / perRow);
    var cw = Math.min(380, Math.floor((1800 - (perRow - 1) * 28) / perRow));
    var ph = Math.max(90, Math.min(240, Math.floor((680 - rows * 190) / rows)));
    $('grid').style.setProperty('--cw', cw + 'px');
    $('grid').style.setProperty('--ph', ph + 'px');
  }

  function build(d){
    layout(d.rows.length);
    var html = '';
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      html += '<div class="card" id="c-' + r.id + '"><div class="crown">👑</div><div class="num">' + r.number + '</div>' +
        '<div class="pic">' + (r.image ? '<img src="' + esc(r.image) + '" alt="">' : '') + '</div>' +
        '<div class="label">' + esc(r.label) + '</div><div class="cmd">!vote ' + r.number + '</div>' +
        '<div class="bar"><i></i></div><div class="count"></div></div>';
    }
    $('grid').innerHTML = html;
  }

  function confetti(){
    var bits = ['🎉', '✨', '🦄', '💖', '⭐', '🌈'];
    for (var i = 0; i < 40; i++) (function(i){
      setTimeout(function(){
        var c = document.createElement('div'); c.className = 'confetti';
        c.appendChild(document.createTextNode(bits[Math.floor(Math.random() * bits.length)]));
        c.style.left = Math.round(Math.random() * 1880) + 'px';
        c.style.animationDuration = (2.5 + Math.random() * 2) + 's';
        stage.appendChild(c);
        setTimeout(function(){ if (c.parentNode) c.parentNode.removeChild(c); }, 5000);
      }, i * 60);
    })(i);
  }

  function render(d){
    state = d;
    var show = d.rows.length && (d.open || d.showResults || d.revealed || d.openFlag);
    $('wrap').className = show ? '' : 'hidden';
    if (!d.rows.length) return;
    var key = d.rows.map(function(r){ return r.id + ':' + r.label + ':' + r.image; }).join('|');
    if (key !== lastKey) { lastKey = key; build(d); }
    $('title').textContent = d.title || 'Vote!';
    $('grid').className = 'grid' + (d.showResults || d.revealed ? '' : ' results-off') + (d.revealed ? ' revealed' : '');
    var max = 0, i, r;
    for (i = 0; i < d.rows.length; i++) max = Math.max(max, d.rows[i].points);
    var winners = [];
    for (i = 0; i < d.rows.length; i++) {
      r = d.rows[i];
      var el = $('c-' + r.id); if (!el) continue;
      var win = d.revealed && max > 0 && r.points === max;
      if (win) winners.push(r.label || ('Badge ' + r.number));
      el.className = 'card' + ((d.showResults || d.revealed) && r.leading ? ' leading' : '') + (win ? ' winner' : '');
      el.querySelector('.bar i').style.width = (max ? Math.round(r.points / max * 100) : 0) + '%';
      el.querySelector('.count').textContent = r.points + (r.points === 1 ? ' vote' : ' votes') + (d.total ? ' · ' + r.percent + '%' : '');
    }
    if (d.revealed && !lastRevealed) confetti();
    lastRevealed = d.revealed;
    updateStatus();
    $('footer').innerHTML = d.revealed
      ? '🎉 Thank you for voting! 🎉'
      : 'Type <b style="color:#ffe66d">!vote</b> and a number — vote for as many as you like! ' + (d.subWeight > 1 ? '⭐ Subs count ' + (d.subWeight === 2 ? 'double' : 'triple') + '!' : '');
  }

  function updateStatus(){
    var d = state; if (!d) return;
    var txt;
    if (d.revealed) {
      var max = 0, names = [];
      for (var i = 0; i < d.rows.length; i++) max = Math.max(max, d.rows[i].points);
      for (var j = 0; j < d.rows.length; j++) if (max > 0 && d.rows[j].points === max) names.push(d.rows[j].label || ('Badge ' + d.rows[j].number));
      txt = max ? '👑 The winner' + (names.length > 1 ? 's are' : ' is') + ': <b>' + esc(names.join(' & ')) + '</b>' : 'No votes yet!';
    } else if (d.open) {
      if (d.endsAt) {
        var left = Math.max(0, Math.round((d.endsAt - (new Date().getTime() + clockSkew)) / 1000));
        txt = 'Voting is OPEN — <b>' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) + '</b> left';
      } else txt = 'Voting is <b>OPEN</b>!';
      txt += ' · ' + d.people + (d.people === 1 ? ' voter' : ' voters');
    } else txt = 'Voting is closed';
    $('status').innerHTML = txt;
  }
  setInterval(updateStatus, 250);

  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/poll?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4 || x.status !== 200) return;
      try { var d = JSON.parse(x.responseText); if (d && d.ok) { clockSkew = (d.now || 0) - new Date().getTime(); render(d); } } catch (e) {}
    };
    x.send();
  }
  poll(); setInterval(poll, 1000);
})();
