'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const mConfig = require('./config');
const mStorage = require('./storage');
const mDomainValidation = require('./domain/validation');
const mParty = require('./domain/chat-text');
const feed = require('./cloud/state-feed');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');

// ---------------------------------------------------------------------------
// CHAT AVATARS (Baby, 2026-10-18). ICB version of her Meld element "ghost-stream-avatars":
// every chatter becomes a little sprite that wanders along the bottom of the stream with their
// name; their chat pops up in a speech bubble; subs / follows / raids get a cheer + bounce.
//   - Overlay /chat-avatars.html (Meld layer, full screen).  Dashboard /chat-avatars-control.html
//   - Pictures: assets/avatars/*.png (her 27 Fortnite sprites to start; she can add/turn off).
//   - Chatters always get the same avatar (hash), unless she assigns one or they type
//     "!avatar <name>" (e.g. "!avatar sonic") when that's allowed.
//   - Chat arrives through /api/activity/raw (text + emotes) and /api/giveaway/event (sub/follow/raid).
//   - Saved configuration is read from the cloud cache. Overlay polls GET /api/avatars?since=<id>.
// ---------------------------------------------------------------------------
const AV_FILE = path.join(mConfig.DATA_DIR, 'avatars.json');
const AV_DIR = path.join(mConfig.APP_DIR, 'assets', 'avatars');
try {
    fs.mkdirSync(AV_DIR, { recursive: true });
} catch (_error) {}
/** Create independent initial avatars settings for first-run or missing saved fields. */
function avDefaults() {
    return {
        visible: true,
        maxAvatars: 25,
        size: 100,
        speed: 100,
        bubbles: 'all',
        bubbleSec: 7,
        showNames: true,
        textSize: 100,
        bottom: 2,
        leftEdge: 5,
        rightEdge: 95,
        idleMin: 0,
        ignore: 'Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Sery_Bot, MixItUpBot',
        sayCmds: 'say, avatar, ghost',
        pickCmd: true,
        colors: '#38bdf8, #c084fc, #34d399, #fbbf24, #f43f5e, #22d3ee',
        onlyCmdShow: false,
        subOn: true,
        subMsg: 'Subscribed! 🎉',
        followOn: true,
        followMsg: 'Followed! ⭐',
        raidOn: true,
        raidMsg: 'Raided with {n}! 🚀',
        bitsOn: true,
        bitsMsg: 'Cheered {n} bits! 💎',
        bounceAllOnSub: true,
        disabled: [],
        assign: {},
        epoch: 1
    };
}

/** Restore avatars state from disk and supply defaults for missing fields. */
function avLoad() {
    const raw = feed.document('avatars.json') || {};
    const d = { ...avDefaults(), ...raw };
    d.assign = d.assign && typeof d.assign === 'object' ? d.assign : {};
    d.disabled = Array.isArray(d.disabled) ? d.disabled : [];
    return d;
}

let av = avLoad();
let avEvents = [],
    avSeq = 1;
const avSeen = new Map(); // lower name -> { name, at, avatar }

let visualOwner = null;
/** Refresh confirmed preferences and clear another account's transient visuals. */
function refreshVisuals() {
    const owner = require('./cloud/session').current()?.account.id || null;
    if (owner !== visualOwner) {
        avEvents = [];
        avSeen.clear();
        visualOwner = owner;
        avSeq++;
    }
    av = avLoad();
}

/** Locate supported local avatars artwork while tolerating missing files. */
function avFiles() {
    try {
        return fs
            .readdirSync(AV_DIR)
            .filter((f) => mDomainValidation.DECOR_IMAGE_EXT.test(f))
            .sort();
    } catch (_e) {
        return [];
    }
}

const avIdOf = (f) => f.replace(/\.[a-z0-9]+$/i, '');

const avNice = (id) =>
    id
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

/** Exclude disabled artwork from random avatar assignment. */
function avPool() {
    return avFiles().filter((f) => !av.disabled.includes(avIdOf(f)));
}

/** Resolve local avatars artwork to the URL used by its display. */
function avUrl(f) {
    let v = 0;
    try {
        v = Math.round(fs.statSync(path.join(AV_DIR, f)).mtimeMs);
    } catch (_e) {}
    return `/assets/avatars/${encodeURIComponent(f)}?v=${v}`;
}

/** Choose an enabled avatar using per-viewer assignment or stable fallback selection. */
function avFor(name) {
    const key = String(name).toLowerCase(),
        files = avFiles(),
        pool = avPool();
    const a = av.assign[key];
    if (a) {
        const f = files.find((x) => avIdOf(x) === a);
        if (f) return f;
    }
    const list = pool.length ? pool : files;
    if (!list.length) return null;
    let h = 0;
    for (let i = 0; i < key.length; i++) {
        h = (h << 5) - h + key.charCodeAt(i);
        h |= 0;
    }
    return list[Math.abs(h) % list.length];
}

