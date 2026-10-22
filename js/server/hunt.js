'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mParty = require('./party');
const mHttpResponse = require('./http/response');
const mResources = require('./resources');
const mHttpBody = require('./http/body');

// ---------------------------------------------------------------------------
// TEAM HUNT (Baby, 2026-10-19). ICB version of her Meld "cloth-team-contest" widget, bigger:
//   - As many teams as she wants. Chat joins with "!team a" (or the team's own key/name).
//   - Several things to hunt at once, each with its own command + points: "!cloth" = 10 pts,
//     "!plushie" = 8 pts... "!cloth 2" = found 2. Finds are saved per item, so changing an
//     item's points later re-scores everyone.
//   - Contest timer (start/pause/reset from the dashboard), winner banner when it ends.
//   - Overlay /hunt.html, dashboard /hunt-control.html, data/hunt.json.
// ---------------------------------------------------------------------------
const HUNT_FILE = path.join(mConfig.DATA_DIR, 'hunt.json');
const HUNT_COLORS = [
    '#06b6d4',
    '#d946ef',
    '#f59e0b',
    '#22c55e',
    '#f43f5e',
    '#8b5cf6',
    '#14b8a6',
    '#eab308',
    '#3b82f6',
    '#ec4899',
    '#84cc16',
    '#f97316'
];
/** Create independent initial hunt settings for first-run or missing saved fields. */
function huntDefaults() {
    return {
        title: 'Team Hunt',
        subtitle: 'Find them in Palia - type the command when you get one!',
        visible: true,
        joinOpen: true,
        scoring: true,
        lockTeams: true,
        ignore: 'Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Sery_Bot, MixItUpBot',
        teams: [
            { key: 'a', name: 'Team A', color: HUNT_COLORS[0] },
            { key: 'b', name: 'Team B', color: HUNT_COLORS[1] }
        ],
        items: [
            {
                command: 'cloth',
                aliases: 'cloths',
                label: 'Tattered Cloth',
                pts: 10,
                icon: '🧵',
                image: ''
            },
            {
                command: 'plushie',
                aliases: 'plush, plushies',
                label: 'Plushie',
                pts: 8,
                icon: '🧸',
                image: ''
            }
        ],
        players: {},
        log: [],
        seq: 1,
        timer: { minutes: 60, status: 'idle', endsAt: 0, leftMs: 0 },
        stopAtEnd: true,
        look: {
            theme: 'spooky',
            scale: 100,
            x: 50,
            y: 50,
            width: 46,
            showPlayers: 8,
            showLegend: true,
            showTicker: true,
            showTimer: true,
            showBar: true
        },
        epoch: 1
    };
}

const huntKey = (v) =>
    mDomainValidation
        .cleanString(v)
        .toLowerCase()
        .replace(/^!+/, '')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20);

/** Normalize incoming hunt values to the supported fields and limits. */
function huntCleanTeam(t, i) {
    return {
        key: huntKey(t.key) || 'abcdefghijklmnopqrstuvwxyz'[i % 26],
        name:
            mDomainValidation.cleanString(t.name).slice(0, 30) ||
            `Team ${String(t.key || i + 1).toUpperCase()}`,
        color: /^#[0-9a-f]{6}$/i.test(String(t.color || ''))
            ? t.color
            : HUNT_COLORS[i % HUNT_COLORS.length]
    };
}

/** Normalize incoming hunt values to the supported fields and limits. */
function huntCleanItem(o) {
    const image = o.image ? path.basename(String(o.image)) : '';
    return {
        command: huntKey(o.command) || 'point',
        aliases: String(o.aliases || '')
            .split(/[\s,]+/)
            .map(huntKey)
            .filter(Boolean)
            .slice(0, 8)
            .join(', '),
        label: mDomainValidation.cleanString(o.label).slice(0, 40),
        pts: Math.max(-1000, Math.min(100000, Math.round(Number(o.pts)) || 0)),
        icon: mDomainValidation.cleanString(o.icon).slice(0, 8),
        image: image && mDomainValidation.DECOR_IMAGE_EXT.test(image) ? image : ''
    };
}

