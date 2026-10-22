(function(){
  'use strict';

  var PRESETS = [
    { label: 'JUST CHATTING', heading: 'JUST CHATTING', subheading: '' },
    { label: 'STARTING SOON', heading: 'STARTING SOON', subheading: '' },
    { label: 'BE RIGHT BACK', heading: 'BE RIGHT BACK', subheading: 'grab a drink, we\'ll be right back' },
    { label: 'SEE YOU SOON', heading: 'SEE YOU SOON', subheading: 'thanks for hanging out!' },
    { label: 'STREAM STARTS IN', heading: 'STREAM STARTS IN', subheading: '' },
  ];

  var headingInput = document.getElementById('heading');
  var subheadingInput = document.getElementById('subheading');
  var headingChipsEl = document.getElementById('headingChips');
  var minutesInput = document.getElementById('minutes');
  var clockTimeInput = document.getElementById('clockTime');
  var clockZoneSelect = document.getElementById('clockZone');
  var tabDuration = document.getElementById('tabDuration');
  var tabClock = document.getElementById('tabClock');
  var paneDuration = document.getElementById('paneDuration');
  var paneClock = document.getElementById('paneClock');
  var btnStart = document.getElementById('btnStart');
  var btnTimesUp = document.getElementById('btnTimesUp');
  var btnReset = document.getElementById('btnReset');
  var syncRow = document.getElementById('syncRow');
  var syncText = document.getElementById('syncText');

  var pvPlate = document.getElementById('pv-plate');
  var pvDot = document.getElementById('pv-dot');
  var pvHeading = document.getElementById('pv-heading');
  var pvSubheading = document.getElementById('pv-subheading');
  var pvDigits = document.getElementById('pv-digits');
  var pvCelebrate = document.getElementById('pv-celebrate');
  var pvMm = document.getElementById('pv-mm');
  var pvSs = document.getElementById('pv-ss');
  var pvIdle = document.getElementById('pv-idle');

  var mode = 'duration'; // 'duration' | 'clock'
  var current = { heading: '', subheading: '', targetAt: '', status: 'idle', timezone: 'America/Chicago' };
  var previewTimer = null;

  // --- preset chips -------------------------------------------------------
  PRESETS.forEach(function(preset){
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = preset.label;
    chip.addEventListener('click', function(){
      headingInput.value = preset.heading;
      subheadingInput.value = preset.subheading;
      Array.prototype.forEach.call(headingChipsEl.children, function(c){ c.classList.remove('active'); });
      chip.classList.add('active');
    });
    headingChipsEl.appendChild(chip);
  });

  // --- duration quick-add ---------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('.durbtn'), function(btn){
    btn.addEventListener('click', function(){
      var add = Number(btn.getAttribute('data-add')) || 0;
      minutesInput.value = String((Number(minutesInput.value) || 0) + add);
    });
  });
  document.getElementById('clearMinutes').addEventListener('click', function(){
    minutesInput.value = '0';
  });

  // --- duration / clock tabs -------------------------------------------------
  function setMode(next){
    mode = next;
    tabDuration.classList.toggle('active', mode === 'duration');
    tabClock.classList.toggle('active', mode === 'clock');
    paneDuration.style.display = mode === 'duration' ? 'block' : 'none';
    paneClock.style.display = mode === 'clock' ? 'block' : 'none';
  }
  tabDuration.addEventListener('click', function(){ setMode('duration'); });
  tabClock.addEventListener('click', function(){ setMode('clock'); });

  // --- clock-time -> UTC instant, timezone-aware ---------------------------
  function ianaOffsetMinutes(date, timeZone){
    var dtf = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, timeZoneName: 'shortOffset', hour: 'numeric' });
    var parts = dtf.formatToParts(date);
    var tzPart = parts.filter(function(p){ return p.type === 'timeZoneName'; })[0];
    var m = tzPart && tzPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!m) return 0;
    var sign = m[1] === '-' ? -1 : 1;
    var hours = parseInt(m[2], 10);
    var mins = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (hours * 60 + mins);
  }

  function targetFromClockTime(hh, mm, timeZone){
    var now = new Date();
    var offsetMin = ianaOffsetMinutes(now, timeZone);
    var dtf = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    var parts = dtf.formatToParts(now);
    function part(type){ return Number(parts.filter(function(p){ return p.type === type; })[0].value); }
    var y = part('year'), mo = part('month'), d = part('day');
    var utcMs = Date.UTC(y, mo - 1, d, hh, mm, 0) - offsetMin * 60000;
    var target = new Date(utcMs);
    if (target.getTime() <= now.getTime()) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    return target;
  }

  // --- server calls -----------------------------------------------------
  function putCountdown(patch, onDone){
    setSync('busy', 'saving…');
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/settings', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function(){
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var d = JSON.parse(xhr.responseText);
          applyState(d.settings.countdown);
          setSync('ok', 'synced');
        } catch (e) { setSync('err', 'bad response'); }
      } else {
        setSync('err', 'save failed (' + xhr.status + ')');
      }
      if (onDone) onDone();
    };
    xhr.onerror = function(){ setSync('err', 'connection lost'); if (onDone) onDone(); };
    xhr.send(JSON.stringify({ countdown: patch }));
  }

  function setSync(state, text){
    syncRow.className = 'sync ' + (state === 'ok' ? 'ok' : state === 'err' ? 'err' : '');
    syncText.textContent = text;
  }

  // --- button handlers -----------------------------------------------------
  btnStart.addEventListener('click', function(){
    var heading = headingInput.value.trim() || 'STARTING SOON';
    var subheading = subheadingInput.value.trim();
    var targetDate;

    if (mode === 'duration') {
      var mins = Number(minutesInput.value) || 0;
      if (mins <= 0) { minutesInput.focus(); setSync('err', 'set minutes above 0 first'); return; }
      targetDate = new Date(Date.now() + mins * 60000);
    } else {
      if (!clockTimeInput.value) { clockTimeInput.focus(); setSync('err', 'pick a target time first'); return; }
      var bits = clockTimeInput.value.split(':');
      targetDate = targetFromClockTime(Number(bits[0]), Number(bits[1]), clockZoneSelect.value);
    }

    putCountdown({
      heading: heading,
      subheading: subheading,
      targetAt: targetDate.toISOString(),
      timezone: mode === 'clock' ? clockZoneSelect.value : current.timezone,
      status: 'running',
    });
  });

  btnTimesUp.addEventListener('click', function(){
    putCountdown({ status: 'timesup' });
  });

  btnReset.addEventListener('click', function(){
    putCountdown({ targetAt: '', status: 'idle' });
  });

  // --- state -> form + preview ---------------------------------------------
  function applyState(c){
    current = {
      heading: (typeof c.heading === 'string' && c.heading) ? c.heading : 'STARTING SOON',
      subheading: typeof c.subheading === 'string' ? c.subheading : '',
      targetAt: typeof c.targetAt === 'string' ? c.targetAt : '',
      status: (c.status === 'running' || c.status === 'timesup') ? c.status : 'idle',
      timezone: typeof c.timezone === 'string' && c.timezone ? c.timezone : 'America/Chicago',
    };
    // Only overwrite the text fields if the operator hasn't started typing something new
    // and the fields are still at their defaults - avoids stomping on an in-progress edit
    // every time the 2s poll lands.
    if (document.activeElement !== headingInput && !headingInput.value) headingInput.value = current.heading;
    if (document.activeElement !== subheadingInput && !subheadingInput.value) subheadingInput.value = current.subheading;
    renderPreview();
  }

  function renderPreview(){
    if (current.status === 'idle') {
      pvPlate.className = '';
      pvIdle.style.display = 'block';
      return;
    }
    pvIdle.style.display = 'none';
    pvPlate.className = 'show';
    pvHeading.textContent = current.heading;
    if (current.subheading) { pvSubheading.textContent = current.subheading; pvSubheading.style.display = 'block'; }
    else { pvSubheading.style.display = 'none'; }

    if (current.status === 'timesup') {
      pvDigits.style.display = 'none';
      pvCelebrate.className = 'show';
      pvDot.className = 'still';
      return;
    }

    var remaining = Date.parse(current.targetAt) - Date.now();
    if (isNaN(remaining) || remaining <= 0) {
      pvDigits.style.display = 'none';
      pvCelebrate.className = 'show';
      pvDot.className = 'still';
      return;
    }
    pvDigits.style.display = 'flex';
    pvCelebrate.className = '';
    pvDot.className = '';
    var totalSeconds = Math.ceil(remaining / 1000);
    var mins = Math.floor(totalSeconds / 60);
    var secs = totalSeconds - mins * 60;
    pvMm.textContent = mins < 10 ? '0' + mins : '' + mins;
    pvSs.textContent = secs < 10 ? '0' + secs : '' + secs;
  }

  // --- initial load + poll for external changes -----------------------------
  function fetchState(){
    fetch('/api/settings?_=' + Date.now())
      .then(function(r){ return r.json(); })
      .then(function(d){ setSync('ok', 'synced'); applyState(d.settings.countdown); })
      .catch(function(){ setSync('err', 'can\'t reach server on :8790'); });
  }

  fetchState();
  setInterval(fetchState, 2000);
  previewTimer = setInterval(renderPreview, 1000);
})();
