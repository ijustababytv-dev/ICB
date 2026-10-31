'use strict';
/** createFlowApi keeps related operations together and reads shared state at call time. */
module.exports = function createFlowApi(context) {
    async function handleFtsuApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/flowtree-signup' && method === 'GET')
                return context.mHttpResponse.sendJson(res, 200, context.ftsuPublic());
            if (pathname === '/api/flowtree-signup/admin' && method === 'GET') {
                const ev = context.ftsuEv(),
                    pc = new Set([
                        ...context.ftsuPartyCmds(),
                        ...context.mSignupsCommands.signupRoleCmds('ftsu')
                    ]);
                return context.mHttpResponse.sendJson(res, 200, {
                    ...context.ftsuPublic(),
                    visible: context.ftsu.visible,
                    live: context.ftsu.live,
                    ignore: context.ftsu.ignore,
                    builtinIgnore: context.mSignupsPoke.SASHI_BUILTIN_IGNORE,
                    allZones: context.ftsu.zones,
                    clashes: ev ? ev.roles.filter((r) => pc.has(r.cmd)).map((r) => r.cmd) : [],
                    remembered: ev
                        ? Object.entries(
                              context.mSignupsPoke.sashi.names[
                                  context.mSignupsPoke.sashiGameKey(ev.game)
                              ] || {}
                          ).map(([twitch, name]) => ({ twitch, name }))
                        : [],
                    games: Array.from(
                        new Set(context.ftsu.events.map((e) => e.game).concat(['Palia', 'Aniimo']))
                    ),
                    events: context.ftsu.events.map((e) => ({
                        id: e.id,
                        name: e.name,
                        count: e.guests.length
                    }))
                });
            }
            if (pathname === '/api/flowtree-signup' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                for (const k of [
                    'visible',
                    'open',
                    'showZones',
                    'showCountdown',
                    'onDemand',
                    'showOnSignup'
                ])
                    if (typeof b[k] === 'boolean') context.ftsu[k] = b[k];
                if (b.showSec !== undefined)
                    context.ftsu.showSec = Math.max(
                        5,
                        Math.min(600, Math.round(Number(b.showSec)) || 30)
                    );
                if (b.showNow) {
                    context.ftsuChatHidden = false;
                    context.ftsuShowUntil = Date.now() + (context.ftsu.showSec || 30) * 1000;
                }
                if (b.hideNow) {
                    context.ftsuShowUntil = 0;
                    context.ftsuChatHidden = true;
                }
                if (typeof b.title === 'string')
                    context.ftsu.title = context.mDomainValidation
                        .cleanString(b.title)
                        .slice(0, 60);
                if (typeof b.ignore === 'string')
                    context.ftsu.ignore = context.mDomainValidation
                        .cleanString(b.ignore)
                        .slice(0, 500);
                if (b.font !== undefined)
                    context.ftsu.font = Math.max(
                        12,
                        Math.min(70, Math.round(Number(b.font)) || 26)
                    );
                if (b.cols !== undefined)
                    context.ftsu.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
                if (b.max !== undefined)
                    context.ftsu.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
                if (b.panelOpacity !== undefined)
                    context.ftsu.panelOpacity = Math.max(
                        0,
                        Math.min(100, Math.round(Number(b.panelOpacity)) || 0)
                    );
                for (const k of ['accent', 'panelColor'])
                    if (b[k] !== undefined && context.mNews.newsHex(b[k])) context.ftsu[k] = b[k];
                // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
                if (Array.isArray(b.zones)) {
                    context.ftsu.zones = b.zones
                        .slice(0, 24)
                        .filter((z) => z && context.mDomainTimezone.etValidTz(z.tz))
                        .map((z) => ({
                            tz: String(z.tz),
                            label:
                                context.mDomainValidation.cleanString(z.label).slice(0, 24) ||
                                String(z.tz).split('/').pop().replace(/_/g, ' '),
                            on: !!z.on
                        }));
                }
                if (b.newEvent) {
                    const id = `e${context.ftsu.seq++}`;
                    context.ftsu.events.push(
                        context.ftsuFixEvent({
                            id,
                            name:
                                context.mDomainValidation.cleanString(b.newEvent).slice(0, 60) ||
                                'Event',
                            guests: []
                        })
                    );
                    context.ftsu.live = id;
                }
                if (b.copyEvent) {
                    // duplicate an event's details + roles (empty list) - handy for weekly repeats
                    const src = context.ftsuEv(String(b.copyEvent));
                    if (src) {
                        const id = `e${context.ftsu.seq++}`;
                        context.ftsu.events.push(
                            context.ftsuFixEvent({
                                id,
                                name: (src.name + ' (copy)').slice(0, 60),
                                desc: src.desc,
                                date: src.date,
                                time: src.time,
                                tz: src.tz,
                                roles: JSON.parse(JSON.stringify(src.roles)),
                                guests: []
                            })
                        );
                        context.ftsu.live = id;
                    }
                }
                if (b.live && context.ftsuEv(String(b.live))) context.ftsu.live = String(b.live);
                const ev = context.ftsuEv(b.event ? String(b.event) : null);
                if (ev) {
                    if (typeof b.name === 'string' && context.mDomainValidation.cleanString(b.name))
                        ev.name = context.mDomainValidation.cleanString(b.name).slice(0, 60);
                    if (typeof b.game === 'string' && context.mDomainValidation.cleanString(b.game))
                        ev.game = context.mDomainValidation.cleanString(b.game).slice(0, 30);
                    if (typeof b.desc === 'string')
                        ev.desc = String(b.desc).replace(/[<>]/g, '').slice(0, 400);
                    if (typeof b.date === 'string')
                        ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
                    if (typeof b.time === 'string')
                        ev.time = /^\d{1,2}:\d{2}$/.test(b.time) ? b.time : '';
                    if (typeof b.tz === 'string' && context.mDomainTimezone.etValidTz(b.tz))
                        ev.tz = b.tz;
                    // Roles (her own): full list [{id?, label, cmd, spots, color}] replaces the event's roles.
                    if (Array.isArray(b.roles)) {
                        const used = new Set(),
                            out = [];
                        for (const r of b.roles.slice(0, 12)) {
                            const cmd = context.ftsuCleanCmd(r && r.cmd),
                                label = context.mDomainValidation
                                    .cleanString(r && r.label)
                                    .slice(0, 40);
                            if (
                                !cmd ||
                                !label ||
                                used.has(cmd) ||
                                context.mSignupsPoke.SASHI_RESERVED.has(cmd)
                            )
                                continue;
                            used.add(cmd);
                            const old = r.id && ev.roles.find((x) => x.id === String(r.id));
                            out.push({
                                id: old ? old.id : `r${context.ftsu.rseq++}`,
                                label,
                                cmd,
                                spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)),
                                color: context.mNews.newsHex(r.color) || ''
                            });
                        }
                        ev.roles = out;
                        context.ftsuFixEvent(ev);
                    }
                    if (Array.isArray(b.add)) context.ftsuAddNames(ev, b.add, b.addRole);
                    if (b.remove !== undefined) {
                        ev.guests = ev.guests.filter((g) => g.n !== Number(b.remove));
                        context.ftsuRenumber(ev);
                    }
                    if (b.move && b.move.n) {
                        const i = ev.guests.findIndex((g) => g.n === Number(b.move.n)),
                            j = i + (Number(b.move.dir) < 0 ? -1 : 1);
                        if (i >= 0 && j >= 0 && j < ev.guests.length) {
                            const t = ev.guests[i];
                            ev.guests[i] = ev.guests[j];
                            ev.guests[j] = t;
                            context.ftsuRenumber(ev);
                        }
                    }
                    if (b.rename && b.rename.n) {
                        const g = ev.guests.find((x) => x.n === Number(b.rename.n));
                        const nn = context.ftsuCleanName(b.rename.name);
                        if (g && nn) {
                            g.name = nn;
                            context.ftsuRemember(ev, g.twitch, nn);
                        }
                    }
                    if (b.setRole && b.setRole.n) {
                        const g = ev.guests.find((x) => x.n === Number(b.setRole.n));
                        if (g)
                            g.role = ev.roles.some((r) => r.id === b.setRole.role)
                                ? b.setRole.role
                                : '';
                    }
                    if (b.clear) ev.guests = [];
                }
                if (b.forget && b.forget.game && b.forget.twitch) {
                    const m =
                        context.mSignupsPoke.sashi.names[
                            context.mSignupsPoke.sashiGameKey(b.forget.game)
                        ];
                    if (m) {
                        delete m[String(b.forget.twitch).toLowerCase()];
                        context.mStorage.writeJson(
                            context.mSignupsPoke.SASHI_FILE,
                            context.mSignupsPoke.sashi
                        );
                    }
                }
                if (b.deleteEvent && context.ftsu.events.length > 1) {
                    context.ftsu.events = context.ftsu.events.filter(
                        (e) => e.id !== String(b.deleteEvent)
                    );
                    if (!context.ftsuEv()) context.ftsu.live = context.ftsu.events[0].id;
                }
                context.ftsuSave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (pathname === '/api/flowtree-signup/test' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                return context.mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    reply:
                        context.ftsuChat(
                            context.mDomainValidation.cleanString(b.name) || 'TestViewer',
                            [{ t: 'text', v: context.mDomainValidation.cleanString(b.text) }]
                        ) || 'ignored'
                });
            }
            return context.mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown flowtree-signup route.'
            });
        } catch (error) {
            return context.mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Event sign-up request failed.'
            });
        }
    }

    return { handleFtsuApi: handleFtsuApi };
};