/** Restore hunt state from disk and supply defaults for missing fields. */
function huntLoad() {
    const raw = mStorage.readJson(HUNT_FILE, null) || {},
        d = huntDefaults();
    const h = {
        ...d,
        ...raw,
        timer: { ...d.timer, ...(raw.timer || {}) },
        look: { ...d.look, ...(raw.look || {}) }
    };
    h.teams = (Array.isArray(h.teams) && h.teams.length ? h.teams : d.teams)
        .slice(0, 26)
        .map(huntCleanTeam);
    h.items = (Array.isArray(h.items) ? h.items : d.items).slice(0, 20).map(huntCleanItem);
    h.players = h.players && typeof h.players === 'object' ? h.players : {};
    for (const p of Object.values(h.players))
        if (!p.finds || typeof p.finds !== 'object') p.finds = {};
    h.log = Array.isArray(h.log) ? h.log.slice(-200) : [];
    return h;
}

let hunt = huntLoad();
/** Persist operator changes to the hunt state file. */
function huntSave() {
    mStorage.writeJson(HUNT_FILE, hunt);
    mEvents.broadcast('hunt', { ok: true });
}

/** Price a player's recorded finds using the current hunt item point values. */
function huntPts(p) {
    let s = 0;
    for (const it of hunt.items) s += (Number(p.finds[it.command]) || 0) * it.pts;
    return s;
}

/** Report remaining contest time consistently across idle, running, paused, and done states. */
function huntTimerLeft(now) {
    const t = hunt.timer;
    return t.status === 'running'
        ? Math.max(0, t.endsAt - now)
        : t.status === 'paused'
        ? t.leftMs
        : t.status === 'idle'
        ? t.minutes * 60000
        : 0;
}

/** Finish a running hunt when its deadline expires. */
function huntTick() {
    const t = hunt.timer;
    if (t.status === 'running' && t.endsAt <= Date.now()) {
        t.status = 'ended';
        if (hunt.stopAtEnd) hunt.scoring = false;
        huntLog({ kind: 'end' });
        huntSave();
    }
}

/** Aggregate player scores into team standings for the active contest. */
function huntBoard() {
    const board = hunt.teams.map((t) => ({
        key: t.key,
        name: t.name,
        color: t.color,
        total: 0,
        players: []
    }));
    const by = new Map(board.map((b) => [b.key, b]));
    for (const p of Object.values(hunt.players)) {
        const b = by.get(p.team);
        if (!b) continue;
        const pts = huntPts(p);
        b.players.push({ name: p.name, points: pts, joined: p.joined || 0 });
        b.total += pts;
    }
    for (const b of board) b.players.sort((x, y) => y.points - x.points || x.joined - y.joined);
    const max = board.reduce((a, b) => Math.max(a, b.total), 0);
    for (const b of board) b.leading = max > 0 && b.total === max;
    return board;
}

/** Build the hunt response consumed by dashboards and overlays. */
function huntPublic() {
    const now = Date.now();
    return {
        ok: true,
        title: hunt.title,
        subtitle: hunt.subtitle,
        visible: hunt.visible,
        joinOpen: hunt.joinOpen,
        scoring: hunt.scoring,
        look: hunt.look,
        epoch: hunt.epoch,
        items: hunt.items.map((it) => ({
            ...it,
            imageUrl: it.image ? `/assets/resources/${encodeURIComponent(it.image)}` : null
        })),
        teams: hunt.teams,
        board: huntBoard(),
        timer: {
            status: hunt.timer.status,
            minutes: hunt.timer.minutes,
            endsAt: hunt.timer.endsAt,
            left: huntTimerLeft(now)
        },
        recent: hunt.log.slice(-10),
        last: hunt.seq - 1,
        now
    };
}

/** Append a timestamped, bounded hunt action record for dashboard review. */
function huntLog(e) {
    e.id = hunt.seq++;
    e.at = Date.now();
    hunt.log.push(e);
    if (hunt.log.length > 200) hunt.log = hunt.log.slice(-200);
}

const huntTeamName = (k) => {
    const t = hunt.teams.find((x) => x.key === k);
    return t ? t.name : `Team ${String(k).toUpperCase()}`;
};

/** Resolve a team by its configured command key or display name. */
function huntFindTeam(word) {
    const w = huntKey(word);
    if (!w) return null;
    return (
        hunt.teams.find((t) => t.key === w) ||
        hunt.teams.find((t) => huntKey(t.name) === w) ||
        hunt.teams.find((t) => huntKey(t.name.replace(/^team\s*/i, '')) === w) ||
        null
    );
}

