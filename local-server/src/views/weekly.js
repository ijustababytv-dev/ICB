'use strict';

const mWeekly = require('../weekly');
const mDomainHtml = require('../domain/html');

/** Render the weekly artwork/checklist before JavaScript runs, preserving Meld compatibility. */
function renderWeeklyPage(query) {
    const view = mWeekly.weeklyView();
    // Skin: assets/resources/tall.png, native 1024x1536 (2:3, "Path of the
    // Briar" frame). v2 of this art dropped the divider lines and the corner
    // emblem - just a title-bar cutout up top and open sky/vines below, which
    // is what lets the checklist run at a readable size. Width drives
    // everything; height always follows at width*1.5 so the frame is never
    // stretched or squashed.
    const width = Math.max(320, Number(query.get('w')) || 580);
    const cols = Math.max(1, Math.min(3, Number(query.get('cols')) || 2));
    const height = Math.round(width * 1.5);
    // Type must scale with the COLUMN, not the whole widget, or a two-column
    // layout renders everything at double size.
    const unit = width / cols;

    // Boxes measured directly off tall.png at its native 1024x1536 (see
    // claude/icb-essence-checklist-skin.md in the project for how / re-measure
    // if the art is ever re-exported). BAR_BOX has no carved slot in this art -
    // it's placed in the open sky just under the title card.
    const TITLE_BOX = { left: 20.02, top: 2.6, width: 63.48, height: 8.79 };
    const BAR_BOX = { left: 6.84, top: 12.7, width: 86.43, height: 2.6 };
    const CONTENT_BOX = { left: 6.35, top: 16.28, width: 87.4, height: 63.15 };
    // cols=1 was tried and silently clipped the last 4 groups (overflow:
    // hidden ate them with no visual warning) - cols=2 is the minimum safe
    // default for all 24 items / 9 groups at this font size. Verified by
    // rendering against real config + data and screenshotting before shipping.

    // Group the checklist the way Baby's in-game list is grouped. Without the
    // headings, 24 lines is an unreadable wall.
    const groups = [];
    for (const item of view.items) {
        const name = item.group || '';
        let g = groups.find((x) => x.name === name);
        if (!g) {
            g = { name, items: [] };
            groups.push(g);
        }
        g.items.push(item);
    }

    const rowHtml = (item) => {
        const detail =
            item.type === 'manual'
                ? ''
                : ` <span class="c">${item.count}/${Number(item.target || 1)}</span>`;
        return `      <tr class="${item.done ? 'done' : ''}" id="r_${mDomainHtml.escapeHtml(
            item.id
        )}">
        <td class="bx">${item.done ? '&#10003;' : '&#9633;'}</td>
        <td class="lb">${mDomainHtml.escapeHtml(item.label)}${detail}</td>
      </tr>`;
    };

    const body = groups
        .map(
            (g) => `  <div class="grp">
    ${g.name ? `<div class="gh">${mDomainHtml.escapeHtml(g.name)}</div>` : ''}
    <table><tbody>
${g.items.map(rowHtml).join('\n')}
    </tbody></table>
  </div>`
        )
        .join('\n');

    const pct = view.total ? Math.round((view.completed / view.total) * 100) : 0;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Weekly Accomplishments</title>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;
            font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif}
  #wrap{position:relative;width:${width}px;height:${height}px}
  #wrap img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  #title{position:absolute;left:${TITLE_BOX.left}%;top:${TITLE_BOX.top}%;
         width:${TITLE_BOX.width}%;height:${TITLE_BOX.height}%;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         text-align:center;color:#ffe9c2;
         text-shadow:0 0 12px rgba(255,210,140,.75),0 2px 4px rgba(0,0,0,.9)}
  #title .t1{font-weight:bold;letter-spacing:.03em;line-height:1.1;
             font-size:${Math.round(width * 0.044)}px}
  #title .t2{margin-top:3px;color:#ffd166;font-size:${Math.round(width * 0.03)}px}
  #barbox{position:absolute;left:${BAR_BOX.left}%;top:${BAR_BOX.top}%;
          width:${BAR_BOX.width}%;height:${BAR_BOX.height}%;display:flex;align-items:center}
  #barout{width:100%;height:44%;border-radius:4px;background:rgba(255,255,255,.18);
          border:1px solid rgba(255,209,102,.4)}
  #barin{height:100%;border-radius:4px;background:#ffd166;width:${pct}%;
         box-shadow:0 0 10px rgba(255,209,102,.9)}
  #content{position:absolute;left:${CONTENT_BOX.left}%;top:${CONTENT_BOX.top}%;
           width:${CONTENT_BOX.width}%;height:${CONTENT_BOX.height}%;overflow:hidden}
  #cols{column-count:${cols};column-gap:20px;height:100%}
  .grp{break-inside:avoid;page-break-inside:avoid;margin-bottom:11px}
  .gh{color:#ffd166;font-size:${Math.round(unit * 0.056)}px;font-weight:bold;
      letter-spacing:.03em;text-transform:uppercase;margin-bottom:3px;
      text-shadow:0 2px 4px rgba(0,0,0,.95)}
  table{border-collapse:collapse;width:100%}
  td{padding:2px 0;vertical-align:top}
  td.bx{width:1.3em;color:#8df0ae;font-weight:bold;text-align:center;
        font-size:${Math.round(unit * 0.058)}px;text-shadow:0 2px 4px rgba(0,0,0,.95)}
  td.lb{color:#fff;font-size:${Math.round(unit * 0.058)}px;line-height:1.28;
        text-shadow:0 2px 4px rgba(0,0,0,.95)}
  .c{color:#ffe08a;font-weight:bold}
  /* Completed items stay on screen, struck through, so the week fills up visibly. */
  tr.done td.lb{text-decoration:line-through;opacity:.55}
  tr.done td.bx{color:#8df0ae}
</style>
</head>
<body>
<div id="wrap">
  <img src="/resource-art/tall.png" alt="">
  <div id="title">
    <div class="t1">WEEKLY ACCOMPLISHMENTS</div>
    <div class="t2" id="pg">${view.completed} / ${view.total}</div>
  </div>
  <div id="barbox"><div id="barout"><div id="barin"></div></div></div>
  <div id="content"><div id="cols">
${body}
  </div></div>
</div>
<script>
/* Plain ES5. The checklist above is already rendered by the server, so if this
   script never runs Baby still gets the list - just frozen. */
(function(){
  function poll(){
    var x = new XMLHttpRequest();
    x.open('GET', '/api/weekly?src=weekly&_=' + new Date().getTime(), true);
    x.onreadystatechange = function(){
      if (x.readyState !== 4 || x.status !== 200) { return; }
      var d;
      try { d = JSON.parse(x.responseText); } catch (e) { return; }
      var w = d.weekly; if (!w) { return; }
      document.getElementById('pg').innerHTML = w.completed + ' / ' + w.total;
      var pct = w.total ? Math.round(w.completed * 100 / w.total) : 0;
      document.getElementById('barin').style.width = pct + '%';
      for (var i = 0; i < w.items.length; i++) {
        var it = w.items[i];
        var row = document.getElementById('r_' + it.id);
        if (!row) { continue; }
        row.className = it.done ? 'done' : '';
        row.cells[0].innerHTML = it.done ? '✓' : '□';
        var label = it.label;
        if (it.type !== 'manual') {
          label += ' <span class="c">' + it.count + '/' + (it.target || 1) + '</span>';
        }
        row.cells[1].innerHTML = label;
      }
    };
    x.send();
  }
  poll();
  setInterval(poll, 2000);
})();
</script>
</body></html>`;
}

Object.assign(exports, { renderWeeklyPage });
