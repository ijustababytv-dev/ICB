const $ = (id) => document.getElementById(id);

let S = null,
    editing = false;
function esc(s) {
    return String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function toast(m) {
    const t = $('toast');
    t.textContent = m;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, method = 'GET', body) {
    try {
        const r = await fetch(path, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined
        });
        const d = await r.json();
        if (!d.ok) toast(d.error || 'Something went wrong');
        return d;
    } catch (e) {
        toast("ICB isn't answering");
        return { ok: false };
    }
}

const LINK = location.origin + '/poll.html';
$('link').textContent = LINK;
function copyLink() {
    navigator.clipboard.writeText(LINK).then(
        () => toast('Link copied — paste into a full-screen Meld browser layer'),
        () => prompt('Copy:', LINK)
    );
}

function render(d) {
    S = d;
    const st = $('stateTag');
    st.className = 'state ' + (d.revealed ? 'revealed' : d.open ? 'open' : 'closed');
    st.textContent = d.revealed ? 'winner revealed' : d.open ? 'voting OPEN' : 'closed';
    if (document.activeElement !== $('title')) $('title').value = d.title || '';
    $('showResults').checked = !!d.showResults;
    $('showText').textContent = d.showResults
        ? 'Results SHOWING on stream (vote bars and counts)'
        : 'Results hidden on stream (only you can see them here)';
    $('subWeight').value = String(d.subWeight || 2);
    $('openBtn').textContent = d.open ? '▶ Restart timer' : '▶ Open voting';
    $('closeBtn').disabled = !d.open;
    // badges (don't rebuild while she's typing a name)
    if (!editing) {
        $('badges').innerHTML = d.options.length
            ? d.options
                  .map(
                      (o, i) => `<div class="badge">
        <div class="n">${i + 1}</div>
        ${
            o.image
                ? `<img src="/assets/poll/${encodeURIComponent(o.image)}" alt="">`
                : '<span class="note">no picture</span>'
        }
        <input type="text" value="${esc(
            o.label
        )}" placeholder="Badge name (optional)" maxlength="60" onfocus="editing=true" onblur="editing=false; rename(${i}, this.value)">
        <div class="acts"><button onclick="move(${i}, -1)" ${
                          i === 0 ? 'disabled' : ''
                      }>▲</button><button onclick="move(${i}, 1)" ${
                          i === d.options.length - 1 ? 'disabled' : ''
                      }>▼</button><button class="btn-danger" onclick="removeBadge(${i})">✕</button></div>
      </div>`
                  )
                  .join('')
            : '<span class="note" style="margin:0">No badges yet — drop the badge pictures below.</span>';
    }
    // results
    const max = Math.max(0, ...d.rows.map((r) => r.points));
    $('totals').textContent = `${d.people} ${d.people === 1 ? 'person' : 'people'} voted · ${
        d.total
    } points`;
    $('results').innerHTML = d.rows.length
        ? d.rows
              .map(
                  (r) => `<div class="res-row ${r.leading ? 'lead' : ''}">
        <b>${r.number}</b>${r.image ? `<img src="${r.image}" alt="">` : '<span></span>'}
        <div><div style="font-size:13px;margin-bottom:3px">${esc(r.label || 'Badge ' + r.number)}${
                      r.leading && max ? ' 👑' : ''
                  }</div><div class="bar"><i style="width:${
                      max ? Math.round((r.points / max) * 100) : 0
                  }%"></i></div></div>
        <div class="pts"><b>${r.points}</b> pts<small>${r.voters} voter${
                      r.voters === 1 ? '' : 's'
                  }${
                      r.subVoters ? ` · ${r.subVoters} sub${r.subVoters === 1 ? '' : 's'}` : ''
                  }</small></div>
      </div>`
              )
              .join('')
        : '<span class="note" style="margin:0">Add badges to see results.</span>';
    $('voters').innerHTML = (d.voters || []).length
        ? d.voters
              .map(
                  (v) =>
                      `<div>${esc(v.name)}${v.sub ? '<span class="tag">SUB</span>' : ''} → ${v.picks
                          .map((n) => '#' + n)
                          .join(', ')}</div>`
              )
              .join('')
        : '<span class="note">Nobody has voted yet.</span>';
    timer();
}