const avIgnored = (name) =>
    String(av.ignore || '')
        .split(/[\s,]+/)
        .map((s) => s.toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
        .includes(String(name).toLowerCase());

/** Append a bounded overlay event with a monotonically increasing cursor. */
function avPush(kind, name, extra) {
    const f = name ? avFor(name) : null;
    const ev = {
        id: avSeq++,
        kind,
        name: name || '',
        avatar: f ? avUrl(f) : null,
        at: Date.now(),
        ...(extra || {})
    };
    avEvents.push(ev);
    if (avEvents.length > 300) avEvents = avEvents.slice(-300);
    if (name)
        avSeen.set(name.toLowerCase(), { name, at: Date.now(), avatar: f ? avIdOf(f) : null });
    if (avSeen.size > 400) avSeen.delete(avSeen.keys().next().value);
    return ev;
}

// Chat text -> parts the overlay can draw: [{t:'text', v}, {t:'emote', url}]
function avChat(sender, parts) {
    refreshVisuals();
    const name = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
    if (!name || avIgnored(name)) return '';
    const text = mParty
        .partyDecode(
            (parts || [])
                .filter((x) => x.t === 'text')
                .map((x) => x.v)
                .join(' ')
        )
        .trim();
    // "!avatar sonic" picks your own avatar (when allowed); "!avatar" alone just waves.
    const cmds = String(av.sayCmds || '')
        .split(/[\s,]+/)
        .map((s) => s.toLowerCase().replace(/^!/, ''))
        .filter(Boolean);
    const cm = /^!([a-z0-9_]+)\s*(.*)$/i.exec(text);
    const isSay = cm && cmds.includes(cm[1].toLowerCase());
    let show = (parts || []).map((p) =>
        p.t === 'emote' ? { t: 'emote', url: p.url } : { t: 'text', v: mParty.partyDecode(p.v) }
    );
    if (isSay) {
        const rest = cm[2];
        show = rest ? [{ t: 'text', v: rest }] : [];
    } else if (/^!/.test(text)) show = []; // other commands: just appear, no bubble
    if (av.onlyCmdShow && !isSay && !avSeen.has(name.toLowerCase())) return '';
    const bubble =
        av.bubbles === 'all' ? show : av.bubbles === 'commands' ? (isSay ? show : []) : [];
    avPush('chat', name, { parts: bubble.slice(0, 40) });
    return 'ok';
}

/** Translate supported stream events into avatar reactions. */
function avEvent(type, username, body) {
    refreshVisuals();
    const name = mDomainValidation.cleanString(username).replace(/^@/, '').slice(0, 40);
    if (!name || avIgnored(name)) return;
    const n =
        type === 'raid'
            ? Math.max(0, Math.trunc(Number(body.viewers)) || 0)
            : type === 'bits'
            ? Math.max(0, Math.trunc(Number(body.amount)) || 0)
            : 0;
    const msg = (t) => String(t || '').replace(/\{n\}/g, n);

    if ((type === 'sub' || type === 'gifts') && av.subOn)
        avPush('cheer', name, {
            text: type === 'gifts' ? `Gifted ${body.count || ''} subs! 🎁` : msg(av.subMsg),
            all: !!av.bounceAllOnSub
        });
    else if (type === 'follow' && av.followOn) avPush('cheer', name, { text: msg(av.followMsg) });
    else if (type === 'raid' && av.raidOn)
        avPush('cheer', name, { text: msg(av.raidMsg), all: true });
    else if (type === 'bits' && av.bitsOn) avPush('cheer', name, { text: msg(av.bitsMsg) });
}

/** Build the avatars response consumed by dashboards and overlays. */
function avPublic() {
    refreshVisuals();
    const pick = [
        'visible',
        'maxAvatars',
        'size',
        'speed',
        'bubbles',
        'bubbleSec',
        'showNames',
        'textSize',
        'bottom',
        'leftEdge',
        'rightEdge',
        'idleMin'
    ];
    const o = {
        ok: true,
        epoch: av.epoch,
        colors: String(av.colors || '')
            .split(/[\s,]+/)
            .filter((c) => /^#[0-9a-f]{6}$/i.test(c))
    };
    for (const k of pick) o[k] = av[k];
    return o;
}

/** Validate and dispatch avatars API requests, returning client errors for invalid input. */
async function handleAvatarsApi(req, res, pathname, method) {
    try {
        if (pathname === '/api/avatars' && method === 'GET') {
            const q = new URL(req.url, 'http://x').searchParams,
                since = Number(q.get('since')) || 0;
            // First load (?first=1) gets only the newest id, so old chat doesn't replay.
            return mHttpResponse.sendJson(res, 200, {
                ...avPublic(),
                last: avSeq - 1,
                events: q.get('first') ? [] : avEvents.filter((e) => e.id > since),
                now: Date.now()
            });
        }
        if (pathname === '/api/avatars/admin' && method === 'GET') {
            const files = avFiles();
            return mHttpResponse.sendJson(res, 200, {
                ...avPublic(),
                settings: av,
                avatars: files.map((f) => ({
                    id: avIdOf(f),
                    name: avNice(avIdOf(f)),
                    url: avUrl(f),
                    on: !av.disabled.includes(avIdOf(f))
                })),
                chatters: Array.from(avSeen.values())
                    .sort((a, b) => b.at - a.at)
                    .slice(0, 60)
                    .map((c) => ({
                        ...c,
                        avatar: (avFor(c.name) && avIdOf(avFor(c.name))) || null,
                        assigned: av.assign[c.name.toLowerCase()] || null
                    })),
                assigned: Object.entries(av.assign).map(([k, v]) => ({ name: k, avatar: v }))
            });
        }
        return mHttpResponse.sendJson(res, 404, {
            ok: false,
            error: 'Unknown avatar display route.'
        });
    } catch (error) {
        return mHttpResponse.sendJson(res, 400, {
            ok: false,
            error: error.message || 'Chat avatars request failed.'
        });
    }
}

Object.assign(exports, { avEvent, avChat, handleAvatarsApi });
