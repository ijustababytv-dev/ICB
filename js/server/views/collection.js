'use strict';

const mDomainHtml = require('../domain/html');

/** Ship collection artwork and slot positions in the initial HTML for Meld. */
function renderCollectionCardPage(card, query) {
  // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) have
  // several independent blank boxes baked into one piece of art, each over
  // its own material icon - so instead of one #box/#n pair like every other
  // card, this renders one pair per slot, each positioned at that slot's own
  // valueBox and polling the same /api/resource-trackers response.
  const width = Math.max(120, Number(query.get('w')) || 620);
  const slots = card.slots || [];
  const boxDivs = slots.map(slot => {
    const box = slot.valueBox || { left: 10, top: 70, width: 20, height: 15 };
    return `<div class="box" style="left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%">` +
      `<div class="inner" id="inner-${mDomainHtml.escapeHtml(slot.id)}"><span id="n-${mDomainHtml.escapeHtml(slot.id)}">${slot.count || 0}</span></div></div>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${mDomainHtml.escapeHtml(card.name)}</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  #wrap{position:relative;width:${width}px}
  #wrap img{width:100%;display:block}
  .box{position:absolute;display:table;table-layout:fixed}
  .inner{display:table-cell;vertical-align:middle;text-align:center;white-space:nowrap;
     font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;font-weight:bold;color:#ffffff;
     line-height:1.05;
     text-shadow:0 0 12px rgba(255,225,150,.85),0 0 30px rgba(255,170,60,.55),0 2px 5px rgba(0,0,0,.85)}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/${encodeURIComponent(card.image)}" alt="${mDomainHtml.escapeHtml(card.name)}">
  ${boxDivs}
</div>
<script>
(function(){
  var slotIds = ${JSON.stringify(slots.map(s => s.id))};
  function group(v){
    var s = String(v), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out; c++;
      if (c % 3 === 0 && i > 0) { out = ',' + out; }
    }
    return out;
  }
  function size(){
    for (var i = 0; i < slotIds.length; i++) {
      var inner = document.getElementById('inner-' + slotIds[i]);
      var box = inner.parentNode;
      var h = box.offsetHeight;
      var w = box.offsetWidth;
      if (h <= 0) { continue; }
      var fontPx = Math.round(h * 0.60);
      inner.style.fontSize = fontPx + 'px';
      // Width-aware shrink on top of the height-based size above: a slot
      // showing a large comma-formatted number (some cards, e.g. Ore vs
      // Kitsuu, are lifetime counters meant to reach the millions) can be
      // wider than its box even at a height-appropriate font size, especially
      // on a narrow box - keep shrinking until it actually fits, with a small
      // floor so it never disappears. scrollWidth/offsetWidth are old,
      // ES5-safe DOM properties, fine for Meld's embedded browser.
      var guard = 0;
      while (inner.scrollWidth > w && fontPx > 8 && guard < 60) {
        fontPx -= 1;
        inner.style.fontSize = fontPx + 'px';
        guard += 1;
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
            var slots = list[i].slots || [];
            for (var j = 0; j < slots.length; j++) {
              var el = document.getElementById('n-' + slots[j].id);
              if (el) { el.innerHTML = group(slots[j].count || 0); }
            }
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

Object.assign(exports, { renderCollectionCardPage });
