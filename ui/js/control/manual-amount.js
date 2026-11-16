/** Hand-entered amount controls for manual cards such as the Profit Tracker. */
function rtManualMarkup(c) {
    const id = phEsc(c.id);
    return `<div class="correct">
        <input id="manualInput-${id}" type="number" min="0" step="1" placeholder="amount (e.g. 25000)">
        <button data-rtmanual="${id}" data-mode="set">Set to this</button>
        <button class="secondary" data-rtmanual="${id}" data-mode="add">+ Add</button>
        <button class="secondary" data-rtmanual="${id}" data-mode="sub">− Subtract</button>
        <button class="secondary" data-rtreset="${id}" data-rtresetname="${phEsc(
        c.name
    )}">Reset to 0</button></div>`;
}

/** Apply the typed amount: Set replaces the total, Add and Subtract change it. */
async function rtManualApply(id, mode) {
    const inp = document.getElementById('manualInput-' + id);
    const value = inp ? Math.trunc(Number(inp.value)) : NaN;
    if (!inp || inp.value === '' || !Number.isFinite(value) || value < 0) {
        if (inp) inp.focus();
        return;
    }
    const out =
        mode === 'set'
            ? await rtCall(`/api/resource-trackers/${id}/set`, { value })
            : await rtCall(`/api/resource-trackers/${id}/adjust`, {
                  delta: mode === 'sub' ? -value : value
              });
    if (out && out.ok && inp) inp.value = '';
}

document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.rtmanual) rtManualApply(b.dataset.rtmanual, b.dataset.mode);
});

document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t && t.id && t.id.indexOf('manualInput-') === 0)
        rtManualApply(t.id.slice('manualInput-'.length), 'set');
});
