(function(){
  'use strict';

  var ZONES_META = [
    { id: 'zone1' }, { id: 'zone2' }, { id: 'zone3' },
    { id: 'zone4' }, { id: 'zone5' }, { id: 'zone6' },
  ];

  var TIMEZONE_OPTIONS = [
    { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
    { value: 'America/Denver', label: 'Mountain (MT)' },
    { value: 'America/Chicago', label: 'Central (CT)' },
    { value: 'America/New_York', label: 'Eastern (ET)' },
    { value: 'America/Anchorage', label: 'Alaska (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'London (UK)' },
    { value: 'Europe/Paris', label: 'Paris / Berlin (CET)' },
    { value: 'Europe/Moscow', label: 'Moscow' },
    { value: 'Asia/Dubai', label: 'Dubai' },
    { value: 'Asia/Kolkata', label: 'India (IST)' },
    { value: 'Asia/Shanghai', label: 'China (CST)' },
    { value: 'Asia/Tokyo', label: 'Tokyo / Seoul' },
    { value: 'Australia/Sydney', label: 'Sydney' },
    { value: 'Pacific/Auckland', label: 'Auckland' },
  ];

  var previewOuter = document.getElementById('previewOuter');
  var zoneGrid = document.getElementById('zoneGrid');
  var syncRow = document.getElementById('syncRow');
  var syncText = document.getElementById('syncText');

  var zones = {};        // id -> { label, subLabel, timezone, visible }
  var els = {};          // id -> { card, label, sublabel, tz, toggle, pvCard, pvLabel, pvSub, pvTime, pvAp }
  var saveTimers = {};   // id -> setTimeout handle (debounce per zone)
  var haveSynced = false;

  function setSync(state, text){
    syncRow.className = 'sync ' + (state || '');
    syncText.textContent = text;
  }

  function buildTimezoneSelect(id){
    var sel = document.createElement('select');
    sel.id = 'tz-' + id;
    TIMEZONE_OPTIONS.forEach(function(opt){
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      sel.appendChild(o);
    });
    return sel;
  }

  function buildZoneCard(id){
    var card = document.createElement('div');
    card.className = 'card';

    var head = document.createElement('div');
    head.className = 'cardhead';
    var h2 = document.createElement('h2');
    h2.textContent = id.replace('zone', 'Clock ');
    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    var toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    var toggleSlider = document.createElement('span');
    toggleSlider.className = 'slider';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);
    head.appendChild(h2);
    head.appendChild(toggleLabel);
    card.appendChild(head);

    var labelField = document.createElement('label');
    labelField.textContent = 'Heading';
    var labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.maxLength = 40;
    labelInput.placeholder = 'CHICAGO';

    var subField = document.createElement('label');
    subField.textContent = 'Subtitle (optional)';
    var subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.maxLength = 40;
    subInput.placeholder = 'HOME BASE';

    var tzField = document.createElement('label');
    tzField.textContent = 'Time zone';
    var tzSelect = buildTimezoneSelect(id);

    card.appendChild(labelField);
    card.appendChild(labelInput);
    card.appendChild(subField);
    card.appendChild(subInput);
    card.appendChild(tzField);
    card.appendChild(tzSelect);

    zoneGrid.appendChild(card);

    var refs = {
      card: card, toggle: toggleInput,
      label: labelInput, sublabel: subInput, tz: tzSelect,
    };
    els[id] = refs;

    function queueSave(){
      if (saveTimers[id]) clearTimeout(saveTimers[id]);
      saveTimers[id] = setTimeout(function(){ saveZone(id); }, 500);
    }
    toggleInput.addEventListener('change', function(){ saveZone(id); });
    labelInput.addEventListener('input', queueSave);
    subInput.addEventListener('input', queueSave);
    tzSelect.addEventListener('change', function(){ saveZone(id); });
  }

  function buildPreviewCard(id){
    var pvCard = document.createElement('div');
    pvCard.className = 'pv-card';
    var pvLabel = document.createElement('p');
    pvLabel.className = 'pv-label';
    var pvSub = document.createElement('p');
    pvSub.className = 'pv-sublabel';
    var pvTimeRow = document.createElement('div');
    var pvTime = document.createElement('span');
    pvTime.className = 'pv-time';
    var pvAp = document.createElement('span');
    pvAp.className = 'pv-ap';
    pvTimeRow.appendChild(pvTime);
    pvTimeRow.appendChild(pvAp);
    pvCard.appendChild(pvLabel);
    pvCard.appendChild(pvSub);
    pvCard.appendChild(pvTimeRow);
    previewOuter.appendChild(pvCard);
    els[id].pvCard = pvCard;
    els[id].pvLabel = pvLabel;
    els[id].pvSub = pvSub;
    els[id].pvTime = pvTime;
    els[id].pvAp = pvAp;
  }

  ZONES_META.forEach(function(z){
    buildZoneCard(z.id);
    buildPreviewCard(z.id);
  });

  var pvEmpty = document.createElement('div');
  pvEmpty.className = 'pv-empty';
  pvEmpty.textContent = 'no clocks visible';
  previewOuter.appendChild(pvEmpty);

  // --- server calls -----------------------------------------------------
  function saveZone(id){
    var refs = els[id];
    var patch = {
      id: id,
      label: refs.label.value.trim() || id,
      subLabel: refs.sublabel.value.trim(),
      timezone: refs.tz.value,
      visible: refs.toggle.checked,
    };
    setSync('busy', 'saving…');
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/settings', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function(){
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var d = JSON.parse(xhr.responseText);
          applyState(d.settings.worldClock);
          setSync('ok', 'synced');
        } catch (e) { setSync('err', 'bad response'); }
      } else {
        setSync('err', 'save failed (' + xhr.status + ')');
      }
    };
    xhr.onerror = function(){ setSync('err', 'connection lost'); };
    xhr.send(JSON.stringify({ worldClock: { zones: [patch] } }));
  }

  // --- state -> form + preview ---------------------------------------------
  function applyState(wc){
    var list = (wc && wc.zones) || [];
    var next = {};
    list.forEach(function(z){ if (z && typeof z.id === 'string') next[z.id] = z; });
    zones = next;

    ZONES_META.forEach(function(meta){
      var id = meta.id;
      var zone = zones[id];
      var refs = els[id];
      if (!zone) return;
      // Don't stomp on a field the operator is actively editing.
      if (document.activeElement !== refs.label) refs.label.value = zone.label || '';
      if (document.activeElement !== refs.sublabel) refs.sublabel.value = zone.subLabel || '';
      if (document.activeElement !== refs.tz) refs.tz.value = zone.timezone || 'UTC';
      refs.toggle.checked = !!zone.visible;
      refs.card.className = zone.visible ? 'card' : 'card dim';
    });

    renderPreview();
  }

  function renderPreview(){
    var now = new Date();
    var anyVisible = false;
    ZONES_META.forEach(function(meta){
      var id = meta.id;
      var zone = zones[id];
      var refs = els[id];
      if (!refs.pvCard) return;
      if (!zone || !zone.visible) { refs.pvCard.className = 'pv-card'; return; }
      anyVisible = true;
      refs.pvCard.className = 'pv-card show';
      refs.pvLabel.textContent = zone.label || id;
      if (zone.subLabel) { refs.pvSub.textContent = zone.subLabel; refs.pvSub.style.display = 'block'; }
      else { refs.pvSub.style.display = 'none'; }
      try {
        var dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: zone.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
        });
        var parts = dtf.formatToParts(now);
        var hh = '', mm = '', ap = '';
        parts.forEach(function(p){
          if (p.type === 'hour') hh = p.value;
          else if (p.type === 'minute') mm = p.value;
          else if (p.type === 'dayPeriod') ap = p.value;
        });
        refs.pvTime.textContent = hh + ':' + mm;
        refs.pvAp.textContent = ap;
      } catch (e) {
        refs.pvTime.textContent = '--:--';
        refs.pvAp.textContent = '';
      }
    });
    pvEmpty.style.display = anyVisible ? 'none' : 'block';
  }

  // --- initial load + poll for external changes -----------------------------
  function fetchState(){
    fetch('/api/settings?_=' + Date.now())
      .then(function(r){ return r.json(); })
      .then(function(d){
        setSync('ok', 'synced');
        haveSynced = true;
        applyState(d.settings.worldClock);
      })
      .catch(function(){ setSync('err', 'can\'t reach server on :8790'); });
  }

  fetchState();
  setInterval(fetchState, 4000);
  setInterval(renderPreview, 1000);
})();
