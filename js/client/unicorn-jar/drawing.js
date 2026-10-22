// Drawing for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
// ---------------------------------------------------------------- drawing
  jarState.wakeAll = function wakeAll(){ for (var i = 0; i < jarState.bodies.length; i++) jarState.Sleeping.set(jarState.bodies[i], false); };


  jarState.rotateJarToward = function rotateJarToward(target, frac){
    var d = (target - jarState.J.angle) * frac;
    if (Math.abs(target - jarState.J.angle) < 0.002) d = target - jarState.J.angle;
    if (d !== 0) { jarState.Body.rotate(jarState.jar, d, jarState.J.pivot); jarState.J.angle += d; }
  };


  jarState.startFlight = function startFlight(b, ex, ey, dur, delay, scaleTo, arc, onDone){
    jarState.flights.push({ b: b, started: false, t0: Date.now() + (delay || 0), dur: dur, ex: ex, ey: ey,
      sx: 0, sy: 0, scaleFrom: b.renderScale || 1, scaleTo: scaleTo, arc: arc || 0, onDone: onDone });
  };


  jarState.ease = function ease(p){ return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; };


  jarState.updateFlights = function updateFlights(now){
    for (var i = jarState.flights.length - 1; i >= 0; i--) {
      var f = jarState.flights[i];
      if (jarState.bodies.indexOf(f.b) < 0) { jarState.flights.splice(i, 1); continue; }
      if (now < f.t0) continue;
      if (!f.started) {
        f.started = true; f.sx = f.b.position.x; f.sy = f.b.position.y;
        f.b.collisionFilter.mask = 0; jarState.Sleeping.set(f.b, false);
      }
      var p = Math.min(1, (now - f.t0) / f.dur), e = jarState.ease(p);
      jarState.Body.setPosition(f.b, { x: f.sx + (f.ex - f.sx) * e, y: f.sy + (f.ey - f.sy) * e - f.arc * Math.sin(Math.PI * p) });
      jarState.Body.setVelocity(f.b, { x: 0, y: 0 });
      f.b.renderScale = f.scaleFrom + (f.scaleTo - f.scaleFrom) * e;
      if (p >= 1) {
        jarState.flights.splice(i, 1);
        if (f.onDone) f.onDone(f.b);
      }
    }
  };


  jarState.release = function release(b){ b.collisionFilter.mask = jarState.DEFAULT_FILTER_MASK; jarState.Body.setVelocity(b, { x: 0, y: 1 }); };


  jarState.burstConfetti = function burstConfetti(x, y){
    var colors = ['#ff7ad9', '#c084fc', '#ffd36e', '#ffffff', '#ff4fb8'];
    for (var i = 0; i < 140; i++) {
      var a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 11;
      jarState.confetti.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, life: 1,
        size: 5 + Math.random() * 7, color: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 });
    }
  };


  jarState.setPhase = function setPhase(p, now){ jarState.phase = p; jarState.phaseStart = now; };

// Reset pressed mid-draw: stop the show, stand the jar back up.
  jarState.abortDraw = function abortDraw(){
    jarState.drawQueue = [];
    for (var i = 0; i < jarState.flights.length; i++) jarState.release(jarState.flights[i].b);
    jarState.flights = [];
    if (jarState.winnerBody) { jarState.winnerBody.renderScale = 1; jarState.release(jarState.winnerBody); }
    jarState.winnerBody = null; jarState.current = null; jarState.confetti = [];
    jarState.engine.gravity.y = 1;
    try { jarState.drawAudio.pause(); } catch (e) {}
    jarState.rotateJarToward(0, 1);
    jarState.wakeAll();
    jarState.setPhase('idle', Date.now());
  };


  jarState.buildRainList = function buildRainList(){
    // Baby (2026-09-26): the drawing now only uses the unicorns already in
    // the jar / on screen - no extra rain of everyone's rolled-over unicorns.
    // (Winner odds are still from everyone's full count, picked by ICB.)
    if (jarState.DRAW_JAR_ONLY) return [];
    var list = [], o, have, need, k;
    for (o in jarState.fullTotals) {
      if (!Object.prototype.hasOwnProperty.call(jarState.fullTotals, o)) continue;
      have = jarState.owners[o] ? jarState.owners[o].length : 0;
      need = jarState.fullTotals[o] - have;
      for (k = 0; k < need; k++) list.push(o);
    }
    for (var s2 = list.length - 1; s2 > 0; s2--) { var r2 = Math.floor(Math.random() * (s2 + 1)); var t2 = list[s2]; list[s2] = list[r2]; list[r2] = t2; }
    return list.slice(0, Math.max(0, jarState.MAX_BODIES - jarState.bodies.length));
  };


  jarState.rainOne = function rainOne(owner){
    var cw = jarState.cloudW();
    var x = Math.max(jarState.R, Math.min(jarState.W - jarState.R, jarState.cloud.x + (Math.random() - 0.5) * cw * 0.7));
    var b = jarState.makeUnicorn(owner, x, jarState.cloud.y + jarState.R * 0.6);
    jarState.Body.setVelocity(b, { x: (Math.random() - 0.5) * 4, y: 3 + Math.random() * 3 });
    jarState.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.4);
    if (Math.random() < 0.5) jarState.sparkleAt(x, jarState.cloud.y + jarState.R, 1);
  };

