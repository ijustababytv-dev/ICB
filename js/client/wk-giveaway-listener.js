(function(){
  // Invisible utility layer, not meant to be seen on stream. Add this as a
  // Meld layer (any size - shrink it to a corner or hide it) so the
  // Firehose SDK can pick up the connection token Meld provides to its own
  // browser layers. This page does NO ticket math itself - it just relays
  // raw events to ICB, which does all the real logic (server.js, "STREAM
  // GIVEAWAY"). Plain ES5 only, same rule as every other Meld-hosted page.
  //
  // Event shapes checked against Meld's own firehose.js (v2) on 2026-09-25:
  //   chat  = the raw RICH_MESSAGE. Cheers ride along in msg.donations as
  //           { type: "TWITCH_BITS", amount, count }. Meld itself ignores
  //           those parts on HIGHLIGHTED / ANNOUNCEMENT messages; so do we.
  //   sub   = SUBSCRIPTION (new sub or RESUB, NOT gifted). months_purchased
  //           is 1 normally, more when someone buys several months at once.
  //   gifts = Meld bundles gifted subs into one event: { gifter, anonymous,
  //           count, recipients }. Gifted subs never arrive as "sub".
  //   follow = FOLLOW { follower }; raid = RAID { host, viewers } - relayed
  //           for the nightly report only, they don't earn unicorns.
  //   purchase = shop purchases (e.g. Fourthwall), NOT bits - not used.
  var statusEl = document.getElementById('status');
  var firehose = null;
  var BIT_TYPES = { TWITCH_BITS: true };
  var SKIP_ATTRS = { HIGHLIGHTED: true, ANNOUNCEMENT: true };

  function setStatus(text){ if (statusEl) { statusEl.textContent = text; } }

  function post(path, payload){
    try {
      var x = new XMLHttpRequest();
      x.open('POST', path, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(payload));
    } catch (e) { /* best-effort - a dropped event is one fewer unicorn, not a crash */ }
  }

  function usernameOf(user){
    if (!user) { return ''; }
    return user.displayname || user.username || '';
  }

  // Shrink an event for the log: user objects become just their name, long
  // strings are trimmed, big lists capped (the viewer list keeps every name).
  var DROP_KEYS = { image_link: true, profile_image_url: true, avatar: true, streamer: true, badges_images: true };
  function compact(v, depth, kind){
    if (v === null || v === undefined) { return v; }
    if (typeof v === 'string') { return v.length > 500 ? v.slice(0, 500) + '...' : v; }
    if (typeof v === 'number' || typeof v === 'boolean') { return v; }
    if (depth > 4) { return undefined; }
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var cap = (kind === 'viewer_list') ? 5000 : 40, out = [];
      for (var i = 0; i < v.length && i < cap; i++) { out.push(compact(v[i], depth + 1, kind)); }
      if (v.length > cap) { out.push('+' + (v.length - cap) + ' more'); }
      return out;
    }
    if (typeof v === 'object') {
      if (typeof v.displayname === 'string' && depth > 0) { return v.displayname; }
      var o = {};
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k) || DROP_KEYS[k]) { continue; }
        if (kind === 'gifts' && k === 'events') { continue; } // the bundle already lists recipients
        var c = compact(v[k], depth + 1, kind);
        if (c !== undefined) { o[k] = c; }
      }
      return o;
    }
    return undefined;
  }

  function bitsIn(msg){
    if (!msg || !msg.donations || !msg.donations.length) { return 0; }
    var attrs = msg.attributes || [];
    for (var a = 0; a < attrs.length; a++) { if (SKIP_ATTRS[String(attrs[a])]) { return 0; } }
    var total = 0;
    for (var i = 0; i < msg.donations.length; i++) {
      var d = msg.donations[i];
      if (!d || !BIT_TYPES[d.type]) { continue; }
      var count = (typeof d.count === 'number' && d.count > 0) ? Math.floor(d.count) : 1;
      if (typeof d.amount === 'number' && d.amount > 0) { total += Math.round(d.amount) * count; }
    }
    return total;
  }

  // Tell ICB we're alive (and whether Meld's connection is open) so the
  // dashboard can show a green "listener connected" badge.
  // Self-repair: if Meld's connection hasn't been open for 90 s straight,
  // reload this page (same as right-click > reload in Meld). ICB Home's
  // "Reload the listener" button asks for the same thing through the
  // heartbeat reply. Meld's history replay on reconnect is skipped below,
  // so a reload never double-counts anything.
  var notConnectedSince = new Date().getTime();
  var SELF_RELOAD_MS = 90000;
  function reloadMe(){ setStatus('reloading...'); setTimeout(function(){ location.reload(); }, 300); }

  function heartbeat(){
    var state = !firehose ? 'no-sdk' : (firehose.socketOpen ? 'connected' : 'connecting');
    var now = new Date().getTime();
    if (state === 'connected') { notConnectedSince = now; }
    else if (now - notConnectedSince > SELF_RELOAD_MS) { notConnectedSince = now; reloadMe(); return; }
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/giveaway/listener', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onreadystatechange = function(){
        if (x.readyState !== 4 || x.status !== 200) { return; }
        try { if (JSON.parse(x.responseText).reload === true) { reloadMe(); } } catch (e) {}
      };
      x.send(JSON.stringify({ firehose: state, page: String(location.href).slice(0, 200) }));
    } catch (e) {}
    setStatus(state === 'connected' ? 'connected to Meld, relaying to ICB' : (state === 'connecting' ? 'waiting for Meld...' : 'Firehose SDK not loaded'));
  }

  var bootAttempts = 0;
  function reloadSdk(){
    try {
      var sc = document.createElement('script');
      sc.src = 'https://elements.meldstudio.co/cdn/v2/firehose.js';
      document.getElementsByTagName('head')[0].appendChild(sc);
    } catch (e) {}
  }
  function boot(){
    bootAttempts++;
    if (typeof Firehose === 'undefined') {
      // Keep telling ICB we're alive while we wait, so the dashboard shows
      // "Firehose didn't load" instead of "NOT running". Every 30 tries we
      // re-add Meld's script in case the first download failed.
      heartbeat();
      if (bootAttempts > 30) { setStatus('Firehose SDK not loaded yet - retrying (check internet / Meld).'); }
      if (bootAttempts % 30 === 0) { reloadSdk(); }
      setTimeout(boot, bootAttempts > 30 ? 5000 : 1000);
      return;
    }

    try {
      firehose = new Firehose();
    } catch (e) {
      setStatus('Firehose SDK error: ' + String(e).slice(0, 100) + ' — check Meld connection.');
      heartbeat();
      setTimeout(boot, 5000);
      return;
    }

    // Log when Firehose connection state changes
    var lastSocketState = null;
    var checkSocketState = setInterval(function(){
      if (!firehose) { clearInterval(checkSocketState); return; }
      var nowOpen = !!firehose.socketOpen;
      if (nowOpen !== lastSocketState) {
        lastSocketState = nowOpen;
        if (nowOpen) {
          setStatus('connected to Meld, relaying to ICB');
          post('/api/activity/raw', { kind: 'listener_connected', data: { timestamp: new Date().toISOString() } });
        } else {
          setStatus('waiting for Meld...');
          post('/api/activity/raw', { kind: 'listener_disconnected', data: { timestamp: new Date().toISOString() } });
        }
      }
    }, 2000);

    firehose.on('error', function(e){
      setStatus('Firehose error: ' + String(e).slice(0, 100));
      post('/api/activity/raw', { kind: 'firehose_error', data: { error: String(e).slice(0, 200) } });
    });

    firehose.on('chat', function(msg){
      var name = usernameOf(msg && msg.sender);
      if (!name) { return; }
      post('/api/giveaway/event', { type: 'chat', username: name });
      var bits = bitsIn(msg);
      if (bits > 0) { post('/api/giveaway/event', { type: 'bits', username: name, amount: bits }); }
    });

    firehose.on('sub', function(sub){
      var name = usernameOf(sub && sub.subscriber);
      if (!name) { return; }
      var months = (sub && typeof sub.months_purchased === 'number' && sub.months_purchased >= 1) ? Math.round(sub.months_purchased) : 1;
      post('/api/giveaway/event', { type: 'sub', username: name, months: months, tier: sub && sub.sub_level, subType: sub && sub.sub_type });
    });

    firehose.on('gifts', function(bundle){
      if (!bundle || bundle.anonymous) { return; } // anonymous gifter: nobody to credit
      var name = usernameOf(bundle.gifter);
      if (!name) { return; }
      var recips = [];
      var list = bundle.recipients || [];
      for (var r = 0; r < list.length && r < 100; r++) { var rn = usernameOf(list[r]); if (rn) { recips.push(rn); } }
      post('/api/giveaway/event', { type: 'gifts', username: name, count: bundle.count || 0, tier: bundle.sub_level, recipients: recips });
    });

    // EVERYTHING else for the nightly report: Firehose's catch-all "*" hands
    // us every event it receives (chat text, viewer counts, viewer list,
    // stream on/off, scene changes, shop purchases, super chats, Fourthwall
    // donations, highlighted messages, channel updates, speech-to-text...).
    // Each one is shrunk (people -> their name, long text trimmed, huge
    // lists capped) and saved raw to the night's activity log. Replay /
    // history messages Meld sends on connect are skipped so a layer reload
    // doesn't duplicate the log.
    // 'meld' is skipped because Meld also sends the same thing as 'meld.scene_change' etc.
    var SKIP_RAW = { x_history: true, catchup: true, x_features: true, x_response: true, meld: true };
    firehose.on('*', function(wrapped){
      if (!wrapped || !wrapped.type || SKIP_RAW[wrapped.type]) { return; }
      post('/api/activity/raw', { kind: wrapped.type, data: compact(wrapped.event, 0, wrapped.type) });
    });

    // Report-only (no unicorns): follows and raids for the nightly report.
    firehose.on('follow', function(f){
      var name = usernameOf(f && f.follower);
      if (name) { post('/api/giveaway/event', { type: 'follow', username: name }); }
    });
    firehose.on('raid', function(r){
      var name = usernameOf(r && (r.host || r.raider || r.sender));
      post('/api/giveaway/event', { type: 'raid', username: name, viewers: (r && typeof r.viewers === 'number') ? r.viewers : 0 });
    });

    heartbeat();
    setInterval(heartbeat, 5000);
  }

  boot();
})();
