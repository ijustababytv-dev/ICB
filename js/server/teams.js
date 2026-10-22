'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mResources = require('./resources');
const mGiveawayState = require('./giveaway/state');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');

// ---------------------------------------------------------------------------
// TEAM CONTEST (Baby, 2026-10-05) - grinding-party contest on stream.
// Chat joins with "!team a" (b, c, d... up to the number of teams set on the
// dashboard). Once on a team they're LOCKED - only Baby can move them.
// She picks ONE thing to count (e.g. command "cloth"); then "!cloth" = +1,
// "!cloth +2" = +2, "!cloth -1" = -1 (never below 0, no upper limit).
// Points are saved per item, so switching back to an old item brings its
// points back. Team totals = sum of their players.
//   - Overlay:   /teams.html      - Dashboard: /teams-control.html
//   - Saved in data/teams.json
// ---------------------------------------------------------------------------
const TEAMS_FILE = path.join(mConfig.DATA_DIR, 'teams.json');
const TEAM_LETTERS = 'abcdefgh';
const TEAM_COLORS = [
    '#ff6fb5',
    '#5ec8ff',
    '#7ee081',
    '#ffd166',
    '#b77cff',
    '#ff9f5a',
    '#4ee6c8',
    '#ff5c6c'
];
/** Create independent initial teams settings for first-run or missing saved fields. */
function teamsDefaults() {
    return {
        title: 'Grinding Party Contest!',
        teamCount: 2,
        teams: TEAM_LETTERS.split('').map((l, i) => ({
            letter: l,
            name: `Team ${l.toUpperCase()}`,
            color: TEAM_COLORS[i]
        })),
        item: { command: 'cloth', aliases: '', label: 'Tattered Cloth', image: null },
        presets: [
            { command: 'cloth', aliases: '', label: 'Tattered Cloth', image: 'tattered_cloth.png' },
            {
                command: 'spore',
                aliases: 'spores',
                label: 'Shmole Spores',
                image: 'Shmole_Spores.png'
            },
            { command: 'plushie', aliases: 'plush', label: 'Plushies', image: null }
        ],
        joinOpen: true,
        counting: true,
        showPlayers: 8,
        showBanner: true,
        visible: true,
        players: {},
        log: [],
        seq: 1
    };
}

/** Normalize incoming teams values to the supported fields and limits. */
function teamsCleanCmd(v) {
    return mDomainValidation
        .cleanString(v)
        .toLowerCase()
        .replace(/^!+/, '')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 24);
}

/** Normalize incoming teams values to the supported fields and limits. */
function teamsCleanItem(o) {
    o = o || {};
    const image = o.image ? path.basename(String(o.image)) : null;
    return {
        command: teamsCleanCmd(o.command) || 'point',
        aliases: String(o.aliases || '')
            .split(/[\s,]+/)
            .map(teamsCleanCmd)
            .filter(Boolean)
            .slice(0, 6)
            .join(', '),
        label: mDomainValidation.cleanString(o.label).slice(0, 60),
        image: image && mDomainValidation.DECOR_IMAGE_EXT.test(image) ? image : null
    };
}

/** Restore teams state from disk and supply defaults for missing fields. */
function teamsLoad() {
    const raw = mStorage.readJson(TEAMS_FILE, null) || {};
    const d = teamsDefaults();
    const t = { ...d, ...raw };
    t.teamCount = Math.max(2, Math.min(8, Math.round(Number(t.teamCount) || 2)));
    t.teams = d.teams.map((def, i) => {
        const r =
            (Array.isArray(raw.teams) ? raw.teams : []).find((x) => x && x.letter === def.letter) ||
            {};
        return {
            letter: def.letter,
            name: mDomainValidation.cleanString(r.name).slice(0, 40) || def.name,
            color: /^#[0-9a-f]{6}$/i.test(String(r.color || '')) ? r.color : def.color
        };
    });
    t.item = teamsCleanItem(t.item);
    t.presets = (Array.isArray(t.presets) ? t.presets : []).slice(0, 30).map(teamsCleanItem);
    t.players = t.players && typeof t.players === 'object' ? t.players : {};
    for (const p of Object.values(t.players)) {
        if (!p.points || typeof p.points !== 'object') p.points = {};
    }
    t.log = Array.isArray(t.log) ? t.log.slice(-200) : [];
    t.showPlayers = Math.max(0, Math.min(30, Math.round(Number(t.showPlayers)) || 0));
    return t;
}

