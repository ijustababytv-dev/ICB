// ICB Webcam widget (Baby, 2026-10-11) - shows her own camera on her desktop (Desktop Widgets).
// Link options: ?cam=<part of camera name>&mirror=1&shape=rect|round|circle&border=ff8fd8&bw=4
// (The dashboard builds this link for her.) Not meant for Meld - Meld already has her camera.
(function(){
  var q = {}; location.search.replace(/^\?/, '').split('&').forEach(function(p){ if (p) { var i = p.indexOf('='); q[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(p.slice(i + 1)); } });
  var box = document.getElementById('box'), v = document.getElementById('v'), msg = document.getElementById('msg');
  var shape = q.shape || 'round', bw = Math.max(0, Math.min(20, Number(q.bw === undefined ? 4 : q.bw) || 0));
  box.style.border = bw ? bw + 'px solid #' + String(q.border || 'ff8fd8').replace(/[^0-9a-f]/gi, '').slice(0, 6) : 'none';
  box.style.borderRadius = shape === 'circle' ? '50%' : shape === 'round' ? '22px' : '0';
  if (q.mirror !== '0') v.style.transform = 'scaleX(-1)';
  function say(t){ msg.textContent = t; msg.style.display = t ? 'block' : 'none'; }
  var lastCams = null;
  function send(o){ try { var r = new XMLHttpRequest(); r.open('POST', '/api/desktop/cams', true); r.setRequestHeader('Content-Type', 'application/json'); r.send(JSON.stringify(o)); } catch (e) {} }
  function report(list){ lastCams = list; send({ cams: list }); }
  function status(t){ send({ status: t, cams: lastCams }); }
  // List the cameras even if none can be opened (so the dashboard dropdown still fills in).
  function listOnly(){
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function(devs){
      var c = devs.filter(function(d){ return d.kind === 'videoinput'; }).map(function(d, i){ return d.label || ('Camera ' + (i + 1) + ' (name hidden)'); });
      report(c);
    }).catch(function(){});
  }
  function start(){
    listOnly();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('No camera support here'); return; }
    // Ask once for any camera so the names are visible, then pick the one she chose.
    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(function(first){
      return navigator.mediaDevices.enumerateDevices().then(function(devs){
        var cams = devs.filter(function(d){ return d.kind === 'videoinput'; });
        report(cams.map(function(d){ return d.label; }));
        var want = (q.cam || '').toLowerCase(), pick = null;
        for (var i = 0; i < cams.length; i++) if (want && cams[i].label.toLowerCase().indexOf(want) >= 0) { pick = cams[i]; break; }
        var curId = first.getVideoTracks()[0] && first.getVideoTracks()[0].getSettings().deviceId;
        if (!pick || pick.deviceId === curId) return first;
        first.getTracks().forEach(function(t){ t.stop(); });
        return navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: pick.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      });
    }).then(function(stream){
      v.srcObject = stream; say(''); status('OK - showing ' + ((stream.getVideoTracks()[0] || {}).label || 'camera'));
      stream.getVideoTracks()[0].onended = function(){ say('Camera stopped - retrying…'); setTimeout(start, 3000); };
    }).catch(function(e){
      var n = e && e.name;
      say(n === 'NotReadableError' || n === 'TrackStartError' ? 'Camera is busy in another app (Meld?) - retrying…' :
          n === 'NotAllowedError' ? 'Camera permission was blocked' : n === 'NotFoundError' ? 'No camera found - retrying…' : 'Camera error: ' + (n || e) + ' - retrying…');
      status(msg.textContent + ' [' + (n || 'error') + (e && e.message ? ': ' + e.message : '') + ']');
      if (n !== 'NotAllowedError') setTimeout(start, 5000);
    });
  }
  start();
})();
