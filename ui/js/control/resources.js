/** Resource card rendering, layout, and updates. Loaded before the page startup script. */
function rtRender() {
    const g = $('rtGrid');
    if (!g) return;
    if (rtDragging) {
        rtRenderWaiting = true;
        return;
    } // don't redraw under her mouse mid-drag
    rtBindDrag(g);
    const allCards = RT.cards || [];
    const hiddenIds = rtLay.hidden || [];
    const pos = (id) => {
        const i = (rtLay.order || []).indexOf(id);
        return i < 0 ? 100000 + allCards.findIndex((x) => x.id === id) : i;
    };

    const cards = allCards
        .filter((c) => !hiddenIds.includes(c.id))
        .sort((a, b) => pos(a.id) - pos(b.id));
    const removed = allCards.filter((c) => hiddenIds.includes(c.id));
    $('rtState').textContent = RT.lastLoginAt
        ? `last Palia login seen ${new Date(RT.lastLoginAt).toLocaleTimeString()}`
        : '';
    g.innerHTML = cards
        .map((c) =>
            rtWrap(
                c,
                (() => {
                    if (c.slots) {
                        // Multi-slot 'collection' card (e.g. Queen Ushindi Collection): one
                        // dashboard card, N independent materials each with its own −/+/Reset,
                        // plus a single "Reset All" for after a full turn-in.
                        const rows = (c.slots || [])
                            .map((slot) =>
                                slot.mode === 'countdown'
                                    ? `<div class="rt-btns" style="justify-content:space-between">
          <span style="min-width:150px">${(
              slot.count || 0
          ).toLocaleString()} <span class="muted" style="font-size:12px">${phEsc(
                                          slot.label || slot.id
                                      )} left (batch ${slot.startAt || 0})</span></span>
          <span>
            <button data-rtslot="${phEsc(c.id)}/${phEsc(slot.id)}" data-d="-1">−</button>
            <button data-rtslot="${phEsc(c.id)}/${phEsc(slot.id)}" data-d="1">+</button>
            <input type="number" min="0" id="slotStart-${phEsc(c.id)}-${phEsc(
                                          slot.id
                                      )}" placeholder="${slot.startAt || 0}" style="width:70px">
            <button class="secondary" data-rtslotstart="${phEsc(c.id)}/${phEsc(
                                          slot.id
                                      )}">Set &amp; restock</button>
          </span>
        </div>`
                                    : `<div class="rt-btns" style="justify-content:space-between">
          <span style="min-width:150px">${(
              slot.count || 0
          ).toLocaleString()} <span class="muted" style="font-size:12px">${phEsc(
                                          slot.label || slot.id
                                      )}</span></span>
          <span>
            <button data-rtslot="${phEsc(c.id)}/${phEsc(slot.id)}" data-d="-1">−</button>
            <button data-rtslot="${phEsc(c.id)}/${phEsc(slot.id)}" data-d="1">+</button>
            <button class="secondary" data-rtslotreset="${phEsc(c.id)}/${phEsc(
                                          slot.id
                                      )}" data-rtresetname="${phEsc(
                                          slot.label || slot.id
                                      )}">Reset</button>
          </span>
        </div>`
                            )
                            .join('');
                        const hasCountdown = (c.slots || []).some((s) => s.mode === 'countdown');
                        return `<div class="rt">
      <img src="/resource-art/${encodeURIComponent(
          c.image
      )}" alt="" onerror="this.style.display='none'">
      <div class="rt-meta">
        <div class="rt-url">/${phEsc(c.id)}.html</div>
        <div class="rt-life">${
            hasCountdown
                ? 'COUNTDOWN · each box restocks to its batch size when ICB restarts'
                : 'NEVER AUTO-RESETS · manual reset only, per material'
        }</div>
      </div>
      <div class="rt-v" style="font-size:16px;line-height:1.6;display:block">${rows}</div>
      <div class="rt-btns">
        <button class="secondary" data-rtslotsreset="${phEsc(c.id)}" data-rtresetname="all ${
                            (c.slots || []).length
                        } counts on ${phEsc(c.name)}">${
                            hasCountdown ? 'Restock All' : 'Reset All'
                        }</button>
      </div>
    </div>`;
                    }
                    if (c.secondary) {
                        // Combined card (e.g. Ramen Plush): two independent counts sharing
                        // one overlay box - "<cooked> Ramen Cooked VS <count> Plushies".
                        const secLabel = phEsc(c.secondary.label || 'Cooked');
                        const priLabel = phEsc(c.secondary.primaryLabel || c.name);
                        return `<div class="rt">
      <img src="/resource-art/${encodeURIComponent(
          c.image
      )}" alt="" onerror="this.style.display='none'">
      <div class="rt-meta">
        <div class="rt-url">/${phEsc(c.id)}.html</div>
        <div class="rt-life">NEVER AUTO-RESETS · manual reset only, both counts</div>
      </div>
      <div class="rt-v" style="font-size:20px;line-height:1.5">
        <div>${(
            c.secondaryCount || 0
        ).toLocaleString()} <span class="muted" style="font-size:12px">${secLabel}</span></div>
        <div>${(
            c.count || 0
        ).toLocaleString()} <span class="muted" style="font-size:12px">${priLabel}</span></div>
      </div>
      <div class="rt-btns">
        <button data-rtsec="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rtsec="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtsecreset="${phEsc(
            c.id
        )}" data-rtresetname="${secLabel}">Reset ${secLabel}</button>
      </div>
      <div class="rt-btns">
        <button data-rt="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rt="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtreset="${phEsc(
            c.id
        )}" data-rtresetname="${priLabel}">Reset ${priLabel}</button>
      </div>
    </div>`;
                    }
                    return `<div class="rt">
      <img src="/resource-art/${encodeURIComponent(
          c.image
      )}" alt="" onerror="this.style.display='none'">
      <div class="rt-meta">
        <div class="rt-url">/${phEsc(c.id)}.html</div>
        ${
            c.mode === 'lifetime'
                ? `<div class="rt-life">${
                      c.source
                          ? 'NEVER AUTO-RESETS · this is your live total everywhere'
                          : 'NEVER AUTO-RESETS · manual reset only'
                  }</div>`
                : ''
        }
        ${
            c.mode === 'countdown'
                ? `<div class="rt-life" style="color:var(--muted)">COUNTS DOWN · restocks to batch size on server restart</div>`
                : ''
        }
      </div>
      <div class="rt-v">${(c.count || 0).toLocaleString()}${
                        c.mode === 'countdown'
                            ? ` <span class="muted" style="font-size:13px">/ ${(
                                  c.startAt || 0
                              ).toLocaleString()}</span>`
                            : ''
                    }</div>
      ${
          c.mode === 'lifetime' && c.source
              ? `<div class="rt-btns">
        <button class="secondary" data-rtlivereset="${phEsc(
            c.source.split('.').pop()
        )}" data-rtresetname="${phEsc(c.name)}">Reset</button></div>`
              : c.mode === 'lifetime'
              ? `<div class="rt-btns">
        <button data-rt="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rt="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${phEsc(
                    c.name
                )}">Reset</button></div>`
              : c.mode === 'countdown'
              ? `<div class="correct">
        <input id="startInput-${phEsc(
            c.id
        )}" type="number" min="0" placeholder="batch size (e.g. 200)">
        <button class="secondary" data-rtstart="${phEsc(c.id)}">Set &amp; restock now</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${phEsc(
                    c.name
                )}">Reset to 0</button></div>`
              : `<div class="rt-btns">
        <button data-rt="${phEsc(c.id)}" data-d="-1">−</button>
        <button data-rt="${phEsc(c.id)}" data-d="1">+</button>
        <button class="secondary" data-rtreset="${phEsc(c.id)}" data-rtresetname="${phEsc(
                    c.name
                )}">Reset</button></div>`
      }
    </div>`;
                })()
            )
        )
        .join('');
    $('rtHidden').innerHTML = !removed.length
        ? ''
        : `<div class="rt-hidden"><b>Removed from dashboard</b> <span class="muted">(still counting in the background)</span><br>${removed
              .map(
                  (c) =>
                      `<span class="chip">${phEsc(
                          c.name || c.id
                      )} <button class="secondary" data-rtshow="${phEsc(
                          c.id
                      )}">Bring back</button></span>`
              )
              .join('')}</div>`;
    // She logs into Palia many times a day, so a reset she did not want has to
    // be recoverable rather than just explained.
    $('rtUndo').innerHTML = !RT.canUndoReset
        ? ''
        : `<div class="rt-undo">Session cards were zeroed${
              RT.lastResetReason === 'palia-login' ? ' because you logged into Palia' : ''
          }
       ${RT.lastResetAt ? ` at ${new Date(RT.lastResetAt).toLocaleTimeString()}` : ''}.
       <button class="secondary" id="rtUndoBtn" style="margin-left:8px">Undo — put the numbers back</button></div>`;
}

function rtWrap(c, html) {
    // Adds the move handle + remove button to the top of each tracker card.
    const bar = `<div class="rt-bar"><span class="rt-handle" draggable="true" title="Drag to move">⠿ move</span><span class="rt-name" style="flex:1">${phEsc(
        c.name || c.id
    )}</span><button class="secondary" data-rttop="${phEsc(
        c.id
    )}" title="Move this tracker to the top">⇧ Top</button><button class="secondary" data-rthide="${phEsc(
        c.id
    )}" title="Take this tracker off the dashboard">✕ Remove</button></div>`;
    return html.replace('<div class="rt">', `<div class="rt" data-rtid="${phEsc(c.id)}">${bar}`);
}

