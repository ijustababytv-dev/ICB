(function(){
  // Plain ES5, XHR poll - same rules as every other Meld overlay page in this project. Only the
  // list of zones (labels/timezones/visibility) is polled from the server every 5s; each clock's
  // own time ticks locally every second from Date.now(), so nothing waits on a round trip to move.
  var ZONE_IDS = ['zone1', 'zone2', 'zone3', 'zone4', 'zone5', 'zone6'];
  var barEl = document.getElementById('bar');
  var cardEls = {};   // id -> { card, label, sublabel, clock, ampm, day }
  var zones = {};     // id -> { label, subLabel, timezone, visible }
  var haveSynced = false;

  function buildCard(id){
    var card = document.createElement('div');
    card.className = 'card';

    var label = document.createElement('p');
    label.className = 'label';
    card.appendChild(label);

    var sublabel = document.createElement('p');
    sublabel.className = 'sublabel';
    card.appendChild(sublabel);

    var timerow = document.createElement('div');
    timerow.className = 'timerow';
    var clock = document.createElement('span');
    clock.className = 'clock';
    var ampm = document.createElement('span');
    ampm.className = 'ampm';
    timerow.appendChild(clock);
    timerow.appendChild(ampm);
    card.appendChild(timerow);

    var day = document.createElement('div');
    day.className = 'daybadge';
    card.appendChild(day);

    barEl.appendChild(card);
    cardEls[id] = { card: card, label: label, sublabel: sublabel, clock: clock, ampm: ampm, day: day };
  }

  for (var i = 0; i < ZONE_IDS.length; i++) { buildCard(ZONE_IDS[i]); }

  function todayIsoDateInZone(tz, now){
    try {
      var dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      return dtf.format(now);
    } catch (e) { return null; }
  }
  var localTodayCache = null;

  function tick(){
    if (!haveSynced) { return; }
    var now = new Date();
    var localToday = todayIsoDateInZone(undefined, now);
    for (var i = 0; i < ZONE_IDS.length; i++) {
      var id = ZONE_IDS[i];
      var zone = zones[id];
      var refs = cardEls[id];
      if (!zone || !zone.visible) {
        refs.card.className = 'card';
        continue;
      }
      refs.card.className = 'card show';
      refs.label.textContent = zone.label || zone.id;
      if (zone.subLabel) { refs.sublabel.textContent = zone.subLabel; refs.sublabel.style.display = 'block'; }
      else { refs.sublabel.style.display = 'none'; }

      try {
        var dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: zone.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
        });
        var parts = dtf.formatToParts(now);
        var hh = '', mm = '', ap = '';
        for (var p = 0; p < parts.length; p++) {
          if (parts[p].type === 'hour') { hh = parts[p].value; }
          else if (parts[p].type === 'minute') { mm = parts[p].value; }
          else if (parts[p].type === 'dayPeriod') { ap = parts[p].value; }
        }
        refs.clock.textContent = hh + ':' + mm;
        refs.ampm.textContent = ap;

        var zoneToday = todayIsoDateInZone(zone.timezone, now);
        if (zoneToday && localToday && zoneToday !== localToday) {
          refs.day.textContent = zoneToday > localToday ? 'tomorrow' : 'yesterday';
          refs.day.className = 'daybadge show';
        } else {
          refs.day.className = 'daybadge';
        }
      } catch (e) {
        refs.clock.textContent = '--:--';
        refs.ampm.textContent = '';
      }
    }
  }

  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/settings?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var wc = (d.settings && d.settings.worldClock) || {};
        var list = wc.zones || [];
        var next = {};
        for (var i = 0; i < list.length; i++) {
          var z = list[i];
          if (z && typeof z.id === 'string') { next[z.id] = z; }
        }
        zones = next;
        haveSynced = true;
        tick();
      } catch (e) { }
    };
    x.send();
  }

  poll();
  setInterval(poll, 5000);
  setInterval(tick, 1000);
})();
