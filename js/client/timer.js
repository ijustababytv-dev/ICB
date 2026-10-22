(function(){
  // Plain ES5, XHR poll every 2s - same rules as every other Meld overlay page in this
  // project (ticker.html, the per-resource card pages). Modern syntax here has previously
  // rendered a blank layer inside Meld's embedded browser - do not "modernize" this file.
  var plate = document.getElementById('plate');
  var dot = document.getElementById('dot');
  var headingEl = document.getElementById('heading');
  var subheadingEl = document.getElementById('subheading');
  var digitsEl = document.getElementById('digits');
  var celebrateEl = document.getElementById('celebrate');
  var mmEl = document.getElementById('mm');
  var ssEl = document.getElementById('ss');

  var status = 'idle';         // 'idle' | 'running' | 'timesup'
  var targetAtMs = 0;
  var heading = 'STARTING SOON';
  var subheading = '';
  var haveSynced = false;
  var localCelebrating = false; // countdown hit 0 on this client before the server said so

  function twoDigits(n){
    n = Math.max(0, Math.floor(n));
    return n < 10 ? '0' + n : '' + n;
  }

  function renderText(){
    headingEl.textContent = heading;
    if (subheading) {
      subheadingEl.textContent = subheading;
      subheadingEl.style.display = 'block';
    } else {
      subheadingEl.style.display = 'none';
    }
  }

  function showCelebration(){
    digitsEl.style.display = 'none';
    celebrateEl.className = 'show';
    dot.className = 'still';
  }

  function showCountdown(){
    digitsEl.style.display = 'flex';
    celebrateEl.className = '';
    dot.className = '';
  }

  function tick(){
    if (!haveSynced) { return; }

    if (status === 'idle') {
      plate.className = '';
      localCelebrating = false;
      return;
    }

    plate.className = 'show';
    renderText();

    if (status === 'timesup') {
      showCelebration();
      return;
    }

    // status === 'running'
    var remainingMs = targetAtMs - Date.now();
    if (remainingMs <= 0) {
      // Countdown reached zero on this client. Celebrate locally right away rather than
      // waiting for the dashboard operator to click "Time's Up!" - a plain visual state,
      // never written back to the server (overlay pages are read-only clients).
      localCelebrating = true;
      showCelebration();
      return;
    }
    localCelebrating = false;
    showCountdown();
    var totalSeconds = Math.ceil(remainingMs / 1000);
    var mins = Math.floor(totalSeconds / 60);
    mmEl.textContent = twoDigits(mins);
    ssEl.textContent = twoDigits(totalSeconds - mins * 60);
  }

  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/settings?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var c = (d.settings && d.settings.countdown) || {};
        status = (c.status === 'running' || c.status === 'timesup') ? c.status : 'idle';
        heading = (typeof c.heading === 'string' && c.heading) ? c.heading : 'STARTING SOON';
        subheading = (typeof c.subheading === 'string') ? c.subheading : '';
        var parsed = c.targetAt ? Date.parse(c.targetAt) : NaN;
        targetAtMs = isNaN(parsed) ? 0 : parsed;
        haveSynced = true;
        tick();
      } catch (e) { }
    };
    x.send();
  }

  poll();
  setInterval(poll, 2000);
  setInterval(tick, 1000);
})();
