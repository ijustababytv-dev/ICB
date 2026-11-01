/** Giveaway check-in controls. Loaded before the page startup script. */
// Check-in status: who has chatted today and is in the jar and the drawing.
/** Display attendance beside cumulative totals without changing those totals. */
function hereBadge(g, e) {
    const c = g.checkIn;
    if (!c || !c.required) return '';
    return Object.hasOwn(c.users || {}, String(e.username).toLowerCase())
        ? ' <span class="breakdown">✓ here today</span>'
        : ' <span class="breakdown">· not here yet</span>';
}

/** Follow confirmed cloud policy without repainting an in-flight checkbox edit. */
function renderCheckIn(g) {
    const c = g && g.checkIn;
    if (!c) return;
    if (!$('checkInRequired').disabled) $('checkInRequired').checked = c.required;
    const p = g.pool || { people: 0, total: 0 };
    $('checkInStatus').textContent = c.required
        ? `Here today: ${c.count} · in the drawing: ${p.people} people, ${p.total} 🦄`
        : 'Off — everyone with unicorns is in the drawing.';
}

/** Persist through the authenticated revision-aware API and show rejected saves. */
async function setCheckIn(on) {
    const checkbox = $('checkInRequired');
    checkbox.disabled = true;
    try {
        const response = await fetch('/api/giveaway/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ required: on })
        });
        const data = await response.json();
        if (!response.ok || !data.ok)
            throw new Error(data.error || 'Could not save check-in setting.');
        checkbox.checked = data.required;
    } catch (error) {
        checkbox.checked = state?.checkIn?.required !== false;
        $('checkInStatus').textContent = error.message || 'Could not save check-in setting.';
    } finally {
        checkbox.disabled = false;
    }
}
