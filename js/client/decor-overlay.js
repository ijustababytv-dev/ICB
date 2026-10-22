// ICB decor overlay (Baby, 2026-09-29; motions + all-in-one added 2026-10-01).
//   http://127.0.0.1:8790/decor/<effect-id>.html  -> just that effect
//   http://127.0.0.1:8790/decor/all.html          -> EVERY effect that's on,
//      so one Meld layer can switch between leaves, ghosts, ... from the dashboard.
// The id comes from the page's own path (no query strings in Meld URLs).
// Settings come from decor-control.html via /api/decor/state, polled every
// second, so changes show up live with no layer reload.
// Motion per effect (`type`): 'fall' (drift down, like leaves), 'float'
// (rise up from the bottom, like ghosts), 'fly' (drift across the screen).
// Plain ES5 so it runs in any browser source.
(function(){
  var m = /\/decor\/([a-z0-9-]+)\.html/.exec(window.location.pathname);
  var EFFECT_ID = m ? m[1] : 'leaves';
  var ALL = EFFECT_ID === 'all';

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var W = 1920, H = 1080, DPR = 1;
  function resize(){
    DPR = window.devicePixelRatio || 1;
    W = window.innerWidth || 1920; H = window.innerHeight || 1080;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // One "system" per effect: its settings, its art, its pieces on screen.
  var systems = {};
  var order = [];

  function system(id){
    if (!systems[id]) { systems[id] = { id: id, effect: null, sprites: [], spriteKey: '', parts: [], lastSpawn: 0 }; }
    return systems[id];
  }

  // Pre-shrink each image once so hundreds of particles stay cheap.
  function loadSprites(sys, urls){
    var key = urls.join('|');
    if (key === sys.spriteKey) return;
    sys.spriteKey = key;
    var next = [];
    for (var i = 0; i < urls.length; i++) (function(url){
      var img = new Image();
      img.onload = function(){
        var max = 320, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * sc));
        c.height = Math.max(1, Math.round(img.naturalHeight * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.src = url;
        next.push(c);
        if (sys.spriteKey === key) sys.sprites = next.slice();
      };
      img.src = url;
    })(urls[i]);
    if (!urls.length) sys.sprites = [];
  }

  // Placeholders, only used until Baby adds her own art for an effect.
  var PLACEHOLDER_COLORS = ['#d9531e', '#e8892b', '#c23b22', '#f0b13a', '#9c3a1a'];
  function drawPlaceholderLeaf(size, color){
    var s = size / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.9, -s * 0.6, s * 0.8, s * 0.4, 0, s);
    ctx.bezierCurveTo(-s * 0.8, s * 0.4, -s * 0.9, -s * 0.6, 0, -s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,30,10,0.55)'; ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 1.15); ctx.stroke();
  }
  function drawPlaceholderGhost(size){
    var s = size / 2;
    ctx.fillStyle = 'rgba(245,240,255,0.95)';
    ctx.beginPath();
    ctx.arc(0, -s * 0.2, s * 0.7, Math.PI, 0);
    ctx.lineTo(s * 0.7, s * 0.8);
    for (var i = 0; i < 4; i++) ctx.quadraticCurveTo(s * (0.525 - i * 0.35), s * (i % 2 ? 0.95 : 0.6), s * (0.35 - i * 0.35), s * 0.8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b2140';
    ctx.beginPath(); ctx.arc(-s * 0.25, -s * 0.25, s * 0.1, 0, Math.PI * 2); ctx.arc(s * 0.25, -s * 0.25, s * 0.1, 0, Math.PI * 2); ctx.fill();
  }

  function spawn(sys, fresh){
    var e = sys.effect;
    var type = e.type || 'fall';
    var size = e.size * (0.75 + Math.random() * 0.5);
    var p = {
      size: size,
      sprite: sys.sprites.length ? sys.sprites[Math.floor(Math.random() * sys.sprites.length)] : null,
      color: PLACEHOLDER_COLORS[Math.floor(Math.random() * PLACEHOLDER_COLORS.length)],
      v: 0.7 + Math.random() * 0.8,           // base speed, scaled by `speed`
      phase: Math.random() * Math.PI * 2,
      fadePhase: Math.random() * Math.PI * 2,
      swayFreq: 0.6 + Math.random() * 0.8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.04,
      flip: Math.random() * Math.PI * 2,       // fake 3D flutter (leaves)
      dir: 1
    };
    if (type === 'float') {
      p.x = Math.random() * (W + 200) - 100;
      p.y = fresh ? H + size + Math.random() * 60 : Math.random() * H;
      p.rot = 0;
    } else if (type === 'fly') {
      // Wind decides the direction; no wind = a mix of both ways.
      p.dir = e.drift > 0.05 ? 1 : (e.drift < -0.05 ? -1 : (Math.random() < 0.5 ? -1 : 1));
      p.x = fresh ? (p.dir > 0 ? -size - Math.random() * 80 : W + size + Math.random() * 80) : Math.random() * W;
      p.y = size + Math.random() * Math.max(1, H - size * 2);
      p.rot = 0;
    } else {
      p.x = Math.random() * (W + 200) - 100;
      p.y = fresh ? -size - Math.random() * 60 : Math.random() * H;
    }
    sys.parts.push(p);
  }

  function step(sys, t, dt){
    var e = sys.effect;
    if (!e) return;
    var type = e.type || 'fall';
    var parts = sys.parts;
    // Keep the screen topped up to `amount`, trickling in from the edge so
    // turning it on looks natural instead of everything appearing at once.
    if (e.enabled && parts.length < e.amount && t - sys.lastSpawn > Math.max(20, 900 / e.amount / e.speed)) {
      spawn(sys, true); sys.lastSpawn = t;
    }
    var fade = e.fade || 0;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.phase += 0.02 * p.swayFreq * dt * e.speed;
      p.fadePhase += 0.025 * dt;
      var gone;
      if (type === 'float') {
        p.y -= p.v * 1.2 * e.speed * dt;
        p.x += (e.drift * 0.6 + Math.sin(p.phase) * 1.2 * e.sway) * dt * e.speed;
        p.rot = Math.sin(p.phase * 0.8) * 0.25 * e.spin;
        gone = p.y < -p.size * 1.2 || (parts.length > e.amount && p.y > H);
      } else if (type === 'fly') {
        var wind = Math.max(0.6, Math.abs(e.drift));
        p.x += p.dir * p.v * 1.5 * wind * e.speed * dt;
        p.y += Math.sin(p.phase) * 1.1 * e.sway * dt * e.speed;
        p.rot = Math.sin(p.phase * 0.8) * 0.2 * e.spin;
        gone = (p.dir > 0 ? p.x > W + p.size * 1.5 : p.x < -p.size * 1.5) || (parts.length > e.amount && (p.x < 0 || p.x > W));
      } else {
        p.y += p.v * 1.6 * e.speed * dt;
        p.x += (e.drift * 0.9 + Math.sin(p.phase) * 1.4 * e.sway) * dt * e.speed;
        p.rot += p.vr * e.spin * dt * e.speed * 1.5;
        p.flip += 0.03 * e.spin * dt * e.speed;
        gone = p.y > H + p.size || (parts.length > e.amount && p.y < -p.size * 0.5);
      }
      // Gone off screen (or too many after lowering the amount): drop it.
      if (gone || p.x < -p.size * 2 - 160 || p.x > W + p.size * 2 + 160) { parts.splice(i, 1); continue; }

      // Ghostly fade: each piece gently pulses between solid and faint.
      ctx.globalAlpha = e.opacity * (1 - fade * 0.45 * (1 + Math.sin(p.fadePhase)));
      ctx.save();
      ctx.translate(p.x, p.y);
      if (type === 'fall') {
        ctx.rotate(p.rot + Math.sin(p.phase) * 0.35 * e.spin);
        ctx.scale(e.spin > 0 ? 0.55 + 0.45 * Math.abs(Math.cos(p.flip)) : 1, 1);
      } else {
        ctx.rotate(p.rot);
        if (type === 'fly' && p.dir < 0) ctx.scale(-1, 1); // face the way it's going
      }
      if (p.sprite) {
        var sw = p.size, sh = sw * p.sprite.height / p.sprite.width;
        if (sh > p.size) { sh = p.size; sw = sh * p.sprite.width / p.sprite.height; }
        ctx.drawImage(p.sprite, -sw / 2, -sh / 2, sw, sh);
      } else if (!sys.sprites.length) {
        if (type === 'fall') drawPlaceholderLeaf(p.size, p.color); else drawPlaceholderGhost(p.size);
      } else {
        p.sprite = sys.sprites[Math.floor(Math.random() * sys.sprites.length)];
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  var lastT = 0;
  function frame(t){
    var dt = lastT ? Math.min(3, (t - lastT) / 16.67) : 1; // in 60fps "frames"
    lastT = t;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < order.length; i++) step(systems[order[i]], t, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function mergeOff(e){ var c = {}; for (var k in e) c[k] = e[k]; c.enabled = false; return c; }

  function apply(found){
    var sys = system(found.id);
    var old = sys.effect;
    var sizeChanged = old && old.size !== found.size;
    var typeChanged = old && (old.type || 'fall') !== (found.type || 'fall');
    sys.effect = found;
    loadSprites(sys, found.images || []);
    if (typeChanged) sys.parts = []; // new motion: start fresh from the right edge
    if (sizeChanged) for (var k = 0; k < sys.parts.length; k++) sys.parts[k].size = found.size * (0.75 + Math.random() * 0.5);
    // New art set: let the old pieces go, new ones use the new art.
    var joined = (found.images || []).join('|');
    for (var j = 0; j < sys.parts.length; j++) if (sys.parts[j].sprite && joined.indexOf(sys.parts[j].sprite.src) < 0) sys.parts[j].sprite = null;
  }

  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/decor/state?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4 || x.status !== 200) return;
      try {
        var d = JSON.parse(x.responseText);
        if (!d || !d.effects) return;
        var seen = {}, nextOrder = [];
        for (var i = 0; i < d.effects.length; i++) {
          var e = d.effects[i];
          if (!ALL && e.id !== EFFECT_ID) continue;
          seen[e.id] = true; nextOrder.push(e.id);
          apply(e);
        }
        // An effect that was deleted: stop new pieces, let the rest finish.
        for (var id in systems) {
          if (!seen[id] && systems[id].effect) { systems[id].effect = mergeOff(systems[id].effect); nextOrder.push(id); }
        }
        order = nextOrder;
      } catch (err) {}
    };
    x.send();
  }
  poll();
  setInterval(poll, 1000);

  // Debug hook for testing.
  window.__decor = { state: function(){
    var out = { id: EFFECT_ID, effects: {} };
    for (var id in systems) { var s = systems[id]; out.effects[id] = { on: !!(s.effect && s.effect.enabled), type: s.effect && s.effect.type, parts: s.parts.length, sprites: s.sprites.length }; }
    return out;
  } };
})();
