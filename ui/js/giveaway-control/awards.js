/** Manual giveaway awards and award history. Loaded before the page startup script. */
function setGiveAmount(n) {
    $('giveAmount').value = n;
    updateGivePreview();
}

function unicornsFor(kind, n) {
    const r = state.rates || { subMonth: 2, giftedSub: 4, bitsPerUnicorn: 100 };
    if (kind === 'subMonths') return n * r.subMonth;
    if (kind === 'giftedSubs') return n * r.giftedSub;
    if (kind === 'bits') return Math.floor(n / r.bitsPerUnicorn);
    return n;
}

function onKindChange() {
    const k = $('giveKind').value;
    $('giveAmountLabel').textContent = KIND_INFO[k].label;
    if (KIND_INFO[k].reason) $('giveReason').value = KIND_INFO[k].reason;
    const chips =
        k === 'bits' ? [100, 500, 1000, 5000] : k === 'subMonths' ? [1, 3, 6, 12] : [1, 2, 5, 10];
    document.querySelectorAll('.amt-chip').forEach((c, i) => {
        c.textContent = chips[i];
    });
    if (k === 'bits' && parseInt($('giveAmount').value, 10) < 100) $('giveAmount').value = 100;
    updateGivePreview();
}

function updateGivePreview() {
    const k = $('giveKind').value,
        n = parseInt($('giveAmount').value, 10);
    if (k === 'unicorns' || !Number.isFinite(n) || n <= 0) {
        $('givePreview').textContent = '';
        return;
    }
    const u = unicornsFor(k, n);
    let text = `= ${u} fluffy unicorn${u === 1 ? '' : 's'} each`;
    if (k === 'bits' && n % ((state.rates || {}).bitsPerUnicorn || 100))
        text += ' (leftover bits still count toward their next one)';
    $('givePreview').textContent = text;
}

function prefillGive(name) {
    $('giveNames').value = name;
    $('giveCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('giveAmount').focus();
    $('giveAmount').select();
}

function showGiveResult(text, ok) {
    const el = $('giveResult');
    el.textContent = text;
    el.className = 'give-result ' + (ok ? 'ok' : 'err');
}

async function giveUnicorns(sign) {
    const usernames = $('giveNames')
        .value.split(/[,\n]+/)
        .map((n) => n.trim())
        .filter(Boolean);
    const amount = parseInt($('giveAmount').value, 10);
    const kind = $('giveKind').value;
    if (!usernames.length) return showGiveResult('Type at least one name.', false);
    if (!Number.isFinite(amount) || amount <= 0)
        return showGiveResult('Amount must be 1 or more.', false);
    const delta = sign * amount;
    if (
        sign < 0 &&
        !confirm(
            `Take ${KIND_INFO[kind].unit(amount)} away from ${
                usernames.length === 1 ? usernames[0] : usernames.length + ' people'
            }?`
        )
    )
        return;
    let data;
    try {
        const res = await fetch('/api/giveaway/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames, kind, amount: delta, reason: $('giveReason').value })
        });
        data = await res.json();
    } catch (err) {
        return showGiveResult('Could not reach ICB — is it running?', false);
    }
    if (!data.ok) return showGiveResult(data.error || 'Could not save.', false);
    const r = data.results;
    const unit = (n) => `${Math.abs(n)} fluffy unicorn${Math.abs(n) === 1 ? '' : 's'}`;

    let msg;
    const what =
        kind === 'unicorns' ? '' : ` (${KIND_INFO[kind].unit(Math.abs(r[0].appliedAmount))})`;
    if (r.length === 1) {
        msg =
            sign > 0
                ? `Gave ${r[0].username} ${unit(r[0].applied)}${what} — they now have ${
                      r[0].totalTickets
                  }.`
                : `Took ${unit(r[0].applied)}${what} from ${r[0].username} — they now have ${
                      r[0].totalTickets
                  }.`;
    } else {
        msg = `${sign > 0 ? 'Added' : 'Took away'} ${KIND_INFO[kind].unit(amount)}${
            kind === 'unicorns' ? '' : ' = ' + unit(unicornsFor(kind, amount))
        } ${sign > 0 ? 'for' : 'from'} each of ${r.length} people.`;
    }
    if (data.skipped && data.skipped.length)
        msg += ` (skipped blocked: ${data.skipped.join(', ')})`;
    const newOnes = r.filter((x) => x.wasNew).length;
    if (newOnes && sign > 0) msg += ` (${newOnes} new to the giveaway)`;
    showGiveResult(msg, true);
    $('giveNames').value = '';
}

function renderGiveLog(log) {
    const el = $('giveLog');
    const rows = (log || []).slice().reverse().slice(0, 50);
    if (!rows.length) {
        el.innerHTML =
            '<div style="color:var(--text-dim); font-size:13px;">Nothing given by hand yet.</div>';
        return;
    }
    el.innerHTML = rows
        .map(
            (x) => `
      <div class="log-row">
        <span><span class="amt ${x.delta >= 0 ? 'plus' : 'minus'}">${x.delta >= 0 ? '+' : ''}${
                x.delta
            }</span> ${escapeHtml(x.username)}${
                x.kind && x.kind !== 'unicorns' && KIND_INFO[x.kind]
                    ? ` <span class="meta">(${x.amount < 0 ? '−' : ''}${KIND_INFO[x.kind].unit(
                          Math.abs(x.amount)
                      )})</span>`
                    : ''
            }</span>
        <span class="meta">${escapeHtml(x.reason || '')} · ${new Date(x.at).toLocaleDateString([], {
                month: 'short',
                day: 'numeric'
            })} ${new Date(x.at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit'
            })}</span>
      </div>`
        )
        .join('');
}
