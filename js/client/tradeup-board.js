(function(){
  // Full-screen Meld overlay. Every plushie in the catalog (config/tradeup-
  // game.json, the same 30-slot "board" the old marquee page used) sits in a
  // physics jar. Pressing "Spin" on tradeup-control.html tips the jar over,
  // the plushies roll and bounce around like lottery balls, then the one the
  // server already picked (tradeup.revealed) rises up center-screen with its
  // name. "Shuffle" swaps in a fresh 30 from the catalog.
  //
  // IMPORTANT: the server (tradeupSpin() in server.js) already decided the
  // winner the moment Spin was pressed - this page only animates the result.
  // Kept the same filename/route (tradeup-board.html, /api/tradeup/state) as
  // the original marquee board (Baby, 2026-09-26: "restyle it as a jar") so
  // an already-added Meld browser source URL keeps working unchanged.
  //
  // Plain ES5 + XHR polling, same rules as every other Meld overlay here.
  // Physics: Matter.js 0.20.0 (MIT), served locally as matter.min.js.

  var M = Matter, Engine = M.Engine, Bodies = M.Bodies, Body = M.Body,
      Composite = M.Composite, Sleeping = M.Sleeping;

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var W = window.innerWidth || 1920, H = window.innerHeight || 1080;
  canvas.width = W; canvas.height = H;

  // Same jar art as unicorn-jar.html - it's just a glass jar, reusable for
  // any prize. Both files are served from the ICB root, so the same
  // relative path works here too.
  var JAR_IMG_W = 1024, JAR_IMG_H = 1536;
  var FRONT_FALLBACK_ALPHA = 0.55;
  var JAR_BACK = new Image(), JAR_FRONT = new Image();
  var frontUsable = false;
  JAR_BACK.src = 'assets/resources/JAR_BACK.png';
  JAR_FRONT.onload = function(){
    try {
      var probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
      var pc = probe.getContext('2d');
      pc.drawImage(JAR_FRONT, 4, 4, 1, 1, 0, 0, 1, 1);
      frontUsable = pc.getImageData(0, 0, 1, 1).data[3] < 20;
    } catch (e) { frontUsable = false; }
  };
  JAR_FRONT.src = 'assets/resources/JAR_FRONT.png';

  var R = 30; // item body radius - bigger than a unicorn's since these carry a photo
  var MAX_BODIES = 200; // the catalog board is only ever 30 - this is just a safety cap
  var TIP_MS = 1300, MIX_MS = 4200, UPRIGHT_MS = 1300, RISE_MS = 1000, BANNER_MS = 99999999;
  var DEFAULT_FILTER_MASK = 0xFFFFFFFF;
  var FONT = '"Baloo 2","Comic Sans MS","Trebuchet MS",sans-serif';

  var engine = null, world = null, jar = null;
  var J = {};
  var bodies = []; // bodies[i] always matches board[i] - see applyBoard()
  var board = [];
  var lastBoardKey = null;
  var phase = 'idle', phaseStart = 0;
  var winnerBody = null, winnerAt = 0;
  var lastSpinSeq = -1;
  var flights = [];
  var imageCache = {};

  function getImg(url){
    if (!url) return null;
    if (!imageCache[url]) { var im = new Image(); im.src = url; imageCache[url] = im; }
    return imageCache[url];
  }

  // ------------------------------------------------------------------ setup
  function init(){
    engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1;
    engine.positionIterations = 8;
    engine.velocityIterations = 6;
    world = engine.world;

    var wallOpts = { isStatic: true, friction: 0.2, restitution: 0.2 };
    Composite.add(world, [
      Bodies.rectangle(W / 2, H + 100, W * 3, 200, wallOpts),
      Bodies.rectangle(-100, H / 2, 200, H * 4, wallOpts),
      Bodies.rectangle(W + 100, H / 2, 200, H * 4, wallOpts),
      Bodies.rectangle(W / 2, -R * 8 - 100, W * 3, 200, wallOpts)
    ]);

    // Same math as unicorn-jar.html's init(), just always centered - this
    // page is its own dedicated Meld layer, so Baby positions/sizes the
    // whole layer in Meld rather than picking a side here.
    var js = Math.min((H * 0.7) / JAR_IMG_H, (W * 0.4) / JAR_IMG_W);
    var jarW = JAR_IMG_W * js;
    var t = Math.max(10, 30 * js);
    var cx = W / 2;
    var ox = cx - jarW / 2, oy = H - 1460 * js;
    function P(x, y){ return { x: ox + x * js, y: oy + y * js }; }

    J = {
      s: js, ox: ox, oy: oy, cx: cx, w: jarW, h: JAR_IMG_H * js, t: t,
      left: P(13, 0).x, right: P(1011, 0).x, top: P(0, 13).y, bottom: H,
      innerLeft: P(80, 0).x, innerRight: P(944, 0).x,
      bodyTop: P(0, 430).y, innerBottom: P(0, 1322).y,
      mouthLeft: P(190, 0).x, mouthRight: P(834, 0).x, innerTop: P(0, 40).y,
      angle: 0
    };
    J.cols = Math.max(1, Math.floor((J.innerRight - J.innerLeft) / (2 * R)));
    J.rows = Math.max(1, Math.floor((J.innerBottom - J.bodyTop) / (2 * R)));
    J.capacity = J.cols * J.rows;
    J.tipDir = -1;
    J.pivot = P(60, 1460);
    J.tipAngle = 1.68 * J.tipDir;

    var jarOpts = { isStatic: true, friction: 0.05, restitution: 0.3 };
    function seg(x1, y1, x2, y2){
      var a = P(x1, y1), b = P(x2, y2);
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
      return Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + t, t, { isStatic: true, angle: Math.atan2(dy, dx), friction: 0.05, restitution: 0.3 });
    }
    var parts = [
      seg(80, 1337, 944, 1337), seg(64, 1330, 64, 430), seg(64, 430, 170, 228),
      seg(170, 228, 170, 40), seg(960, 1330, 960, 430), seg(960, 430, 854, 228),
      seg(854, 228, 854, 40)
    ];
    jar = Body.create({ parts: parts, isStatic: true });
    Composite.add(world, jar);
  }

  // -------------------------------------------------------------- item bodies
  function makeItemBody(boxEntry, x, y){
    var b = Bodies.circle(x, y, R, {
      restitution: 0.45, friction: 0.03, frictionStatic: 0.3, frictionAir: 0.012,
      density: 0.0015, sleepThreshold: 45
    });
    Body.setAngle(b, (Math.random() - 0.5) * 0.6); // items keep mostly upright, unlike tumbling unicorns
    b.box = boxEntry;
    b.renderScale = 1;
    Composite.add(world, b);
    return b;
  }

  function clearAll(){
    for (var i = 0; i < bodies.length; i++) if (bodies[i]) Composite.remove(world, bodies[i]);
    bodies = [];
    flights = [];
    winnerBody = null;
  }

  function toJarLocal(p){
    var a = -J.angle, dx = p.x - J.pivot.x, dy = p.y - J.pivot.y;
    return { x: J.pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: J.pivot.y + dx * Math.sin(a) + dy * Math.cos(a) };
  }
  function isInJar(b){
    var p = toJarLocal(b.position);
    return p.x > J.innerLeft && p.x < J.innerRight && p.y > J.innerTop - R && p.y < J.innerBottom + R;
  }

  // Lay all 30 board items into the jar at once and let physics settle them
  // before the first frame - same trick unicorn-jar.html uses on first load.
  function placeInstantly(list){
    var i, b;
    for (i = 0; i < list.length && i < MAX_BODIES; i++) {
      var col = i % J.cols, row = Math.floor(i / J.cols);
      b = makeItemBody(list[i], J.innerLeft + R + col * 2 * R + (Math.random() - 0.5) * R * 0.6, J.innerBottom - R - row * 2.2 * R - Math.random() * R);
      bodies.push(b);
    }
    for (i = 0; i < 300; i++) Engine.update(engine, 1000 / 60);
  }

  function boardKeyOf(b){
    var parts = [];
    for (var i = 0; i < b.length; i++) parts.push(b[i].item ? b[i].item.id : 'empty');
    return parts.join(',');
  }

  // Board changed (fresh deal / Shuffle) - clear the jar and re-place the
  // new 30. bodies[i] is kept in the same order as board[i] the whole time
  // so a later reveal.position can look up its body directly.
  function applyBoard(newBoard){
    board = newBoard || [];
    var key = boardKeyOf(board);
    if (key === lastBoardKey && bodies.length) return;
    lastBoardKey = key;
    clearAll();
    placeInstantly(board);
    phase = 'idle';
  }

  // ---------------------------------------------------------------- drawing
  function wakeAll(){ for (var i = 0; i < bodies.length; i++) if (bodies[i]) Sleeping.set(bodies[i], false); }
  function setPhase(p, now){ phase = p; phaseStart = now; }

  function rotateJarToward(target, frac){
    J.angle += (target - J.angle) * frac;
    Body.setAngle(jar, J.angle);
  }

  function spillJar(){
    var mx = Math.sin(J.angle), my = -Math.cos(J.angle);
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!b || b === winnerBody) continue;
      if (isInJar(b) && Math.random() < 0.5) {
        Sleeping.set(b, false);
        var sp = 6 + Math.random() * 7;
        Body.setVelocity(b, { x: mx * sp + (Math.random() - 0.5) * 3, y: my * sp - (2 + Math.random() * 4) });
      }
    }
  }

  function lotteryMix(now, k){
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!b || b === winnerBody || b.collisionFilter.mask === 0) continue;
      Sleeping.set(b, false);
      var vx = b.velocity.x + Math.sin(b.position.y * 0.005 + now * 0.0021 + b.id) * 0.9 * k + (Math.random() - 0.5) * 0.8 * k;
      var vy = b.velocity.y + Math.cos(b.position.x * 0.005 + now * 0.0017 + b.id * 0.7) * 0.9 * k + (Math.random() - 0.5) * 0.8 * k;
      if (b.position.y > H - R * 3.5 && Math.random() < 0.12 * k) vy = -(10 + Math.random() * 12);
      var sp = Math.sqrt(vx * vx + vy * vy), max = 20;
      if (sp > max) { vx *= max / sp; vy *= max / sp; }
      Body.setVelocity(b, { x: vx, y: vy });
    }
  }

  function startFlight(b, ex, ey, dur, onDone){
    flights.push({ b: b, t0: Date.now(), dur: dur, sx: b.position.x, sy: b.position.y, ex: ex, ey: ey, onDone: onDone });
  }
  function ease(p){ return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function updateFlights(now){
    for (var i = flights.length - 1; i >= 0; i--) {
      var f = flights[i], t = Math.min(1, (now - f.t0) / f.dur), e = ease(t);
      Body.setStatic(f.b, true);
      Body.setPosition(f.b, { x: f.sx + (f.ex - f.sx) * e, y: f.sy + (f.ey - f.sy) * e - Math.sin(e * Math.PI) * 90 });
      if (t >= 1) { flights.splice(i, 1); if (f.onDone) f.onDone(); }
    }
  }

  // A winner currently in the air/holding position needs its filter mask
  // cleared so the mix doesn't fling it back into the crowd.
  function release(b){ b.collisionFilter.mask = 0; }
  function restore(b){ b.collisionFilter.mask = DEFAULT_FILTER_MASK; Body.setStatic(b, false); }

  function abortDraw(){
    setPhase('idle', Date.now());
    engine.gravity.y = 1;
    if (winnerBody) { restore(winnerBody); winnerBody = null; }
    flights = [];
    rotateJarToward(0, 1);
    wakeAll();
  }

  var pendingReveal = null;

  function updateDraw(now){
    if (phase === 'idle') return;
    var t = now - phaseStart;

    if (phase === 'tip') {
      rotateJarToward(J.tipAngle, t < TIP_MS ? 0.09 : 1);
      if (t > TIP_MS * 0.6) spillJar();
      if (t > TIP_MS) { engine.gravity.y = 0.35; setPhase('mix', now); }
      return;
    }

    if (phase === 'mix') {
      spillJar();
      lotteryMix(now, 0.8 + 0.4 * Math.min(1, t / 1500));
      if (t > MIX_MS) setPhase('settle', now);
      return;
    }

    if (phase === 'settle') {
      engine.gravity.y += (1 - engine.gravity.y) * 0.08;
      rotateJarToward(0, t < UPRIGHT_MS ? 0.09 : 1);
      wakeAll();
      if (t > UPRIGHT_MS) {
        // Find the picked body and float it up center-screen with a banner.
        var picked = pendingReveal;
        pendingReveal = null;
        var b = (picked != null && bodies[picked.position]) ? bodies[picked.position] : null;
        if (b) {
          winnerBody = b;
          release(b);
          var self = { bannerAt: 0 };
          winnerBanner = { item: picked.item, kind: picked.kind, bannerAt: now + RISE_MS };
          startFlight(b, W / 2, H * 0.32, RISE_MS, function(){});
        }
        setPhase('reveal', now);
      }
      return;
    }

    if (phase === 'reveal') {
      // Holds here (winner elevated, banner showing) until the server's
      // spinSeq changes again - onState() below drives the next transition.
      return;
    }
  }

  var winnerBanner = null;

  // -------------------------------------------------------------- rendering
  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function jarTransform(){ ctx.translate(J.pivot.x, J.pivot.y); ctx.rotate(J.angle); ctx.translate(-J.pivot.x, -J.pivot.y); }
  function drawJarImage(img, alpha){
    if (!img.complete || !img.naturalWidth) return;
    ctx.save(); jarTransform();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, J.ox, J.oy, JAR_IMG_W * J.s, JAR_IMG_H * J.s);
    ctx.restore();
  }
  var FRONT_SHEEN_ALPHA = 0.3;
  function drawJarBack(){ drawJarImage(JAR_BACK, 1); }
  function drawJarFront(){
    if (frontUsable) {
      if (FRONT_SHEEN_ALPHA > 0) drawJarImage(JAR_BACK, FRONT_SHEEN_ALPHA);
      drawJarImage(JAR_FRONT, 1);
    } else drawJarImage(JAR_BACK, FRONT_FALLBACK_ALPHA);
  }

  // Baby (2026-09-27): show the actual plushie photo as-is - no circular
  // crop/frame around it, and no name text on or under it. The physics body
  // underneath is still a circle (that's just for the bouncing/rolling), but
  // what's drawn is the real image, uncropped, sized up a bit past the
  // body's diameter so it reads clearly instead of looking shrunk down.
  function drawItem(b, glow){
    var box = b.box, item = box && box.item;
    var s = b.renderScale || 1, d = R * 2 * s * 1.5;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(glow ? Math.sin(Date.now() / 400) * 0.1 : b.angle);
    if (glow) { ctx.shadowColor = 'rgba(255,215,110,1)'; ctx.shadowBlur = 45; }
    var img = item ? getImg(item.image) : null;
    if (img && img.complete && img.naturalWidth) {
      // object-fit: contain - the real photo, full shape, not cropped.
      var scale = Math.min(d / img.naturalWidth, d / img.naturalHeight);
      var iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    } else {
      // No art yet for this one - a plain soft square, still no text on it.
      var rr = d * 0.18;
      ctx.beginPath();
      ctx.moveTo(-d / 2 + rr, -d / 2);
      ctx.arcTo(d / 2, -d / 2, d / 2, d / 2, rr);
      ctx.arcTo(d / 2, d / 2, -d / 2, d / 2, rr);
      ctx.arcTo(-d / 2, d / 2, -d / 2, -d / 2, rr);
      ctx.arcTo(-d / 2, -d / 2, d / 2, -d / 2, rr);
      ctx.closePath();
      ctx.fillStyle = 'rgba(90,60,140,0.9)'; ctx.fill();
    }
    ctx.restore();
  }

  function drawBanner(now){
    if (!winnerBanner || !winnerBody) return;
    var age = now - (phaseStart);
    if (phase !== 'reveal') return;
    var alpha = Math.min(1, (now - (winnerBanner.bannerAt)) / 300);
    if (alpha <= 0) return;
    var item = winnerBanner.item;
    var name = item ? item.name : 'Empty box';
    var sub = (item && item.type === 'points') ? (item.points + ' Channel Points') : '';
    var cy = H * 0.32 + R * 1.6 + 60;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var nameSize = 60;
    ctx.font = '900 ' + nameSize + 'px ' + FONT;
    while (ctx.measureText(name).width > W * 0.6 && nameSize > 28) { nameSize -= 4; ctx.font = '900 ' + nameSize + 'px ' + FONT; }
    var boxW = Math.max(ctx.measureText(name).width + 100, 480), boxH = nameSize + (sub ? 110 : 80);
    roundRect(W / 2 - boxW / 2, cy - 30, boxW, boxH, 30);
    var bg = ctx.createLinearGradient(0, cy - 30, 0, cy - 30 + boxH);
    bg.addColorStop(0, 'rgba(150,30,150,0.9)'); bg.addColorStop(1, 'rgba(90,20,140,0.9)');
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,215,130,0.95)';
    ctx.shadowColor = 'rgba(255,200,110,0.9)'; ctx.shadowBlur = 25; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.font = '800 26px ' + FONT; ctx.fillStyle = '#ffe9c9';
    ctx.fillText('THE PICK IS...', W / 2, cy);
    ctx.font = '900 ' + nameSize + 'px ' + FONT; ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,120,230,1)'; ctx.shadowBlur = 20;
    ctx.fillText(name, W / 2, cy + 20 + nameSize / 2);
    ctx.shadowBlur = 0;
    if (sub) { ctx.font = '800 24px ' + FONT; ctx.fillStyle = '#ffe3fb'; ctx.fillText(sub, W / 2, cy + nameSize + 55); }
    ctx.restore();
  }

  function render(now){
    ctx.clearRect(0, 0, W, H);
    if (!engine) return;
    drawJarBack();
    for (var i = 0; i < bodies.length; i++) if (bodies[i] && bodies[i] !== winnerBody) drawItem(bodies[i], false);
    drawJarFront();
    if (winnerBody) drawItem(winnerBody, true);
    drawBanner(now);
  }

  function frame(){
    var now = Date.now();
    if (engine) { updateDraw(now); updateFlights(now); Engine.update(engine, 1000 / 60); }
    render(now);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------- data
  var hasLoadedOnce = false;
  function onState(state){
    if (!engine) init();
    applyBoard(state.board);

    if (state.revealed) {
      if (state.spinSeq === lastSpinSeq) return; // already showing/animating this exact spin
      lastSpinSeq = state.spinSeq;
      if (!hasLoadedOnce) {
        // Page just loaded onto an already-resolved spin - show it instantly.
        var b0 = bodies[state.revealed.position];
        if (b0) { winnerBody = b0; release(b0); Body.setStatic(b0, true); Body.setPosition(b0, { x: W / 2, y: H * 0.32 }); }
        winnerBanner = { item: state.revealed.item, kind: state.revealed.kind, bannerAt: 0 };
        setPhase('reveal', Date.now());
      } else {
        pendingReveal = state.revealed;
        winnerBody = null;
        winnerBanner = null;
        wakeAll();
        setPhase('tip', Date.now());
      }
    } else {
      if (state.spinSeq === lastSpinSeq) { hasLoadedOnce = true; return; }
      lastSpinSeq = state.spinSeq;
      if (phase !== 'tip' && phase !== 'mix' && phase !== 'settle') abortDraw();
    }
    hasLoadedOnce = true;
  }

  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/tradeup/state?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4 || x.status !== 200) return;
      try { var d = JSON.parse(x.responseText); if (d) onState(d); } catch (e) {}
    };
    x.send();
  }

  poll();
  setInterval(poll, 1500);
  requestAnimationFrame(frame);
})();