/** Apply a scoring change and append its contest audit record. */
function huntAdd(key, cmd, n, how) {
    const p = hunt.players[key];
    if (!p) return '';
    const it = hunt.items.find((x) => x.command === cmd);
    if (!it) return '';
    const before = Number(p.finds[cmd]) || 0,
        after = Math.max(0, before + n),
        applied = after - before;
    if (!applied) return `${p.name} has none to take away`;
    p.finds[cmd] = after;
    huntLog({
        kind: 'find',
        name: p.name,
        key,
        team: p.team,
        item: cmd,
        label: it.label,
        icon: it.icon,
        n: applied,
        pts: applied * it.pts,
        total: huntPts(p),
        how
    });
    huntSave();
    return `${p.name} ${applied > 0 ? '+' : ''}${applied} ${it.label || cmd} (${
        applied * it.pts > 0 ? '+' : ''
    }${applied * it.pts} pts)`;
}

/** Interpret supported hunt chat commands while preserving unrelated messages. */
function huntChat(name, parts) {
    name = mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
    if (!name) return '';
    if (
        String(hunt.ignore || '')
            .split(/[\s,]+/)
            .map((s) => s.toLowerCase().replace(/^@/, ''))
            .filter(Boolean)
            .includes(name.toLowerCase())
    )
        return '';
    const text = mParty
        .partyDecode(
            (parts || [])
                .filter((x) => x.t === 'text')
                .map((x) => x.v)
                .join(' ')
        )
        .trim();
    if (text[0] !== '!') return '';
    const key = name.toLowerCase();
    let m = /^!(?:team|join)\s+(.+)$/i.exec(text);
    if (m) {
        const t = huntFindTeam(m[1].split(/\s+/)[0]) || huntFindTeam(m[1]);
        if (!t) return `${name}: there is no team "${m[1]}"`;
        const ex = hunt.players[key];
        if (ex && ex.team === t.key) return `${name} is already on ${t.name}`;
        if (ex && ex.team && hunt.lockTeams)
            return `${name} is already on ${huntTeamName(ex.team)} (locked)`;
        if (!hunt.joinOpen) return `${name}: joining is closed`;
        hunt.players[key] = {
            name,
            team: t.key,
            finds: (ex && ex.finds) || {},
            joined: (ex && ex.joined) || Date.now()
        };
        huntLog({ kind: 'join', name, team: t.key });
        huntSave();
        return `${name} joined ${t.name}`;
    }
    m = /^!([a-z0-9_]+)(?:\s+([+-]?)\s*(\d{1,3}))?(?:\s|$)/i.exec(text);
    if (!m) return '';
    const c = m[1].toLowerCase();
    const it = hunt.items.find(
        (x) => x.command === c || (x.aliases && x.aliases.split(/,\s*/).includes(c))
    );
    if (!it) return '';
    if (!hunt.scoring) return `${name}: the hunt isn't scoring right now`;
    const p = hunt.players[key];
    if (!p || !hunt.teams.some((t) => t.key === p.team)) {
        huntLog({ kind: 'noteam', name, item: it.command });
        huntSave();
        return `${name} isn't on a team yet`;
    }
    let n = m[3] ? Math.min(50, Number(m[3])) : 1;
    if (m[2] === '-') n = -n;
    return n ? huntAdd(key, it.command, n, 'chat') : '';
}

/** Validate and dispatch hunt API requests, returning client errors for invalid input. */

const createHuntApi = require('./hunt-api')({
    fs: fs,

    mDomainValidation: mDomainValidation,

    mHttpResponse: mHttpResponse,

    mResources: mResources,

    mHttpBody: mHttpBody,

    huntCleanTeam: huntCleanTeam,

    huntCleanItem: huntCleanItem,

    get hunt() {
        return hunt;
    },

    huntSave: huntSave,

    huntPts: huntPts,

    huntTick: huntTick,

    huntPublic: huntPublic,

    huntLog: huntLog,

    huntFindTeam: huntFindTeam,

    huntAdd: huntAdd,

    huntChat: huntChat
});
const handleHuntApi = createHuntApi.handleHuntApi;

Object.assign(exports, { huntChat, handleHuntApi });

exports.huntTick = huntTick;