// Push anything still inside the tipped jar out through its mouth.
  jarState.spillJar = function spillJar(){
    var mx = Math.sin(jarState.J.angle), my = -Math.cos(jarState.J.angle);
    for (var i = 0; i < jarState.bodies.length; i++) {
      var b = jarState.bodies[i];
      if (jarState.isInJar(b) && Math.random() < 0.5) {
        jarState.Sleeping.set(b, false);
        var sp = 6 + Math.random() * 7;
        jarState.Body.setVelocity(b, { x: mx * sp + (Math.random() - 0.5) * 3, y: my * sp - (2 + Math.random() * 4) });
      }
    }
  };

// The lottery machine: a swirling wind that keeps everything airborne.
  jarState.lotteryMix = function lotteryMix(now, k){
    for (var i = 0; i < jarState.bodies.length; i++) {
      var b = jarState.bodies[i];
      if (b === jarState.winnerBody || b.collisionFilter.mask === 0) continue;
      jarState.Sleeping.set(b, false);
      var vx = b.velocity.x + Math.sin(b.position.y * 0.005 + now * 0.0021 + b.id) * 0.9 * k + (Math.random() - 0.5) * 0.8 * k;
      var vy = b.velocity.y + Math.cos(b.position.x * 0.005 + now * 0.0017 + b.id * 0.7) * 0.9 * k + (Math.random() - 0.5) * 0.8 * k;
      if (b.position.y > jarState.H - jarState.R * 3.5 && Math.random() < 0.12 * k) vy = -(10 + Math.random() * 12);
      var sp = Math.sqrt(vx * vx + vy * vy), max = 20;
      if (sp > max) { vx *= max / sp; vy *= max / sp; }
      jarState.Body.setVelocity(b, { x: vx, y: vy });
      if (Math.random() < 0.05) jarState.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.6);
    }
  };


  jarState.updateDraw = function updateDraw(now){
    if (jarState.phase === 'idle') {
      if (!jarState.drawQueue.length) return;
      jarState.current = jarState.drawQueue.shift();
      jarState.winnerBody = null;
      jarState.wakeAll();
      jarState.rainList = jarState.buildRainList(); jarState.rainSpawned = 0; jarState.rainStartedAt = now;
      jarState.cloud.inited = true; jarState.cloud.x = jarState.W / 2;
      jarState.current.mixMs = jarState.mixMsFor(); // lock in the target for this drawing (song may still be loading)
      jarState.playSound(jarState.drawAudio);
      jarState.setPhase('rain', now);
      return;
    }
    var t = now - jarState.phaseStart;

    if (jarState.phase === 'rain') {
      // Jar tips and spills while the cloud rains every unicorn on file.
      jarState.rotateJarToward(jarState.J.tipAngle, t < jarState.TIP_MS ? 0.09 : 1);
      if (t > jarState.TIP_MS * 0.6) jarState.spillJar();
      var due = Math.min(jarState.rainList.length, Math.ceil(jarState.rainList.length * Math.min(1, t / (jarState.RAIN_MS - 1000))));
      while (jarState.rainSpawned < due) jarState.rainOne(jarState.rainList[jarState.rainSpawned++]);
      jarState.cloud.lastUse = now;
      if (t > jarState.RAIN_MS) { jarState.engine.gravity.y = 0.35; jarState.swirlAccents(160, jarState.current.mixMs + jarState.COUNTDOWN_MS); jarState.setPhase('mix', now); }
      return;
    }

    if (jarState.phase === 'mix') {
      jarState.spillJar();
      jarState.lotteryMix(now, 0.8 + 0.4 * Math.min(1, t / 1500));
      if (t > jarState.current.mixMs) jarState.setPhase('countdown', now);
      return;
    }

    if (jarState.phase === 'countdown') {
      jarState.lotteryMix(now, 1.2 + 0.6 * (t / jarState.COUNTDOWN_MS));
      if (t > jarState.COUNTDOWN_MS) { jarState.engine.gravity.y = 1; jarState.setPhase('rise', now); }
      return;
    }

    if (jarState.phase === 'rise') {
      if (t === 0 || !jarState.current.riseStarted) {
        jarState.current.riseStarted = true;
        jarState.playSound(jarState.winnerAudio);
        var pool = jarState.owners[jarState.current.username] || [];
        jarState.winnerBody = pool.length ? pool[Math.floor(Math.random() * pool.length)]
                   : (jarState.bodies.length ? jarState.bodies[Math.floor(Math.random() * jarState.bodies.length)] : null);
        if (jarState.winnerBody) {
          jarState.startFlight(jarState.winnerBody, jarState.W / 2, jarState.H * 0.3, jarState.RISE_MS, 0, 4.2, 60, function(){
            jarState.burstConfetti(jarState.W / 2, jarState.H * 0.3);
            jarState.sparkleAt(jarState.W / 2, jarState.H * 0.3, 40);
          });
        } else {
          jarState.burstConfetti(jarState.W / 2, jarState.H * 0.3);
        }
        jarState.current.bannerAt = now + (jarState.winnerBody ? jarState.RISE_MS : 0);
      }
      if (jarState.winnerBody) {
        // Hold it in place (flight finished) while the banner shows.
        if (!jarState.flightFor(jarState.winnerBody)) { jarState.Body.setPosition(jarState.winnerBody, { x: jarState.W / 2, y: jarState.H * 0.3 + Math.sin(now / 300) * 6 }); jarState.Body.setVelocity(jarState.winnerBody, { x: 0, y: 0 }); }
      }
      // (No cut-off here any more - the song plays on to its end; see songFadeTick.)
      if (now > jarState.current.bannerAt + jarState.BANNER_MS) {
        if (jarState.winnerBody) {
          var wb = jarState.winnerBody;
          jarState.startFlight(wb, jarState.W / 2, jarState.H * 0.3, 500, 0, 1, 0, function(b){ jarState.release(b); });
        }
        jarState.setPhase('gather', now);
        jarState.startGather(now);
      }
      return;
    }

    if (jarState.phase === 'gather') {
      // Extra (rolled-over) unicorns float back up into the cloud.
      if (t > 500) jarState.winnerBody = null;
      if (t > jarState.GATHER_MS && !jarState.flights.length) { jarState.setPhase('upright', now); }
      return;
    }

    if (jarState.phase === 'upright') {
      jarState.rotateJarToward(0, 0.08);
      if (t > jarState.UPRIGHT_MS) { jarState.rotateJarToward(0, 1); jarState.wakeAll(); jarState.setPhase('refill', now); jarState.startRefill(now); }
      return;
    }

    if (jarState.phase === 'refill') {
      if (now > jarState.refillEndsAt && !jarState.flights.length) {
        jarState.setPhase('idle', now); jarState.current = null;
        if (jarState.lastG) jarState.applyState(jarState.lastG, false); // catch up on anything earned during the drawing
      }
    }
  };

