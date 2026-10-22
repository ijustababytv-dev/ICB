/** Giveaway backups and restoration. Loaded before the page startup script. */
async function loadBackups() {
    const box = $('backupList');
    try {
        const data = await (await fetch('/api/giveaway/backups')).json();
        if (!data.ok || !data.backups.length) {
            box.innerHTML =
                '<div style="color:var(--text-dim);">No backups yet — the first one is made when ICB starts.</div>';
            return;
        }
        box.innerHTML = data.backups
            .map((b) => {
                const when = new Date(b.at).toLocaleString();
                const tag = b.file
                    .replace(/^[a-z]+_[0-9_-]+_?/i, '')
                    .replace(/\.json$/, '')
                    .replace(/-/g, ' ');
                const stats =
                    b.entrants === null
                        ? 'unreadable'
                        : `${b.entrants} people · ${b.unicorns} 🦄 · ${b.winners} winners`;
                const btn =
                    b.kind === 'corrupt' || b.entrants === null
                        ? ''
                        : `<button class="btn-ghost" style="padding:3px 10px; font-size:12px;" onclick="restoreBackup('${escapeHtml(
                              b.file
                          )}', '${escapeHtml(when)}')">Restore</button>`;
                return `<div style="display:flex; gap:10px; align-items:center; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="flex:1;"><b>${escapeHtml(
              when
          )}</b> <span style="color:var(--text-dim);">— ${escapeHtml(
                    BACKUP_KIND[b.kind] || b.kind
                )}${
                    tag ? ' (' + escapeHtml(tag) + ')' : ''
                }</span><br><span style="color:var(--text-dim); font-size:12px;">${escapeHtml(
                    stats
                )}</span></div>${btn}</div>`;
            })
            .join('');
    } catch (e) {
        box.innerHTML = '<div style="color:var(--bad);">Could not load backups.</div>';
    }
}

async function backupNow() {
    const data = await (await fetch('/api/giveaway/backups/now', { method: 'POST' })).json();
    $('backupStatus').textContent = data.ok ? 'Backed up ✓' : 'Backup failed';
    loadBackups();
}

async function restoreBackup(file, when) {
    if (
        !confirm(
            `Restore the giveaway to how it was at ${when}?\n\nEveryone's fluffy unicorns, winners, notes and settings go back to that moment. A copy of how things are right now is saved first, so you can undo this.`
        )
    )
        return;
    const data = await (
        await fetch('/api/giveaway/backups/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file })
        })
    ).json();
    $('backupStatus').textContent = data.ok
        ? `Restored ✓ (current state saved as ${data.safetyCopy})`
        : data.error || 'Restore failed';
    loadBackups();
}
