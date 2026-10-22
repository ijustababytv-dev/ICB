/** Party signup list editing and exports. Loaded before the page startup script. */
function foldRole(roleId, on) {
    act(
        '/api/party/collapse',
        { id: cur, roleId: roleId, collapsed: on },
        on ? 'Folded on stream' : 'Opened on stream'
    );
}

function foldAll(on) {
    act('/api/party/collapse', { id: cur, all: on }, on ? 'All roles folded' : 'All roles opened');
}

function setRole(k, role) {
    act('/api/party/signup', { id: cur, key: k, role: role }, 'Moved');
}

function moveIn(k) {
    act('/api/party/signup', { id: cur, key: k, top: true }, 'Moved off the waitlist');
}

function rename(k) {
    var old = '';
    ev().signups.forEach(function (s) {
        if (s.key === k) old = s.palia;
    });
    var v = prompt('Palia name:', old);
    if (!v) return;
    act('/api/party/signup', { id: cur, key: k, palia: v }, 'Renamed');
}

function removeP(k) {
    act('/api/party/signup', { id: cur, key: k, remove: true }, 'Removed');
}

function addPerson() {
    var t = $('addTwitch').value.trim(),
        p = $('addPalia').value.trim();
    if (!t && !p) {
        toast('Type a name');
        return;
    }
    act(
        '/api/party/signup',
        { id: cur, twitch: t || p, palia: p || t, role: $('addRole').value },
        'Added'
    ).then(function () {
        $('addTwitch').value = '';
        $('addPalia').value = '';
    });
}

function copyList() {
    var e = ev(),
        lines = [e.title + (e.when ? ' — ' + e.when : '')];
    var lastGroup = null;
    e.roles.forEach(function (r) {
        if ((r.group || '') !== lastGroup) {
            lastGroup = r.group || '';
            if (lastGroup) lines.push('', '== ' + lastGroup + ' ==');
        }
        lines.push(
            (r.emoji ? r.emoji + ' ' : '') +
                r.label +
                ' (' +
                r.people.length +
                '/' +
                r.spots +
                '): ' +
                (r.people
                    .map(function (p) {
                        return p.palia;
                    })
                    .join(', ') || '—')
        );
        if (r.bring) lines.push('   bring: ' + r.bring);
        if (r.waitlist.length)
            lines.push(
                '   waitlist: ' +
                    r.waitlist
                        .map(function (p) {
                            return p.palia;
                        })
                        .join(', ')
            );
    });
    try {
        navigator.clipboard.writeText(lines.join('\n'));
        toast('List copied');
    } catch (x) {
        prompt('Copy this:', lines.join(' | '));
    }
}

function clearSignups() {
    if (!confirm('Remove everyone from this event?')) return;
    act('/api/party/event', { id: cur, clearSignups: true }, 'Cleared');
}
