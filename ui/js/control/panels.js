/** Dashboard panel ordering. Loaded before the page startup script. */
function applyPanelOrder(order) {
    const grid = $('panelGrid');
    if (!grid || !Array.isArray(order) || !order.length) {
        updateMoveButtons();
        return;
    }
    const sections = Array.from(grid.children);
    const byKey = {};
    sections.forEach((s) => (byKey[s.dataset.panel] = s));
    order.forEach((key) => {
        if (byKey[key]) grid.appendChild(byKey[key]);
    });
    // any panel not mentioned in a saved order (e.g. added after the order was last saved) keeps
    // falling to the end in its original relative order, since appendChild only moves the ones we know.
    updateMoveButtons();
}

function updateMoveButtons() {
    const grid = $('panelGrid');
    if (!grid) return;
    const sections = Array.from(grid.children);
    sections.forEach((s, i) => {
        const up = s.querySelector('[data-move="up"]'),
            down = s.querySelector('[data-move="down"]');
        if (up) up.disabled = i === 0;
        if (down) down.disabled = i === sections.length - 1;
    });
}

function movePanel(panelId, dir) {
    const grid = $('panelGrid');
    if (!grid) return;
    const sections = Array.from(grid.children);
    const idx = sections.findIndex((s) => s.dataset.panel === panelId);
    if (idx < 0) return;
    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sections.length) return;
    if (dir === 'up') grid.insertBefore(sections[idx], sections[swapWith]);
    else grid.insertBefore(sections[swapWith], sections[idx]);
    updateMoveButtons();
    savePanelOrder();
}

async function savePanelOrder() {
    const order = Array.from($('panelGrid').children).map((s) => s.dataset.panel);
    try {
        await fetch('/api/layout', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ panelOrder: order })
        });
        log('panel order saved', 'layout');
    } catch (_error) {
        /* order still holds visually for this session even if the save failed */
    }
}
