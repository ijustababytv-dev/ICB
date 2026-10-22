const $ = (id) => document.getElementById(id);

let current = null;

const esc = (s) =>
    String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const longDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const TIER = { TIER_1: 'Tier 1', TIER_2: 'Tier 2', TIER_3: 'Tier 3', TWITCH_PRIME: 'Prime' };
const tier = (t) => TIER[t] || (t ? t.replace(/_/g, ' ').toLowerCase() : '');

const subKind = (e) => (e.subType === 'RESUB' ? 'Resub' : e.subType ? 'New sub' : 'Sub');

const KIND = {
    unicorns: 'fluffy unicorns',
    subMonths: 'months subbed',
    giftedSubs: 'gifted subs',
    bits: 'bits'
};

// Raw Firehose events (the listener's catch-all). Field names vary by
// platform/event, so these helpers look in the usual places and fall back
// to a short "key: value" summary rather than dropping anything.
const RAW_HANDLED = new Set([
    'chat',
    'sub',
    'gifts',
    'follow',
    'raid',
    'viewer_count',
    'viewer_list',
    'stream_status',
    'purchase',
    'stt',
    'meld',
    'connection'
]);
function nameOf(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    return v.displayname || v.username || v.name || '';
}

function whoIn(d) {
    return nameOf(
        d &&
            (d.sender ||
                d.follower ||
                d.subscriber ||
                d.purchaser ||
                d.host ||
                d.gifter ||
                d.user ||
                d.viewer ||
                d.liker)
    );
}

function textOf(d) {
    if (!d) return '';
    for (const k of ['text', 'message', 'content', 'body', 'transcript'])
        if (typeof d[k] === 'string' && d[k]) return d[k];
    for (const k of ['parts', 'fragments', 'message_parts', 'segments'])
        if (Array.isArray(d[k])) {
            const t = d[k]
                .map((p) =>
                    typeof p === 'string' ? p : (p && (p.text || p.content || p.name)) || ''
                )
                .join('');
            if (t.trim()) return t;
        }
    return '';
}

const SKIP_SUM = new Set([
    'event_type',
    'timestamp',
    'id',
    'UPID',
    'upid',
    'platform_id',
    'streamer',
    'sender',
    'follower',
    'subscriber',
    'purchaser',
    'host',
    'gifter',
    'user',
    'donations',
    'attributes',
    'text',
    'message',
    'parts',
    'fragments',
    'viewers'
]);
function summary(d, max = 8) {
    if (!d || typeof d !== 'object') return esc(String(d ?? ''));
    const out = [];
    for (const [k, v] of Object.entries(d)) {
        if (SKIP_SUM.has(k) || v === null || v === '' || typeof v === 'object') continue;
        out.push(`${k.replace(/_/g, ' ')}: ${v}`);
        if (out.length >= max) break;
    }
    return esc(out.join(' · '));
}

