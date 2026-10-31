/** Weekly accomplishment controls. Loaded before the page startup script. */
function wkRender() {
    const g = $('wkGrid');
    if (!g) return;
    const items = WK.items || [];
    const reset = WK.nextResetAt ? new Date(WK.nextResetAt) : null;
    $('wkState').textContent = `${WK.completed || 0} of ${WK.total || 0} done · resets ${
        reset
            ? reset.toLocaleString(undefined, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit'
              })
            : '—'
    }`;
    const groups = [];
    for (const it of items) {
        const name = it.group || '';
        let grp = groups.find((x) => x.name === name);
        if (!grp) {
            grp = { name, items: [] };
            groups.push(grp);
        }
        grp.items.push(it);
    }
    g.innerHTML = groups
        .map(
            (grp) => `<div class="wk-g"><h3>${phEsc(grp.name)}</h3>
      ${grp.items
          .map((it) => {
              // An unverified rule is flagged rather than silently trusted.
              const badge =
                  it.type === 'manual'
                      ? `<span class="wk-man" title="${phEsc(
                            it.whyManual || 'Manual'
                        )}">MANUAL</span>`
                      : it.verified === false
                      ? `<span class="wk-warn" title="${phEsc(
                            it.note || 'Not yet proven against a real log'
                        )}">AUTO?</span>`
                      : '<span class="wk-auto">AUTO</span>';
              const n =
                  it.type === 'manual' ? '' : `<span class="wk-n">${it.count}/${it.target}</span>`;
              return `<div class="wk-i ${it.done ? 'done' : ''}" data-wk="${phEsc(it.id)}">
          <span class="wk-b">${it.done ? '✓' : '☐'}</span>
          <span class="wk-t">${phEsc(it.label)}</span>${n}${badge}</div>`;
          })
          .join('')}</div>`
        )
        .join('');
    $('wkUndo').innerHTML = !WK.canUndoReset
        ? ''
        : `<div class="rt-undo">The weekly list was reset${
              WK.lastResetAt ? ` at ${new Date(WK.lastResetAt).toLocaleString()}` : ''
          }.
       <button class="secondary" id="wkUndoBtn" style="margin-left:8px">Undo — put last week's ticks back</button></div>`;
}

async function wkCall(url, body, method = 'PUT') {
    const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const d = await r.json().catch(() => ({}));
    if (d.weekly) {
        WK = d.weekly;
        wkRender();
    }
    if (!r.ok && d.error) log('weekly: ' + d.error);
    return d;
}