async function rtSaveLayout() {
    rtLayLocal = true;
    try {
        await fetch('/api/layout', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackerOrder: rtLay.order, trackerHidden: rtLay.hidden })
        });
        log('tracker layout saved', 'layout');
    } catch (_error) {
        log('could not save tracker layout - is ICB running?', 'layout');
    }
}

function rtBindDrag(g) {
    if (g.dataset.dnd) return;
    g.dataset.dnd = '1';
    // Only the handle starts a drag, so typing in a box or clicking buttons never moves a card.
    g.addEventListener('dragstart', (e) => {
        const h = e.target.closest && e.target.closest('.rt-handle');
        const card = h && h.closest('.rt[data-rtid]');
        if (!card) return;
        rtDragging = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData('text/plain', card.dataset.rtid);
            e.dataTransfer.setDragImage(card, 20, 20);
        } catch (_) {}
    });
    g.addEventListener('dragover', (e) => {
        if (!rtDragging) return;
        e.preventDefault();
        const over = e.target.closest('.rt[data-rtid]');
        if (!over || over === rtDragging) return;
        const r = over.getBoundingClientRect();
        const after = e.clientX - r.left > r.width / 2;
        g.insertBefore(rtDragging, after ? over.nextSibling : over);
    });
    g.addEventListener('drop', (e) => {
        if (rtDragging) e.preventDefault();
    });
    g.addEventListener('dragend', () => {
        if (!rtDragging) return;
        rtDragging.classList.remove('dragging');
        rtDragging = null;
        const shown = Array.from(g.querySelectorAll('.rt[data-rtid]')).map((x) => x.dataset.rtid);
        rtLay.order = shown.concat((rtLay.order || []).filter((id) => !shown.includes(id)));
        rtSaveLayout();
        rtRenderWaiting = false;
        rtRender();
    });
}

async function rtCall(url, body, method = 'PUT') {
    const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const d = await r.json().catch(() => ({}));
    if (d.resourceTrackers) {
        RT = d.resourceTrackers;
        rtRender();
    }
    if (!r.ok && d.error) log('resource: ' + d.error);
    return d;
}
