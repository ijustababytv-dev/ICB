'use strict';

const mViewsCollection = require('./collection');
const mDomainHtml = require('../domain/html');

/** Ship resource artwork in HTML and keep live values in the polling overlay. */
function renderResourceCardPage(card, query) {
  if (Array.isArray(card.slots)) return mViewsCollection.renderCollectionCardPage(card, query);
  const width = Math.max(120, Number(query.get('w')) || 620);
  const box = card.valueBox || { left: 30, top: 45, width: 55, height: 30 };
  const hasSecondary = Boolean(card.secondary);
  // Cards with a 'secondary' count (e.g. Ramen Plush) show BOTH numbers as
  // text in the one existing blank box - "<cooked> Ramen Cooked VS <count>
  // Plushies" - instead of a bare number. Two independently-updated spans so
  // each number keeps its own thousands-separator grouping.
  const innerMarkup = hasSecondary
    ? `<span id="c1">${card.secondaryCount || 0}</span> ${mDomainHtml.escapeHtml(card.secondary.label || 'Cooked')}` +
      ` <span class="vs">VS</span> <span id="n">${card.count}</span> ${mDomainHtml.escapeHtml(card.secondary.primaryLabel || card.name)}`
    : `<span id="n">${card.count}</span>`;
  // The pattern proven to render in Meld: image in the static HTML, plain ES5,
  // an XHR poll that only rewrites the number. Do not modernise this.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${mDomainHtml.escapeHtml(card.name)}</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #wrap{position:relative;width:${width}px}
  #wrap img{width:100%;display:block}
  #box{position:absolute;left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%;
       display:table;table-layout:fixed}
  #inner{display:table-cell;vertical-align:middle;text-align:center;white-space:nowrap}
  #inner{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;font-weight:bold;color:#ffffff;
     font-size:${Math.round(width * (hasSecondary ? 0.05 : 0.09))}px;line-height:1.05;
     text-shadow:0 0 16px rgba(255,225,150,.85),0 0 40px rgba(255,170,60,.55),0 3px 6px rgba(0,0,0,.85)}
  .vs{font-size:.62em;opacity:.85;padding:0 .3em}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/${encodeURIComponent(card.image)}" alt="${mDomainHtml.escapeHtml(card.name)}">
  <div id="box"><div id="inner">${innerMarkup}</div></div>
</div>
<script>
(function(){
  var hasSecondary = ${hasSecondary ? 'true' : 'false'};
  var box = document.getElementById('box');
  var inner = document.getElementById('inner');
  var n = document.getElementById('n');
  var c1 = hasSecondary ? document.getElementById('c1') : null;
  function group(v){
    var s = String(v), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out; c++;
      if (c % 3 === 0 && i > 0) { out = ',' + out; }
    }
    return out;
  }
  function size(){
    var h = box.offsetHeight;
    if (h <= 0) { return; }
    var fs = Math.round(h * (hasSecondary ? 0.42 : 0.70));
    inner.style.fontSize = fs + 'px';
    if (hasSecondary) {
      // The combined text is width-sensitive too (it's a sentence, not a
      // single number) - shrink until it actually fits the box.
      var w = box.offsetWidth;
      var guard = 0;
      while (inner.scrollWidth > w && fs > 8 && guard < 60) {
        fs -= 1;
        inner.style.fontSize = fs + 'px';
        guard++;
      }
    }
  }
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/resource-trackers?src=${encodeURIComponent(card.id)}&_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4) { return; }
      if (x.status !== 200) { return; }
      try {
        var d = JSON.parse(x.responseText);
        var list = (d.resourceTrackers && d.resourceTrackers.cards) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === ${JSON.stringify(card.id)}) {
            n.innerHTML = group(list[i].count || 0);
            if (c1) { c1.innerHTML = group(list[i].secondaryCount || 0); }
            size();
            return;
          }
        }
      } catch (e) { }
    };
    x.send();
  }
  window.onload = size;
  size(); poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

// The ijustababyTV unicorn banner (2026-08-25). Native art is 1672x941 with an empty glass
// "readout" panel built into the frame - measured by eye with a pixel grid overlaid on the art
// (same method as every other frame skin in this project): the safe text-scrolling rectangle is
// left 258px, top 524px, width 1150px, height 122px of the 1672x941 original, i.e. as percentages
// left 15.43%, top 55.68%, width 68.78%, height 12.97%. Re-measure if the art is ever regenerated.

Object.assign(exports, { renderResourceCardPage });
