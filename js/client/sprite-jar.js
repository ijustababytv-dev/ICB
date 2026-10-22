(function () {
  var VAR = { 'Base': ['BASE', '#9a9ea8'], 'Gold': ['GOLD', '#f5a33a'], 'Cheat Master': ['CHEAT', '#4fb52a'], 'Loot Hacker': ['HACKER', '#6b6dff'], 'Bounty Hunter': ['HUNTER', '#e384ea'], 'Trick or Treat': ['TRICK', '#ff7a2e'], 'Quack': ['QUACK', '#a46bff'] };
  var RAR = { Common: '#8e949e', Uncommon: '#3fae4a', Rare: '#3b8df0', Epic: '#a052e6', Legendary: '#ee8a1c', Mythic: '#e6b422', Exotic: '#2ad1c9' };
  function vinfo(v) { return VAR[v] || [String(v || '').toUpperCase().slice(0, 8), '#b77cff']; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var stage = $('stage'), jar = $('jar'), inner = $('inner'), book = $('book'), fly = $('fly');
  var recentId = null;
  var S = null, roster = [], stats = null, season = '', last = 0, started = false, epoch = null;
  var bodies = {}, queue = [], busy = false, closeT = null, jarKey = '';
  var floorEl = document.getElementById('floor'), toys = {}, floorKey = '';
  function isFloor() { return S && S.mode === 'floor'; }

  // ---------- layout ----------
  function fit() {
    var W = window.innerWidth, H = window.innerHeight; if (!W || !H || !S) return;
    stage.className = S.visible ? '' : 'hidden';
    var custom = !!S.jarUrl, back = custom ? S.jarUrl : S.jarBack;
    if ($('jarBack').getAttribute('src') !== back) $('jarBack').src = back;
    $('jarFront').style.display = custom ? 'none' : '';
    if (!custom && $('jarFront').getAttribute('src') !== S.jarFront) $('jarFront').src = S.jarFront;
    var img = $('jarBack'), ar = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1.5;
    var jw = W * S.jarW / 100, jh = jw * ar;
    jar.style.left = (W * S.jarX / 100) + 'px'; jar.style.top = (H * S.jarY / 100) + 'px'; jar.style.width = jw + 'px'; jar.style.height = jh + 'px';
    inner.style.left = (jw * S.inL / 100) + 'px'; inner.style.top = (jh * S.inT / 100) + 'px';
    inner.style.width = (jw * S.inW / 100) + 'px'; inner.style.height = (jh * S.inH / 100) + 'px';
    $('jarCount').style.top = (jh + W * 0.004) + 'px';
    var bw = W * (propped() ? S.pbW : S.bookW) / 100;
    book.style.width = bw + 'px'; book.style.fontSize = (bw / 60) + 'px';
    if (propped()) {   // leaning on the floor at the left, always showing
      var bh = book.offsetHeight || bw * 0.56;
      book.style.left = (W * S.pbX / 100) + 'px'; book.style.top = (H - H * S.pbB / 100 - bh) + 'px';
      book.style.transform = book.style.webkitTransform = 'perspective(90em) rotateX(' + S.pbLean + 'deg) rotate(' + S.pbTilt + 'deg)' + (alive ? ' translateY(-1.2em) scale(1.06)' : '') + (shownOpen() ? '' : ' scale(.5,1) translateX(-30%)');
      placeShut(W, H, bw, bh);
    } else {
      book.style.left = (W * S.bookX / 100) + 'px'; book.style.top = (H * S.bookY / 100) + 'px';
      book.style.transform = book.style.webkitTransform = '';
      placeShut(W, H, bw, 0);
    }
    bookClass();
    $('ribbon').innerHTML = (S.bookTheme === 'spooky' ? '☾ ' : '') + esc(S.title || 'Sprite Sticker Book') + '<small>' + esc(season) + '</small>';
    jar.style.display = isFloor() ? 'none' : '';
    floorEl.style.display = isFloor() ? 'block' : 'none';
    var fL = S.floorL; if (propped() && S.avoidBook && S.pbX < 30) fL = Math.max(fL, S.pbX + S.pbW + 0.5);   // toys stay clear of the book only if she turns that on (2026-10-19: she wants them under it)
    var fl = W * fL / 100, fr = W * Math.max(S.floorR, S.floorL + 5) / 100, fh = H * S.floorH / 100;
    floorEl.style.left = fl + 'px'; floorEl.style.width = (fr - fl) + 'px'; floorEl.style.height = fh + 'px'; floorEl.style.top = (H - H * S.floorB / 100 - fh) + 'px';
    sizeBodies();
  }
  window.onresize = fit;

  // ---------- floor mode: toys lying around the bottom of the stream ----------
  // Each toy gets a spot from a hash of its name (so they don't reshuffle every time), then a few
  // rounds of nudging so they don't all pile on top of each other. Lower on screen = in front.
  function hash(str, salt) { var h = 2166136261 ^ salt; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; } return h / 4294967296; }
  function syncFloor() {
    var sd = (S.mixSeed || 0) * 97, list = inJar(), key = 'm' + sd + list.map(function (t) { return t.key + t.img + (t.done ? '*' : ''); }).join('|') + '#' + floorEl.clientWidth + 'x' + floorEl.clientHeight + '@' + S.toySize;
    if (key === floorKey) return; floorKey = key;
    var W = floorEl.clientWidth, H = floorEl.clientHeight; if (!W || !H) { floorKey = ''; return; }
    var size = window.innerHeight * 0.085 * (S.toySize / 100), keep = {}, pts = [], i, j, it;
    for (i = 0; i < list.length; i++) pts.push({ t: list[i], o: hash(list[i].key, 1 + sd), y: hash(list[i].key, 2 + sd) });
    pts.sort(function (a, b) { return a.o - b.o; });   // spread evenly left to right, in a shuffled order
    for (i = 0; i < pts.length; i++) pts[i].x = (i + 0.15 + 0.7 * hash(pts[i].t.key, 5 + sd)) / Math.max(1, pts.length);
    var minD = Math.min(0.5, (size * 0.8) / W), ar = W / Math.max(1, H);
    for (it = 0; it < 12; it++) for (i = 0; i < pts.length; i++) for (j = i + 1; j < pts.length; j++) {
      var a = pts[i], b = pts[j], dx = b.x - a.x, dy = (b.y - a.y) / ar, d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      if (d < minD) { var o = (minD - d) / 2, nx = dx / d, ny = dy / d; a.x -= nx * o; b.x += nx * o; a.y -= ny * o * ar; b.y += ny * o * ar;
        a.x = Math.max(0, Math.min(1, a.x)); b.x = Math.max(0, Math.min(1, b.x)); a.y = Math.max(0, Math.min(1, a.y)); b.y = Math.max(0, Math.min(1, b.y)); }
    }
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], t = p.t, toy = toys[t.key]; keep[t.key] = 1;
      if (!toy) { var el = document.createElement('div'); el.innerHTML = '<div class="in"><img alt=""></div>'; floorEl.appendChild(el); toy = toys[t.key] = { el: el, img: el.getElementsByTagName('img')[0] }; }
      if (toy.img.getAttribute('src') !== t.img) toy.img.src = t.img;
      var depth = 0.82 + p.y * 0.3, sz = size * depth * ((t.base ? S.baseToy : 100) / 100);   // base sprites bigger on the floor
      var r = hash(t.key, 3 + sd), rot = (r - 0.5) * 50; if (hash(t.key, 4 + sd) < 0.12) rot = (r < 0.5 ? -1 : 1) * (70 + r * 20);   // a few tipped over
      toy.x = p.x * (W - sz) + sz / 2; toy.y = sz * 0.15 + p.y * (H - sz * 0.15);   // y = where it touches the floor
      toy.sz = sz;
      toy.el.className = 'toy' + (t.done ? ' done' : '') + (/ mixing/.test(toy.el.className) ? ' mixing' : '');
      toy.el.style.width = toy.el.style.height = sz + 'px';
      toy.el.style.zIndex = String(10 + Math.round(p.y * 100));
      toy.el.style.transform = toy.el.style.webkitTransform = 'translate(' + (toy.x - sz / 2).toFixed(1) + 'px,' + (toy.y - sz).toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)';
      toy.el.style.visibility = toy.hidden ? 'hidden' : '';
    }
    for (var k in toys) if (toys.hasOwnProperty(k) && !keep[k] && !toys[k].hidden) { if (toys[k].el.parentNode) toys[k].el.parentNode.removeChild(toys[k].el); delete toys[k]; }
  }
  // "Mix up the toys" (dashboard button or !mix): every toy hops and bounces over to a new spot (her request 2026-10-19).
  function mixUp() {
    if (!isFloor()) { shake(inner.clientHeight * 1.4); setTimeout(function () { shake(inner.clientHeight * 1.2); }, 450); return; }
    for (var k in toys) if (toys.hasOwnProperty(k)) (function (t) {
      var d = Math.round(Math.random() * 350);
      t.el.style.transitionDelay = t.el.style.webkitTransitionDelay = d + 'ms';
      t.el.className = t.el.className.replace(/ (wiggle|drop|mixing)/g, '') + ' mixing';
      setTimeout(function () { t.el.className = t.el.className.replace(' mixing', ''); t.el.style.transitionDelay = t.el.style.webkitTransitionDelay = ''; }, 1900 + d);
    })(toys[k]);
    floorKey = '';   // the new seed arrives in the same poll and syncFloor moves everyone with the transition
  }
  function toyAnim(toy, cls, ms) { var e = toy.el, base = e.className.replace(/ (wiggle|drop)/g, ''); e.className = base; void e.offsetWidth; e.className = base + ' ' + cls; setTimeout(function () { e.className = e.className.replace(' ' + cls, ''); }, ms); }
  setInterval(function () {   // now and then a toy wiggles
    if (!isFloor() || !S.visible) return;
    var ks = []; for (var k in toys) if (toys.hasOwnProperty(k) && !toys[k].hidden) ks.push(k);
    if (ks.length) toyAnim(toys[ks[Math.floor(Math.random() * ks.length)]], 'wiggle', 850);
  }, 2600);

  // ---------- sprites in the jar (little physics pile) ----------
  // What's in the jar: one item per sticker that has art (Jonesy_Gold.png...), or one per sprite.
  // pinned = stickers mid-flight, kept until they land even if "caught stickers leave the jar" is on.
  var pinned = {};
  function artOf(s, v) { return (s.art && s.art[v]) || null; }
  function inJar() {
    var out = [];
    for (var i = 0; i < roster.length; i++) {
      var s = roster[i], full = s.caught.length === s.variants.length, any = false;
      if (S.jarHolds !== 'sprites') for (var j = 0; j < s.variants.length; j++) {
        var v = s.variants[j], a = artOf(s, v), k = s.id + '|' + v; if (!a) continue; any = true;
        var got = s.caught.indexOf(v) >= 0;
        if (S.leaveCaught && got && !pinned[k]) continue;
        out.push({ key: k, id: s.id, variant: v, img: a, done: got, base: j === 0 });
      }
      if (any || !s.img) continue;
      if ((S.removeComplete || S.leaveCaught) && full && !pinned[s.id]) continue;
      out.push({ key: s.id, id: s.id, variant: '', img: s.img, done: full, base: true });
    }
    return out;
  }
  function radius() {
    var n = Math.max(1, inJar().length), a = inner.clientWidth * inner.clientHeight;
    var r = Math.sqrt(a * 0.5 / (n * Math.PI)) * (S.spriteSize / 100);
    return Math.max(6, Math.min(r, inner.clientWidth / 3));
  }
  function sizeBodies() { var r = radius(); for (var k in bodies) if (bodies.hasOwnProperty(k)) { bodies[k].r = r; bodies[k].el.style.width = bodies[k].el.style.height = (r * 2.2) + 'px'; } }
  function syncJar() {
    var list = inJar(), key = list.map(function (s) { return s.key + s.img + (s.done ? '*' : ''); }).join('|');
    $('jarCount').textContent = stats ? stats.done + ' / ' + stats.total + ' stickers' : '';
    if (key === jarKey) return; jarKey = key;
    var keep = {};
    for (var i = 0; i < list.length; i++) {
      var s = list[i], b = bodies[s.key]; keep[s.key] = 1;
      if (!b) {
        var el = document.createElement('div'); el.className = 'js'; el.innerHTML = '<img alt="">'; inner.appendChild(el);
        b = bodies[s.key] = { id: s.key, el: el, x: Math.random() * inner.clientWidth, y: -Math.random() * inner.clientHeight * 0.6, vx: (Math.random() - .5) * 60, vy: 0, rot: (Math.random() - .5) * 30, r: 10 };
      }
      if (b.el.firstChild.getAttribute('src') !== s.img) b.el.firstChild.src = s.img;
      b.el.className = 'js' + (s.done ? ' done' : '');
    }
    for (var k in bodies) if (bodies.hasOwnProperty(k) && !keep[k] && !bodies[k].hold) { if (bodies[k].el.parentNode) bodies[k].el.parentNode.removeChild(bodies[k].el); delete bodies[k]; }
    sizeBodies();
  }
  function shake(power) { for (var k in bodies) if (bodies.hasOwnProperty(k)) { bodies[k].vx += (Math.random() - .5) * power; bodies[k].vy -= Math.random() * power * .8; } }
  function physics(dt) {
    var W = inner.clientWidth, H = inner.clientHeight, list = [], k, i, j, g = H * 2.2;
    for (k in bodies) if (bodies.hasOwnProperty(k)) list.push(bodies[k]);
    for (i = 0; i < list.length; i++) { var b = list[i]; if (b.hold) continue; b.vy += g * dt; b.vx *= 0.995; b.x += b.vx * dt; b.y += b.vy * dt; }
    for (var it = 0; it < 4; it++) {
      for (i = 0; i < list.length; i++) for (j = i + 1; j < list.length; j++) {
        var a = list[i], c = list[j]; if (a.hold || c.hold) continue;
        var dx = c.x - a.x, dy = c.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, m = a.r + c.r;
        if (d < m) {
          var o = (m - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * o; a.y -= ny * o; c.x += nx * o; c.y += ny * o;
          var rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rv < 0) { var imp = -rv * 0.6; a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny; }
        }
      }
      for (i = 0; i < list.length; i++) {
        var q = list[i]; if (q.hold) continue;
        if (q.x < q.r) { q.x = q.r; q.vx = Math.abs(q.vx) * 0.4; } if (q.x > W - q.r) { q.x = W - q.r; q.vx = -Math.abs(q.vx) * 0.4; }
        if (q.y > H - q.r) { q.y = H - q.r; q.vy = -Math.abs(q.vy) * 0.25; q.vx *= 0.9; }
        if (q.y < q.r - H * 0.1 && it === 3) { q.y = Math.max(q.y, q.r - H * 0.1); }
      }
    }
    for (i = 0; i < list.length; i++) {
      var p = list[i]; if (p.hold) continue;
      p.rot += p.vx * dt * 0.6; p.rot *= 0.97;
      var sz = p.r * 2.2;
      p.el.style.transform = p.el.style.webkitTransform = 'translate(' + (p.x - sz / 2).toFixed(1) + 'px,' + (p.y - sz / 2).toFixed(1) + 'px) rotate(' + p.rot.toFixed(1) + 'deg)';
    }
  }

  // ---------- book pages ----------
  function spriteOf(id) { for (var i = 0; i < roster.length; i++) if (roster[i].id === id) return roster[i]; return null; }
  // Left page: the sprite's name and its big Base sticker. Right page: "My collection" count + bar, then
  // that sprite's variant stickers (her layout, 2026-10-19 - no more grid of every Base on the right).
  function drawLeft(s, ev, hideVariant) {
    function slotHtml(v, size, extra) {
      var vi = vinfo(v), has = s.caught.indexOf(v) >= 0 && v !== hideVariant, art = artOf(s, v);
      return '<div class="slot' + (has ? ' has' : '') + (v === 'Gold' && !art ? ' gold' : '') + (extra || '') + '" data-v="' + esc(v) + '" style="width:' + size + 'em;margin:.3em .25em">' +
        '<div class="spot" style="width:' + size + 'em;height:' + size + 'em"><img src="' + esc(art || s.img || '') + '" alt=""></div>' +
        '<span class="lb" style="background:' + vi[1] + '">' + esc(vi[0]) + '</span></div>';
    }
    var bs = Math.max(7.6, Math.min(15, 7.6 * ((S && S.baseBook) || 100) / 100));
    $('pl').innerHTML = '<div class="pname">' + esc(s.name) + '</div><span class="rar" style="background:' + (RAR[s.rarity] || '#b77cff') + '">' + esc(s.rarity) + '</span>' +
      '<div class="slots" style="margin-top:' + Math.max(0, (19 - bs) / 2) + 'em">' + slotHtml(s.variants[0], bs, ' baseSlot') + '</div>';
    var nv = s.variants.length - 1, vs = nv > 6 ? 5.2 : nv > 3 ? 6.6 : 7.4, h = '';
    for (var i = 1; i < s.variants.length; i++) h += slotHtml(s.variants[i], vs);
    $('prVars').innerHTML = nv ? h : '<div class="onlyBase">This sprite only has a Base sticker.</div>';
    if (curId) pageNo();
  }
  function slotEl(v) { var a = book.querySelectorAll('.slot'); for (var i = 0; i < a.length; i++) if (a[i].getAttribute('data-v') === v) return a[i]; return null; }
  function drawRight(st, curId, minus) {
    var done = st.done - (minus || 0), pct = st.total ? done / st.total * 100 : 0;
    $('prHead').innerHTML = '<div class="ctitle">My collection</div><div class="bigNum" id="bn">' + done + ' <span>/ ' + st.total + ' stickers</span></div>' +
      '<div class="bar"><span id="barFill" style="width:' + pct.toFixed(1) + '%"></span></div>';
  }
  function caption(h) { var c = $('cap'); c.className = 'caption'; c.innerHTML = h; if (h) setTimeout(function () { c.className = 'caption on'; }, 30); }
  var isOpen = false, alive = false, curId = null, pageKey = '', autoT = 0;
  function propped() { return S && S.bookStyle === 'propped'; }
  var tempOpen = false;
  function shownOpen() { return !propped() || S.bookOpen || tempOpen; }
  function bookClass() { book.className = (S && S.bookTheme === 'spooky' ? 'spooky ' : '') + (propped() ? 'propped' + (alive ? ' alive' : '') + (shownOpen() ? '' : ' shut') : (isOpen ? 'open' : '')); }
  // The closed book: same spot as the open one, half as wide. It swings open on its spine.
  function placeShut(W, H, bw, bh) {
    var el = $('shut');
    if (!propped()) { el.style.display = 'none'; return; }
    el.style.display = 'block'; el.className = (S.bookTheme === 'spooky' ? '' : 'cute') + (alive ? ' glow' : '');
    var w = bw * 0.5; el.style.fontSize = (bw / 60) + 'px';
    el.style.width = w + 'px'; el.style.height = bh + 'px';
    el.style.left = (W * S.pbX / 100 + bw * 0.12) + 'px'; el.style.top = (H - H * S.pbB / 100 - bh) + 'px';
    var open = shownOpen();
    el.style.opacity = open ? '0' : '1';
    el.style.transform = el.style.webkitTransform = 'perspective(90em) rotateX(' + S.pbLean + 'deg) rotate(' + S.pbTilt + 'deg)' + (open ? ' rotateY(-100deg)' : '');
    $('shutTtl').textContent = S.title || 'Sprite Sticker Book';
    $('shutSea').textContent = season;
    $('shutCnt').textContent = stats ? stats.done + ' / ' + stats.total + ' stickers' : '';
    var r = spriteOf(recentId) || roster[0], im = r ? (artOf(r, r.variants[0]) || r.img) : '';
    if (im && $('shutImg').getAttribute('src') !== im) $('shutImg').src = im;
  }
  function openBook() { clearTimeout(closeT); isOpen = true; alive = true; fit(); }
  function closeLater(ms) {
    clearTimeout(closeT);
    closeT = setTimeout(function () {
      isOpen = false; alive = false; caption('');
      if (propped()) { var wasTemp = tempOpen; tempOpen = false; fit(); pageKey = ''; if (wasTemp && !S.bookOpen) setTimeout(next, 600); else next(); }
      else { fit(); setTimeout(next, 650); }
    }, propped() ? Math.min(ms, 6000) : ms);
  }
  // The page that shows when nothing is happening (propped book): the sprite she last turned to / caught.
  function idlePage(force) {
    if (busy || !roster.length || !stats) return;
    if (!curId || !spriteOf(curId)) curId = recentId && spriteOf(recentId) ? recentId : roster[0].id;
    var s = spriteOf(curId), key = curId + JSON.stringify(s.caught) + JSON.stringify(s.art) + stats.done;
    if (!force && key === pageKey) return; pageKey = key;
    drawLeft(s, null, null); drawRight(stats, s.id, 0);
  }
  function pageNo() { var i = 0; for (var j = 0; j < roster.length; j++) if (roster[j].id === curId) i = j; var e = document.createElement('div'); e.className = 'pgno'; e.textContent = '~ ' + (i + 1) + ' / ' + roster.length + ' ~'; $('pl').appendChild(e); }
  // Turn the page (with a page-flip), then call done. Same page = no flip.
  function turnTo(id, done, back) {
    if (!spriteOf(id)) { if (done) done(); return; }
    if (id === curId && $('pl').innerHTML) { if (done) done(); return; }
    curId = id; var pl = $('pl'); pl.className = 'page l'; void pl.offsetWidth; pl.className = 'page l ' + (back ? 'turnBack' : 'turn'); var pr = $('pr'); pr.className = 'page r'; void pr.offsetWidth; pr.className = 'page r swap';
    setTimeout(function () { var s = spriteOf(id); drawLeft(s, null, null); drawRight(stats, id, 0); pageKey = ''; }, 310);
    setTimeout(function () { pl.className = 'page l'; pr.className = 'page r'; if (done) done(); }, 640);
  }
  function stepId(dir) { var i = 0; for (var j = 0; j < roster.length; j++) if (roster[j].id === curId) i = j; return roster[(i + dir + roster.length) % roster.length].id; }
  setInterval(function () {   // optional: flip through the pages by itself when nothing is happening
    if (!S || !propped() || !S.pbAuto || busy || queue.length) { autoT = 0; return; }
    autoT += 1; if (autoT >= S.pbAuto) { autoT = 0; turnTo(stepId(1)); }
  }, 1000);

  // ---------- sparkles ----------
  function sparkle(x, y, n, spread) {
    var ch = ['✦', '✧', '★', '♥', '✨'];
    for (var i = 0; i < n; i++) (function () {
      var e = document.createElement('div'); e.className = 'spark'; e.textContent = ch[Math.floor(Math.random() * ch.length)];
      e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.color = ['#fff', '#ffd34d', '#ff8fd8', '#b8f0ff'][i % 4];
      fly.appendChild(e);
      setTimeout(function () { var a = Math.random() * Math.PI * 2, d = spread * (0.4 + Math.random() * 0.8);
        e.style.left = (x + Math.cos(a) * d) + 'px'; e.style.top = (y + Math.sin(a) * d) + 'px'; e.style.opacity = '0'; e.style.transform = 'scale(' + (0.5 + Math.random()) + ') rotate(' + (Math.random() * 180) + 'deg)'; }, 20);
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 1000);
    })();
  }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }

  // ---------- the show ----------
  function next() {
    busy = false;
    if (!queue.length) return;
    busy = true; play(queue.shift());
  }
  function play(ev) {
    if (ev.kind === 'turn') {
      var id = ev.sprite || stepId(ev.dir || 1);
      if (propped()) { turnTo(id, function () { next(); }, ev.dir < 0); return; }
      curId = id; var sp = spriteOf(id); if (!sp) return next();
      drawLeft(sp, null, null); drawRight(stats, id, 0); caption(''); openBook(); closeLater(S.bookSec * 1000); return;
    }
    var s = spriteOf(ev.sprite);
    if (!s) return next();
    if (propped() && !shownOpen()) {
      if (S.catchOpens || ev.kind === 'peek') { tempOpen = true; fit(); setTimeout(function () { play(ev); }, 650); return; }   // the book swings open for the catch
      if (ev.kind !== 'catch') return next();
    }
    if (propped() && shownOpen() && curId !== s.id) { turnTo(s.id, function () { play2(ev, s); }); return; }
    curId = s.id;
    play2(ev, s);
  }
  function play2(ev, s) {
    if (ev.stats) stats = ev.stats;
    var vi = vinfo(ev.variant);
    if (ev.kind === 'catch') {
      drawLeft(s, ev, ev.variant); drawRight(stats, s.id, (!ev.test && s.caught.indexOf(ev.variant) >= 0) ? 1 : 0); caption(''); openBook();
      var slot = slotEl(ev.variant); if (slot) slot.className += ' target';
      setTimeout(function () { flyIn(s, ev, slot); }, 750);
      return;
    }
    drawLeft(s, ev, null); drawRight(stats, s.id, 0); openBook();
    if (ev.kind === 'already') {
      var sl = slotEl(ev.variant); if (sl) sl.className += ' pulse';
      caption('<b>' + esc(s.name) + ' ' + esc(vi[0]) + '</b> is already in the book!');
    } else if (ev.kind === 'undo') {
      drawLeft({ name: s.name, rarity: s.rarity, img: s.img, art: s.art, variants: s.variants, caught: s.caught.concat([ev.variant]) }, ev, null);
      drawRight(stats, s.id, 0);
      setTimeout(function () { var su = slotEl(ev.variant); if (su) su.className += ' peel'; }, 500);
      caption('Sticker peeled off: ' + esc(s.name) + ' ' + esc(vi[0]));
    } else if (ev.kind === 'unknown') {
      caption('Which ' + esc(s.name) + '? ' + s.variants.map(function (v) { return vinfo(v)[0]; }).join(' · '));
    } else caption('');
    closeLater(S.bookSec * 1000);
  }
  function flyIn(s, ev, slot) {
    var bk = bodies[s.id + '|' + ev.variant] ? s.id + '|' + ev.variant : s.id, b = bodies[bk], start, size, art = artOf(s, ev.variant);
    var jr = jar.getBoundingClientRect(), ir = inner.getBoundingClientRect(), up, toy = null;
    if (isFloor()) {
      if (b) b = null;
      toy = toys[s.id + '|' + ev.variant] || toys[s.id];
      var fr = floorEl.getBoundingClientRect();
      if (toy) { start = { x: fr.left + toy.x, y: fr.top + toy.y - toy.sz / 2 }; size = toy.sz; toy.hidden = true; toy.el.style.visibility = 'hidden'; }
      else { start = { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 }; size = window.innerHeight * 0.085 * (S.toySize / 100); }
      up = { x: start.x, y: start.y - window.innerHeight * 0.16 };
    } else {
      if (b) { b.hold = true; start = { x: ir.left + b.x, y: ir.top + b.y }; size = b.r * 2.2; b.el.style.visibility = 'hidden'; }
      else { start = { x: jr.left + jr.width / 2, y: ir.top + ir.height * 0.6 }; size = ir.width * 0.3; }
      shake(ir.height * 0.6);
      up = { x: jr.left + jr.width / 2, y: jr.top - jr.height * 0.12 };
    }
    var tgt = slot && shownOpen() ? rectOf(slot.querySelector('.spot')) : rectOf(shownOpen() ? book : $('shut'));
    var endSize = slot ? tgt.w * 0.84 : size;
    var f = document.createElement('div'); f.className = 'flyer' + (ev.variant === 'Gold' && !art ? ' gold' : ''); f.innerHTML = '<img src="' + esc(art || s.img) + '" alt="">';
    fly.appendChild(f);
    var t0 = null, T1 = 650, T2 = 1150, lastSpark = 0;
    var ctrl = { x: (up.x + tgt.x) / 2, y: Math.min(up.y, tgt.y) - window.innerHeight * 0.22 };
    function place(x, y, sz, rot) { f.style.width = f.style.height = sz + 'px'; f.style.transform = f.style.webkitTransform = 'translate(' + (x - sz / 2) + 'px,' + (y - sz / 2) + 'px) rotate(' + rot + 'deg)'; }
    function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function step(ts) {
      if (t0 === null) t0 = ts;
      var t = ts - t0, x, y, sz, rot;
      if (t < T1) { var k = 1 - Math.pow(1 - t / T1, 3); x = start.x + (up.x - start.x) * k; y = start.y + (up.y - start.y) * k; sz = size * (1 + 0.6 * k); rot = Math.sin(t / 90) * 8; }
      else if (t < T1 + T2) {
        var u = ease((t - T1) / T2), a = 1 - u;
        x = a * a * up.x + 2 * a * u * ctrl.x + u * u * tgt.x; y = a * a * up.y + 2 * a * u * ctrl.y + u * u * tgt.y;
        sz = size * 1.6 + (endSize - size * 1.6) * u; rot = 360 * u;
      } else { land(); return; }
      place(x, y, sz, rot);
      if (ts - lastSpark > 90) { lastSpark = ts; sparkle(x, y, 2, size * 0.5); }
      requestAnimationFrame(step);
    }
    function land() {
      if (f.parentNode) f.parentNode.removeChild(f);
      if (b) { b.hold = false; b.el.style.visibility = ''; b.x = inner.clientWidth / 2; b.y = -b.r * 2; b.vy = 0; }
      if (toy) { toy.hidden = false; if (!(S.leaveCaught && !ev.test)) { toy.el.style.visibility = ''; toyAnim(toy, 'drop', 950); } }
      delete pinned[s.id + '|' + ev.variant]; delete pinned[s.id]; jarKey = ''; floorKey = ''; syncJar(); syncFloor();   // leaves the jar now if "caught stickers leave" is on
      var live = spriteOf(s.id) || s;
      drawLeft({ name: s.name, rarity: s.rarity, img: s.img, art: s.art, variants: s.variants, caught: live.caught.indexOf(ev.variant) >= 0 ? live.caught : live.caught.concat([ev.variant]) }, ev, null);
      var sl = slotEl(ev.variant); if (sl) sl.className += ' stick';
      drawRight(stats, s.id, 0);
      sparkle(tgt.x, tgt.y, 16, tgt.w * 1.1);
      var isBase = ev.variant === s.variants[0] && S.baseCelebrate;
      if (isBase && !ev.complete) setTimeout(function () { sparkle(tgt.x, tgt.y, 26, tgt.w * 1.8); }, 250);
      caption(ev.complete ? '⭐ <b>' + esc(s.name) + '</b> page complete! ⭐' : isBase ? '✨ New sprite: <b>' + esc(s.name) + '</b>! ✨' : '<b>' + esc(s.name) + ' ' + esc(vinfo(ev.variant)[0]) + '</b> sticker! ' + ev.have + ' / ' + ev.of);
      if (ev.complete) setTimeout(function () { var r = rectOf($('pl')); sparkle(r.x, r.y, 30, r.w * 0.7); }, 400);
      closeLater(S.bookSec * 1000);
    }
    requestAnimationFrame(step);
  }

  // ---------- sticker art: shrink her big PNGs to 256 px copies (once per file) ----------
  var making = false;
  function makeStickers(need) {
    if (making || !need.length) return;
    making = true;
    var job = need[0], img = new Image();
    var done = function () { making = false; };
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0);
        var px = x.getImageData(0, 0, w, h).data, a = w, b = h, cc = -1, dd = -1;
        for (var yy = 0; yy < h; yy += 2) for (var xx = 0; xx < w; xx += 2) if (px[(yy * w + xx) * 4 + 3] > 8) { if (xx < a) a = xx; if (xx > cc) cc = xx; if (yy < b) b = yy; if (yy > dd) dd = yy; }
        if (cc < 0) { a = 0; b = 0; cc = w - 1; dd = h - 1; }
        a = Math.max(0, a - 2); b = Math.max(0, b - 2); cc = Math.min(w - 1, cc + 2); dd = Math.min(h - 1, dd + 2);
        var cw = cc - a + 1, ch = dd - b + 1, sc = Math.min(1, 256 / Math.max(cw, ch)), o = document.createElement('canvas');
        o.width = Math.round(cw * sc); o.height = Math.round(ch * sc);
        var ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, a, b, cw, ch, 0, 0, o.width, o.height);
        var r = new XMLHttpRequest(); r.open('POST', '/api/sprites/jar/sticker', true); r.setRequestHeader('Content-Type', 'application/json');
        r.onreadystatechange = function () { if (r.readyState === 4) done(); };
        r.send(JSON.stringify({ id: job.id, variant: job.variant, dataUrl: o.toDataURL('image/webp', 0.9) }));
      } catch (e) { done(); }
    };
    img.onerror = done;
    img.src = job.src;
  }

  // ---------- data ----------
  function poll() {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sprites/jar' + (started ? '?since=' + last : '?first=1') + '&t=' + Date.now(), true);
    x.timeout = 5000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 200) {
        try {
          var d = JSON.parse(x.responseText);
          S = d.settings; roster = d.sprites || []; season = d.season || ''; recentId = d.recent; if (!busy) stats = d.stats;
          if (epoch !== null && S.epoch !== epoch) { queue = []; isOpen = false; alive = false; }
          epoch = S.epoch;
          if (!started) { last = d.last || 0; started = true; }
          else if (d.last < last) last = d.last;
          var evs = d.events || [];
          for (var i = 0; i < evs.length; i++) if (evs[i].id > last) { last = evs[i].id; if (evs[i].kind === 'shuffle') { mixUp(); continue; } queue.push(evs[i]); if (evs[i].kind === 'catch') { pinned[evs[i].sprite + '|' + evs[i].variant] = 1; pinned[evs[i].sprite] = 1; } }
          fit(); if (isFloor()) syncFloor(); else syncJar();
          makeStickers(d.needArt || []);
          if (!busy && queue.length) next();
          if (propped()) idlePage(); else if (!busy) pageKey = '';
        } catch (e) {}
      }
      setTimeout(poll, 800);
    };
    x.send();
  }
  $('jarBack').onload = fit;
  var prev = 0;
  function frame(ts) {
    var dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0.016; prev = ts;
    if (S && S.visible && !isFloor() && inner.clientWidth > 0) physics(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  poll();
})();