function sparkline(points) {
    if (points.length < 2) return '';
    const t0 = points[0].t,
        t1 = points[points.length - 1].t,
        max = Math.max(...points.map((p) => p.v), 1);
    const W = 900,
        H = 90,
        pad = 6;
    const xy = points
        .map(
            (p) =>
                `${pad + ((W - 2 * pad) * (p.t - t0)) / Math.max(1, t1 - t0)},${
                    H - pad - ((H - 2 * pad) * p.v) / max
                }`
        )
        .join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${xy}" fill="none" stroke="#d64fc4" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

async function init() {
    $('printLong').onchange = (e) => document.body.classList.toggle('print-long', e.target.checked);

    const r = await (await fetch('/api/activity/nights')).json();
    const nights = r.nights.slice();
    if (!nights.includes(r.tonight)) nights.unshift(r.tonight);
    $('night').innerHTML = nights
        .map(
            (n) =>
                `<option value="${n}">${longDate(n)}${n === r.tonight ? ' (tonight)' : ''}</option>`
        )
        .join('');
    $('night').onchange = () => load($('night').value);

    load(nights[0]);
}

async function load(key) {
    $('page').innerHTML = '<div class="empty-night">Loading…</div>';
    current = await (await fetch('/api/activity/night?date=' + encodeURIComponent(key))).json();
    render(current);
}

function table(headers, rows) {
    if (!rows.length) return '<div class="none">None this night.</div>';
    return `<table><thead><tr>${headers
        .map((h) => `<th class="${h.num ? 'num' : ''}">${h.label}</th>`)
        .join('')}</tr></thead>
      <tbody>${rows
          .map(
              (r) =>
                  `<tr>${r
                      .map(
                          (c, i) =>
                              `<td class="${headers[i].num ? 'num' : ''}${
                                  headers[i].t ? ' t' : ''
                              }">${c}</td>`
                      )
                      .join('')}</tr>`
          )
          .join('')}</tbody></table>`;
}

function downloadCsv() {
    if (!current) return;
    const rows = [['Date', 'Time', 'Event', 'Viewer', 'Details', 'Fluffy unicorns']];
    const T = {
        chat: 'Chat message',
        follow: 'Follow',
        sub: 'Sub',
        gifts: 'Gifted subs',
        bits: 'Cheer',
        raid: 'Raid',
        chat_unicorns: 'Chat unicorns',
        manual: 'Added by hand',
        winner: 'Giveaway winner',
        reset: 'Giveaway reset'
    };
    const RAW_DUP = new Set(['sub', 'gifts', 'follow', 'raid']); // already exported from the giveaway rows
    for (const e of current.events) {
        const d = new Date(e.at);
        if (e.type === 'chat') continue; // exported from the raw chat rows (those include the message text)
        if (e.type === 'raw') {
            if (RAW_DUP.has(e.kind)) continue;
            let det = '';
            if (e.kind === 'chat') {
                det = textOf(e.data);
                const dons =
                    e.data && Array.isArray(e.data.donations)
                        ? e.data.donations.filter((x) => x && x.type)
                        : [];
                if (dons.length)
                    det +=
                        (det ? ' · ' : '') +
                        dons
                            .map((x) =>
                                `${String(x.type).replace(/_/g, ' ').toLowerCase()} ${
                                    x.amount ?? ''
                                } ${x.currency || ''}`.trim()
                            )
                            .join(', ');
                if (e.data && Array.isArray(e.data.attributes) && e.data.attributes.length)
                    det += ` · [${e.data.attributes.join(', ')}]`;
            } else if (e.kind === 'viewer_list') {
                const list = (e.data && (e.data.viewers || e.data.users || e.data.list)) || [];
                det = `${Array.isArray(list) ? list.length : 0} viewers: ${(Array.isArray(list)
                    ? list
                    : []
                )
                    .map(nameOf)
                    .join(', ')}`;
            } else if (e.kind === 'viewer_count') {
                det = `${e.data && e.data.count} viewers`;
            } else {
                det =
                    textOf(e.data) ||
                    summary(e.data, 20)
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'");
            }
            rows.push([
                d.toLocaleDateString(),
                d.toLocaleTimeString(),
                e.kind === 'chat' ? 'Chat message' : e.kind,
                whoIn(e.data),
                det,
                ''
            ]);
            continue;
        }
        let details = '',
            uni = e.unicorns ?? '';
        if (e.type === 'sub')
            details = `${subKind(e)} · ${tier(e.tier)} · ${e.months || 1} month(s)`;
        else if (e.type === 'gifts')
            details = `${e.count} gifted · ${tier(e.tier)}${
                e.recipients && e.recipients.length ? ' · to ' + e.recipients.join(', ') : ''
            }`;
        else if (e.type === 'bits') details = `${e.amount} bits`;
        else if (e.type === 'raid') details = `${e.viewers} viewers`;
        else if (e.type === 'manual')
            details = `${e.amount} ${KIND[e.kind] || ''}${e.reason ? ' · ' + e.reason : ''}`;
        else if (e.type === 'winner')
            details = e.prize === 'mystery-outfit' ? 'Mystery Outfit' : 'Plushie';
        if (e.type === 'chat_unicorns') {
            for (const u of e.usernames)
                rows.push([
                    d.toLocaleDateString(),
                    d.toLocaleTimeString(),
                    T[e.type],
                    u,
                    '10 min of chatting',
                    e.each || 1
                ]);
            continue;
        }
        if (e.blocked) details += (details ? ' · ' : '') + 'not in giveaway';
        rows.push([
            d.toLocaleDateString(),
            d.toLocaleTimeString(),
            T[e.type] || e.type,
            e.username || '',
            details,
            uni
        ]);
    }
    const csv = rows
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `stream-report-${current.date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

init();