let teams = teamsLoad();
/** Persist operator changes to the teams state file. */
function teamsSave() {
    mStorage.writeJson(TEAMS_FILE, teams);
    mEvents.broadcast('teams', teamsPublic());
}

/** Limit the contest to the configured number of visible teams. */
function teamsActive() {
    return teams.teams.slice(0, teams.teamCount);
}

/** Aggregate player points into current-item team standings. */
function teamsBoard() {
    const cmd = teams.item.command;
    const board = teamsActive().map((tm) => ({
        letter: tm.letter,
        name: tm.name,
        color: tm.color,
        total: 0,
        players: []
    }));
    const byLetter = new Map(board.map((b) => [b.letter, b]));
    for (const p of Object.values(teams.players)) {
        const b = byLetter.get(p.team);
        if (!b) continue;
        const pts = Number(p.points[cmd]) || 0;
        b.players.push({ name: p.name, points: pts, joined: p.joined || 0 });
        b.total += pts;
    }
    for (const b of board) b.players.sort((x, y) => y.points - x.points || x.joined - y.joined);
    const max = board.reduce((a, b) => Math.max(a, b.total), 0);
    for (const b of board) b.leading = max > 0 && b.total === max;
    return board;
}

/** Build the teams response consumed by dashboards and overlays. */
function teamsPublic() {
    const item = teams.item;
    // If the picture is one of her tracker cards, reuse that card's number box so
    // the grand total sits right in the art's empty box.
    let valueBox = null;
    try {
        const c =
            item.image &&
            (mResources.resourceTrackers.cards || []).find(
                (x) => x && x.image === item.image && x.valueBox
            );
        if (c) valueBox = c.valueBox;
    } catch (_e) {}
    return {
        ok: true,
        title: teams.title,
        teamCount: teams.teamCount,
        item: {
            ...item,
            imageUrl: item.image ? `/assets/resources/${encodeURIComponent(item.image)}` : null,
            valueBox
        },
        joinOpen: teams.joinOpen,
        counting: teams.counting,
        showPlayers: teams.showPlayers,
        showBanner: teams.showBanner,
        visible: teams.visible,
        board: teamsBoard(),
        recent: teams.log.slice(-12),
        now: Date.now()
    };
}

/** Append a timestamped, bounded teams action record for dashboard review. */
function teamsLog(entry) {
    entry.id = teams.seq++;
    entry.at = Date.now();
    teams.log.push(entry);
    if (teams.log.length > 200) teams.log = teams.log.slice(-200);
}

// Returns a short result string (for the dashboard's test box) or '' if ignored.
function teamsChat(name, parts) {
    name = mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
    if (!name || mGiveawayState.isBlocked(name)) return '';
    const text = (parts || [])
        .filter((x) => x.t === 'text')
        .map((x) => x.v)
        .join(' ')
        .trim();
    if (text[0] !== '!') return '';
    const key = name.toLowerCase();
    let m = /^!team\s+([a-h])\b/i.exec(text);
    if (m) {
        const letter = m[1].toLowerCase();
        if (TEAM_LETTERS.indexOf(letter) >= teams.teamCount)
            return `${name}: there is no team ${letter.toUpperCase()}`;
        const existing = teams.players[key];
        if (existing && existing.team)
            return `${name} is already on ${teamsName(existing.team)} (locked)`;
        if (!teams.joinOpen) return `${name}: joining is closed`;
        teams.players[key] = {
            name,
            team: letter,
            points: (existing && existing.points) || {},
            joined: Date.now()
        };
        teamsLog({ kind: 'join', name, team: letter });
        teamsSave();
        return `${name} joined ${teamsName(letter)}`;
    }
    const cmds = [teams.item.command]
        .concat(teams.item.aliases ? teams.item.aliases.split(/,\s*/) : [])
        .filter(Boolean);
    m = /^!([a-z0-9_]+)(?:\s+([+-]?)\s*(\d{1,6}))?(?:\s|$)/i.exec(text);
    if (!m || cmds.indexOf(m[1].toLowerCase()) < 0) return '';
    if (!teams.counting) return `${name}: counting is paused`;
    const p = teams.players[key];
    if (!p || !p.team || TEAM_LETTERS.indexOf(p.team) >= teams.teamCount)
        return `${name} isn't on a team yet`;
    let amount = m[3] ? Number(m[3]) : 1;
    if (m[2] === '-') amount = -amount;
    if (!amount) return '';
    return teamsAdd(key, amount, 'chat');
}

