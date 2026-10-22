'use strict';

const mState = require('../state');
const mDomainValidation = require('../domain/validation');
const mDomainHtml = require('../domain/html');

const TICKER_ART_FILE = 'TICKER_BANNER.png';
const TICKER_BOX = { left: 15.43, top: 55.68, width: 68.78, height: 12.97 };

/** Render the framed ticker with escaped operator text and ES5 polling. */
function renderTickerPage(query) {
    const width = Math.max(300, Math.min(2400, Number(query.get('w')) || 900));
    const height = Math.round(width * (941 / 1672));
    const boxLeftPx = Math.round(width * (TICKER_BOX.left / 100));
    const boxTopPx = Math.round(height * (TICKER_BOX.top / 100));
    const boxWidthPx = Math.round(width * (TICKER_BOX.width / 100));
    const boxHeightPx = Math.round(height * (TICKER_BOX.height / 100));
    const fontSize = Math.round(boxHeightPx * 0.5);
    const tickerSettings = mState.settings.ticker || {};
    const rawText = mDomainValidation.cleanString(tickerSettings.text, 'Welcome to ijustababyTv');
    const initialText = mDomainHtml.escapeHtml(rawText);
    const initialSpeed = Number.isFinite(Number(tickerSettings.speed))
        ? Number(tickerSettings.speed)
        : 90;
    const initialPause = Number.isFinite(Number(tickerSettings.pause))
        ? Number(tickerSettings.pause)
        : 1;
    // Plain ES5 only, XHR poll, image in the static HTML - same rules as every other Meld overlay
    // page in this project (see icb-master-handbook.md, "The overlay pattern that works in Meld").
    // 2026-08-28: switched from a continuous two-copy scroll to a single pass at a time, per Baby's
    // request - only one copy of the text exists, it travels once from fully off the right edge to
    // fully off the left edge, waits `pause` seconds with the panel empty, then goes again. Speed
    // and pause are both live-adjustable from the dashboard (see /api/ticker) and take effect on the
    // very next pass without a page reload.
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ijustababyTV ticker</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #wrap{position:relative;width:${width}px;height:${height}px}
  #wrap img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  #box{position:absolute;left:${boxLeftPx}px;top:${boxTopPx}px;width:${boxWidthPx}px;height:${boxHeightPx}px;
       overflow:hidden}
  #tk{position:absolute;top:0;left:0;white-space:nowrap;opacity:0;
      font-family:"Baloo 2","Comic Sans MS","Trebuchet MS",sans-serif;font-weight:bold;color:#fff8ff;
      font-size:${fontSize}px;line-height:${boxHeightPx}px;
      text-shadow:0 0 10px rgba(255,255,255,.85),0 0 22px rgba(210,140,255,.75),0 2px 4px rgba(40,0,60,.6)}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/${encodeURIComponent(TICKER_ART_FILE)}" alt="ijustababyTV">
  <div id="box"><span id="tk">${initialText}</span></div>
</div>
<script>
(function(){
  var box = document.getElementById('box');
  var span = document.getElementById('tk');
  var lastText = ${JSON.stringify(rawText)};
  var speed = ${JSON.stringify(initialSpeed)};
  var pauseMs = ${JSON.stringify(initialPause)} * 1000;
  var timer = null;
  function pass(){
    if (timer) { clearTimeout(timer); timer = null; }
    var boxWidth = box.offsetWidth;
    var textWidth = span.offsetWidth;
    var distance = boxWidth + textWidth;
    var duration = Math.max(0.5, distance / speed);
    span.style.transition = 'none';
    span.style.transform = 'translateX(' + boxWidth + 'px)';
    span.style.opacity = '1';
    // Force a reflow so the browser applies the reset position before the transition below
    // starts, or it animates from the OLD position instead of the fresh one on the right.
    void span.offsetWidth;
    span.style.transition = 'transform ' + duration + 's linear';
    span.style.transform = 'translateX(-' + textWidth + 'px)';
    timer = setTimeout(pass, duration * 1000 + pauseMs);
  }
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/settings?_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var t = (d.settings && d.settings.ticker) || {};
        var changed = false;
        if (typeof t.text === 'string' && t.text && t.text !== lastText) { lastText = t.text; span.textContent = t.text; changed = true; }
        if (typeof t.speed === 'number' && t.speed !== speed) { speed = t.speed; changed = true; }
        if (typeof t.pause === 'number' && t.pause * 1000 !== pauseMs) { pauseMs = t.pause * 1000; changed = true; }
        if (changed) { pass(); }
      } catch (e) { }
    };
    x.send();
  }
  pass();
  poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

Object.assign(exports, { renderTickerPage });
