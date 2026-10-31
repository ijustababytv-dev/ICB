/** Giveaway check-in controls. Loaded before the page startup script. */
// Check-in status: who has chatted today and is in the jar and the drawing.
function hereBadge(g, e) {
    const c = g.checkIn;
    if (!c || !c.required) return '';
    return c.users[String(e.username).toLowerCase()]
        ? ' <span class="breakdown">✓ here today</span>'
        : ' <span class="breakdown">· not here yet</span>';
}

function renderCheckIn(g) {
    const c = g && g.checkIn;
    if (!c) return;
    $('checkInRequired').checked = c.required;
    const p = g.pool || { people: 0, total: 0 };
    $('checkInStatus').textContent = c.required
        ? `Here today: ${c.count} · in the drawing: ${p.people} people, ${p.total} 🦄`
        : 'Off — everyone with unicorns is in the drawing.';
}

async function setCheckIn(on) {
    await fetch('/api/giveaway/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ required: on })
    });
}