/** Use the configured team name, falling back to its letter label. */
function teamsName(letter) {
    const t = teams.teams.find((x) => x.letter === letter);
    return t ? t.name : `Team ${String(letter).toUpperCase()}`;
}

/** Apply a current-item point adjustment and retain its undo information. */
function teamsAdd(key, amount, how) {
    const p = teams.players[key];
    if (!p) return '';
    const cmd = teams.item.command;
    const before = Number(p.points[cmd]) || 0;
    const after = Math.max(0, before + amount);
    const applied = after - before;
    if (!applied) return `${p.name} is already at 0`;
    p.points[cmd] = after;
    teamsLog({
        kind: 'points',
        name: p.name,
        key,
        team: p.team,
        item: cmd,
        amount: applied,
        total: after,
        how
    });
    teamsSave();
    return `${p.name} ${applied > 0 ? '+' : ''}${applied} → ${after}`;
}

/** Validate and dispatch teams API requests, returning client errors for invalid input. */
async function handleTeamsApi(req, res, pathname, method) {
    try {
        if (pathname === '/api/teams' && method === 'GET')
            return mHttpResponse.sendJson(res, 200, teamsPublic());
        if (pathname === '/api/teams/admin' && method === 'GET') {
            const art = (() => {
                try {
                    return fs
                        .readdirSync(mResources.RESOURCE_ART_DIR)
                        .filter((f) => mDomainValidation.DECOR_IMAGE_EXT.test(f))
                        .sort((a, b) => a.localeCompare(b));
                } catch (_e) {
                    return [];
                }
            })();
            const players = Object.entries(teams.players)
                .map(([key, p]) => ({
                    key,
                    name: p.name,
                    team: p.team,
                    points: Number(p.points[teams.item.command]) || 0
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            return mHttpResponse.sendJson(res, 200, {
                ...teamsPublic(),
                teams: teams.teams,
                presets: teams.presets,
                players,
                log: teams.log.slice(-60).reverse(),
                art
            });
        }
        const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await mHttpBody.readBody(req) : {};
        if (pathname === '/api/teams/settings' && method === 'POST') {
            if (typeof body.title === 'string')
                teams.title = mDomainValidation.cleanString(body.title).slice(0, 120);
            if (body.teamCount !== undefined)
                teams.teamCount = Math.max(2, Math.min(8, Math.round(Number(body.teamCount)) || 2));
            for (const k of ['joinOpen', 'counting', 'showBanner', 'visible'])
                if (typeof body[k] === 'boolean') teams[k] = body[k];
            if (body.showPlayers !== undefined)
                teams.showPlayers = Math.max(
                    0,
                    Math.min(30, Math.round(Number(body.showPlayers)) || 0)
                );
            if (Array.isArray(body.teams)) {
                for (const r of body.teams) {
                    const t = r && teams.teams.find((x) => x.letter === r.letter);
                    if (!t) continue;
                    if (typeof r.name === 'string')
                        t.name =
                            mDomainValidation.cleanString(r.name).slice(0, 40) ||
                            `Team ${t.letter.toUpperCase()}`;
                    if (/^#[0-9a-f]{6}$/i.test(String(r.color || ''))) t.color = r.color;
                }
            }
            if (body.item) teams.item = teamsCleanItem(body.item);
            if (Array.isArray(body.presets))
                teams.presets = body.presets.slice(0, 30).map(teamsCleanItem);
            teamsSave();
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        // Baby's fixes: { key, amount } adds/removes points for the current item.
        if (pathname === '/api/teams/points' && method === 'POST') {
            const key = mDomainValidation.cleanString(body.key).toLowerCase();
            if (!teams.players[key])
                return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Player not found.' });
            const amount = Math.round(Number(body.amount) || 0);
            if (body.set !== undefined) {
                const cur = Number(teams.players[key].points[teams.item.command]) || 0;
                return mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    result: teamsAdd(
                        key,
                        Math.max(0, Math.round(Number(body.set) || 0)) - cur,
                        'dashboard'
                    )
                });
            }
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                result: teamsAdd(key, amount, 'dashboard')
            });
        }
        // Add someone by hand / move them: { name, team }  (team '' = remove).
        if (pathname === '/api/teams/player' && method === 'POST') {
            const name = mDomainValidation.cleanString(body.name).replace(/^@/, '').slice(0, 40);
            if (!name)
                return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Name needed.' });
            const key = name.toLowerCase();
            const team = String(body.team || '').toLowerCase();
            if (!team) {
                if (teams.players[key]) {
                    teamsLog({ kind: 'removed', name: teams.players[key].name });
                    delete teams.players[key];
                }
                teamsSave();
                return mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (TEAM_LETTERS.indexOf(team) < 0 || team.length !== 1)
                return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Unknown team.' });
            const p = teams.players[key];
            if (p) {
                p.team = team;
                teamsLog({ kind: 'moved', name: p.name, team });
            } else {
                teams.players[key] = { name, team, points: {}, joined: Date.now() };
                teamsLog({ kind: 'join', name, team, how: 'dashboard' });
            }
            teamsSave();
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        // Undo one scoring line from the log: { id }
        if (pathname === '/api/teams/undo' && method === 'POST') {
            const e = teams.log.find(
                (x) => x.id === Number(body.id) && x.kind === 'points' && !x.undone
            );
            if (!e)
                return mHttpResponse.sendJson(res, 404, {
                    ok: false,
                    error: 'Nothing to undo there.'
                });
            const p = teams.players[e.key];
            if (p) p.points[e.item] = Math.max(0, (Number(p.points[e.item]) || 0) - e.amount);
            e.undone = true;
            teamsSave();
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        // Reset points: { scope: 'item' (current item only) | 'all' }. Teams stay.
        if (pathname === '/api/teams/reset' && method === 'POST') {
            for (const p of Object.values(teams.players)) {
                if (body.scope === 'all') p.points = {};
                else delete p.points[teams.item.command];
            }
            teamsLog({
                kind: 'reset',
                item: body.scope === 'all' ? 'everything' : teams.item.command
            });
            teamsSave();
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        // Clear teams: everyone off their team (and their points), new contest.
        if (pathname === '/api/teams/clear' && method === 'POST') {
            teams.players = {};
            teams.log = [];
            teamsLog({ kind: 'cleared' });
            teamsSave();
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        // Test from the dashboard: { name, text }
        if (pathname === '/api/teams/test' && method === 'POST') {
            const result = teamsChat(mDomainValidation.cleanString(body.name) || 'TestViewer', [
                { t: 'text', v: mDomainValidation.cleanString(body.text) }
            ]);
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                result: result || 'ignored (not a contest command)'
            });
        }
        return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown teams route.' });
    } catch (error) {
        return mHttpResponse.sendJson(res, 400, {
            ok: false,
            error: error.message || 'Teams request failed.'
        });
    }
}

Object.assign(exports, { teamsChat, handleTeamsApi });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    teams: {
        enumerable: true,
        get: () => teams,

        set: (value) => {
            teams = value;
        }
    }
});
