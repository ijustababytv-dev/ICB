'use strict';
/** createHuntApi keeps related operations together and reads shared state at call time. */
module.exports = function createHuntApi(context) {
    async function handleHuntApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/hunt' && method === 'GET') {
                context.huntTick();
                return context.mHttpResponse.sendJson(res, 200, context.huntPublic());
            }
            if (pathname === '/api/hunt/admin' && method === 'GET') {
                const art = (() => {
                    try {
                        return context.fs
                            .readdirSync(context.mResources.RESOURCE_ART_DIR)
                            .filter((f) => context.mDomainValidation.DECOR_IMAGE_EXT.test(f))
                            .sort((a, b) => a.localeCompare(b));
                    } catch (_e) {
                        return [];
                    }
                })();
                const players = Object.entries(context.hunt.players)
                    .map(([key, p]) => ({
                        key,
                        name: p.name,
                        team: p.team,
                        finds: p.finds,
                        points: context.huntPts(p)
                    }))
                    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
                return context.mHttpResponse.sendJson(res, 200, {
                    ...context.huntPublic(),
                    settings: {
                        ignore: context.hunt.ignore,
                        lockTeams: context.hunt.lockTeams,
                        stopAtEnd: context.hunt.stopAtEnd
                    },
                    players,
                    log: context.hunt.log.slice(-60).reverse(),
                    art
                });
            }
            if (pathname === '/api/hunt' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req),
                    now = Date.now();
                let out = 'ok';
                const s = b.set || {};
                for (const k of ['title', 'subtitle', 'ignore'])
                    if (typeof s[k] === 'string')
                        context.hunt[k] = context.mDomainValidation
                            .cleanString(s[k])
                            .slice(0, k === 'ignore' ? 600 : 120);
                for (const k of ['visible', 'joinOpen', 'scoring', 'lockTeams', 'stopAtEnd'])
                    if (typeof s[k] === 'boolean') context.hunt[k] = s[k];
                if (s.look && typeof s.look === 'object') {
                    const L = context.hunt.look,
                        l = s.look;
                    for (const k of ['showLegend', 'showTicker', 'showTimer', 'showBar'])
                        if (typeof l[k] === 'boolean') L[k] = l[k];
                    const nums = {
                        scale: [20, 400],
                        x: [0, 100],
                        y: [0, 100],
                        width: [20, 100],
                        showPlayers: [0, 30]
                    };
                    for (const [k, [lo, hi]] of Object.entries(nums))
                        if (l[k] !== undefined && Number.isFinite(Number(l[k])))
                            L[k] = Math.max(lo, Math.min(hi, Number(l[k])));
                    if (['spooky', 'pink', 'palia', 'clean'].includes(l.theme)) L.theme = l.theme;
                }
                if (Array.isArray(b.teams) && b.teams.length) {
                    const list = b.teams.slice(0, 26).map(context.huntCleanTeam),
                        seen = {};
                    for (const t of list) {
                        let k = t.key,
                            n = 2;
                        while (seen[k]) k = t.key + n++;
                        t.key = k;
                        seen[k] = 1;
                    }
                    context.hunt.teams = list;
                }
                if (Array.isArray(b.items)) {
                    const seen = {};
                    context.hunt.items = b.items
                        .slice(0, 20)
                        .map(context.huntCleanItem)
                        .filter((it) => !seen[it.command] && (seen[it.command] = 1));
                }
                // timer
                const T = context.hunt.timer;
                if (b.timer) {
                    const a = b.timer.action;
                    if (b.timer.minutes !== undefined)
                        T.minutes = Math.max(1, Math.min(1440, Number(b.timer.minutes) || 60));
                    if (a === 'start') {
                        T.endsAt = now + T.minutes * 60000;
                        T.status = 'running';
                        context.hunt.scoring = true;
                        context.huntLog({ kind: 'start' });
                    } else if (a === 'pause' && T.status === 'running') {
                        T.leftMs = Math.max(0, T.endsAt - now);
                        T.status = 'paused';
                    } else if (a === 'resume' && T.status === 'paused') {
                        T.endsAt = now + T.leftMs;
                        T.status = 'running';
                    } else if (a === 'add') {
                        const d = Number(b.timer.ms) || 0;
                        if (T.status === 'running') T.endsAt = Math.max(now + 1000, T.endsAt + d);
                        else if (T.status === 'paused') T.leftMs = Math.max(1000, T.leftMs + d);
                    } else if (a === 'end') {
                        T.status = 'ended';
                        T.endsAt = now;
                        if (context.hunt.stopAtEnd) context.hunt.scoring = false;
                        context.huntLog({ kind: 'end' });
                    } else if (a === 'reset') {
                        T.status = 'idle';
                        T.endsAt = 0;
                        T.leftMs = 0;
                    }
                }
                // players
                if (b.player && b.player.key) {
                    const p = context.hunt.players[String(b.player.key)];
                    if (p) {
                        if (b.player.remove) delete context.hunt.players[String(b.player.key)];
                        if (
                            b.player.team &&
                            context.hunt.teams.some((t) => t.key === b.player.team)
                        ) {
                            p.team = b.player.team;
                            context.huntLog({ kind: 'move', name: p.name, team: p.team });
                        }
                        if (b.player.item)
                            out = context.huntAdd(
                                String(b.player.key),
                                String(b.player.item),
                                Math.round(Number(b.player.n)) || 0,
                                'dashboard'
                            );
                    }
                }
                if (b.add && b.add.name) {
                    const nm = context.mDomainValidation
                            .cleanString(b.add.name)
                            .replace(/^@/, '')
                            .slice(0, 40),
                        t = context.huntFindTeam(b.add.team) || context.hunt.teams[0];
                    if (nm && t) {
                        const k = nm.toLowerCase();
                        context.hunt.players[k] = {
                            name: nm,
                            team: t.key,
                            finds: (context.hunt.players[k] && context.hunt.players[k].finds) || {},
                            joined: Date.now()
                        };
                        context.huntLog({ kind: 'join', name: nm, team: t.key, how: 'dashboard' });
                    }
                }
                if (b.undo) {
                    const e = context.hunt.log.find(
                        (x) => x.id === Number(b.undo) && x.kind === 'find' && !x.undone
                    );
                    if (e && context.hunt.players[e.key]) {
                        const p = context.hunt.players[e.key];
                        p.finds[e.item] = Math.max(0, (Number(p.finds[e.item]) || 0) - e.n);
                        e.undone = true;
                    }
                }
                if (b.reset === 'points') {
                    for (const p of Object.values(context.hunt.players)) p.finds = {};
                    context.hunt.log = [];
                    context.hunt.epoch++;
                }
                if (b.reset === 'all') {
                    context.hunt.players = {};
                    context.hunt.log = [];
                    context.hunt.epoch++;
                    T.status = 'idle';
                    T.endsAt = 0;
                    T.leftMs = 0;
                }
                if (b.test)
                    out =
                        context.huntChat(
                            context.mDomainValidation.cleanString(b.test.name) || 'TestViewer',
                            [{ t: 'text', v: String(b.test.text || '') }]
                        ) || 'ignored (not a hunt command)';
                context.huntSave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true, result: out });
            }
            return context.mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown hunt route.'
            });
        } catch (error) {
            return context.mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Hunt request failed.'
            });
        }
    }

    return { handleHuntApi: handleHuntApi };
};