function timer() {
    if (!S) return;
    if (S.open && S.endsAt) {
        const left = Math.max(0, Math.round((S.endsAt - Date.now()) / 1000));
        $('timerText').textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(
            2,
            '0'
        )} left`;
    } else
        $('timerText').textContent = S.open
            ? "Open with no timer — close it when you're ready"
            : '';
}

setInterval(timer, 500);

async function load() {
    const d = await api('/api/poll/admin');
    $('health').classList.toggle('offline', !d.ok);
    $('health').textContent = d.ok ? 'connected' : 'ICB offline';
    if (d.ok) render(d);
}

async function saveOptions(options) {
    const d = await api('/api/poll/options', 'PUT', { options });
    if (d.ok) await load();
}

async function saveTitle() {
    const d = await api('/api/poll/settings', 'PUT', { title: $('title').value });
    if (d.ok) {
        toast('Saved');
        load();
    }
}

async function setting(b) {
    const d = await api('/api/poll/settings', 'PUT', b);
    if (d.ok) load();
}

function rename(i, label) {
    const opts = S.options.map((o) => ({ ...o }));
    if (opts[i].label === label.trim()) return;
    opts[i].label = label.trim();
    saveOptions(opts);
}

function move(i, dir) {
    const opts = S.options.map((o) => ({ ...o }));
    const j = i + dir;
    [opts[i], opts[j]] = [opts[j], opts[i]];
    saveOptions(opts);
}

function removeBadge(i) {
    const o = S.options[i];
    if (
        !confirm(
            `Remove badge #${i + 1}${
                o.label ? ' (' + o.label + ')' : ''
            }? Votes for it are removed too. (The picture stays in the assets\\poll folder.)`
        )
    )
        return;
    saveOptions(S.options.filter((_, k) => k !== i));
}

async function upload(files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) return toast('Pick PNG, JPG, WEBP or GIF images');
    let n = 0;
    for (const f of list) {
        const dataUrl = await new Promise((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(r.result);

            r.onerror = fail;
            r.readAsDataURL(f);
        });
        const d = await api('/api/poll/image', 'POST', { dataUrl, name: f.name });
        if (d.ok) n++;
    }
    toast(`Added ${n} badge${n === 1 ? '' : 's'} — give them names if you like`);
    load();
}

async function openVoting() {
    const d = await api('/api/poll/open', 'POST', { minutes: Number($('minutes').value) || 0 });
    if (d.ok) {
        toast('Voting is open! Tell chat to type !vote and a number');
        load();
    }
}

async function closeVoting() {
    const d = await api('/api/poll/close', 'POST');
    if (d.ok) {
        toast('Voting closed');
        load();
    }
}

async function reveal() {
    if (!S.total && !confirm('Nobody has voted yet. Reveal anyway?')) return;
    const d = await api('/api/poll/reveal', 'POST', { revealed: true });
    if (d.ok) {
        toast('👑 Winner revealed on stream!');
        load();
    }
}

async function resetVotes() {
    if (!confirm("Clear ALL votes? This can't be undone.")) return;
    const d = await api('/api/poll/reset', 'POST');
    if (d.ok) {
        toast('Votes cleared');
        load();
    }
}

async function testVote() {
    const d = await api('/api/poll/test', 'POST', {
        name: $('testName').value,
        text: $('testText').value
    });
    if (d.ok) {
        toast(
            d.counted
                ? 'Test vote counted'
                : 'Not counted — is voting open, and is it like !vote 1?'
        );
        load();
    }
}

load();
setInterval(() => {
    if (!editing && document.visibilityState === 'visible') load();
}, 2000);