// After the reveal, only this stream's unicorns stay; the rest fly home.
  jarState.startGather = function startGather(now){
    var keep = (jarState.lastG && jarState.lastG.jar && jarState.lastG.jar.counts) ? jarState.lastG.jar.counts : null;
    if (!keep) return;
    var cw = jarState.cloudW(), n = 0, o, list, extra, i;
    for (o in jarState.owners) {
      if (!Object.prototype.hasOwnProperty.call(jarState.owners, o)) continue;
      list = jarState.owners[o].slice();
      // Prefer sending home the ones that are highest up / furthest from the jar.
      list.sort(function(a, b){ return a.position.y - b.position.y; });
      extra = list.length - (keep[o] || 0);
      for (i = 0; i < extra; i++) {
        (function(b, k){
          jarState.startFlight(b, jarState.W / 2 + (Math.random() - 0.5) * cw * 0.5, Math.max(60, cw * 0.28), 900, Math.min(1500, k * 6), 0.35, 80, function(bb){ jarState.removeUnicorn(bb); });
        })(list[i], n++);
      }
    }
  };


  jarState.flightFor = function flightFor(b){ for (var i = 0; i < jarState.flights.length; i++) if (jarState.flights[i].b === b) return jarState.flights[i]; return null; };


  jarState.startRefill = function startRefill(now){
    var need = jarState.J.capacity - jarState.inJarCount();
    var outside = [];
    for (var i = 0; i < jarState.bodies.length; i++) if (!jarState.isInJar(jarState.bodies[i])) outside.push(jarState.bodies[i]);
    outside.sort(function(a, b){
      return Math.abs(a.position.x - jarState.J.cx) + (jarState.H - a.position.y) * 0.5 - (Math.abs(b.position.x - jarState.J.cx) + (jarState.H - b.position.y) * 0.5);
    });
    var n = Math.min(need, outside.length);
    for (var k = 0; k < n; k++) {
      var ex = jarState.J.mouthLeft + jarState.R + Math.random() * Math.max(1, jarState.J.mouthRight - jarState.J.mouthLeft - 2 * jarState.R);
      jarState.startFlight(outside[k], ex, jarState.J.innerTop - jarState.R * 2 - (k % 4) * jarState.R, 650, k * 30, 1, 120, jarState.release);
    }
    jarState.refillEndsAt = now + n * 30 + 650 + 1500;
  };
})(window.ICBJar);
