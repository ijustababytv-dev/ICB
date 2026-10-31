'use strict';
const { setCheckin, resetCheckins } = require('../domain/signup-checkins');
/** createPokeApi keeps related operations together and reads shared state at call time. */
module.exports = function createPokeApi(context) {
    async function handleSashiApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/sashimi' && method === 'GET')
                return context.mHttpResponse.sendJson(res, 200, context.sashiPublic());
            if (pathname === '/api/sashimi/admin' && method === 'GET') {
                const ev = context.sashiEv(),
                    pc = new Set([
                        ...context.sashiPartyCmds(),
                        ...context.mSignupsCommands.signupRoleCmds('sashi')
                    ]);
                return context.mHttpResponse.sendJson(res, 200, {
                    ...context.sashiPublic(),
                    visible: context.sashi.visible,
                    live: context.sashi.live,
                    ignore: context.sashi.ignore,
                    builtinIgnore: context.SASHI_BUILTIN_IGNORE,
                    allZones: context.sashi.zones,
                    clashes: ev ? ev.roles.filter((r) => pc.has(r.cmd)).map((r) => r.cmd) : [],
                    remembered: ev
                        ? Object.entries(
                              context.sashi.names[context.sashiGameKey(ev.game)] || {}
                          ).map(([twitch, name]) => ({ twitch, name }))
                        : [],
                    games: Array.from(
                        new Set(context.sashi.events.map((e) => e.game).concat(['Palia', 'Aniimo']))
                    ),
                    events: context.sashi.events.map((e) => ({
                        id: e.id,
                        name: e.name,
                        count: e.guests.length
                    }))
                });
            }
            if (pathname === '/api/sashimi' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                for (const k of [
                    'visible',
                    'open',
                    'showZones',
                    'showCountdown',
                    'onDemand',
                    'showOnSignup'
                ])
                    if (typeof b[k] === 'boolean') context.sashi[k] = b[k];
                if (b.showSec !== undefined)
                    context.sashi.showSec = Math.max(
                        5,
                        Math.min(600, Math.round(Number(b.showSec)) || 30)
                    );
                if (b.showNow) {
                    context.sashiChatHidden = false;
                    context.sashiShowUntil = Date.now() + (context.sashi.showSec || 30) * 1000;
                }
                if (b.hideNow) {
                    context.sashiShowUntil = 0;
                    context.sashiChatHidden = true;
                }
                if (typeof b.title === 'string')
                    context.sashi.title = context.mDomainValidation
                        .cleanString(b.title)
                        .slice(0, 60);
                if (typeof b.ignore === 'string')
                    context.sashi.ignore = context.mDomainValidation
                        .cleanString(b.ignore)
                        .slice(0, 500);
                if (b.font !== undefined)
                    context.sashi.font = Math.max(
                        12,
                        Math.min(70, Math.round(Number(b.font)) || 26)
                    );
                if (b.cols !== undefined)
                    context.sashi.cols = Math.max(1, Math.min(4, Math.round(Number(b.cols)) || 2));
                if (b.max !== undefined)
                    context.sashi.max = Math.max(0, Math.min(200, Math.round(Number(b.max)) || 0));
                if (b.panelOpacity !== undefined)
                    context.sashi.panelOpacity = Math.max(
                        0,
                        Math.min(100, Math.round(Number(b.panelOpacity)) || 0)
                    );
                for (const k of ['accent', 'panelColor'])
                    if (b[k] !== undefined && context.mNews.newsHex(b[k])) context.sashi[k] = b[k];
                // World clocks: [{tz, on, label}] - tick/untick, rename, or add another IANA zone.
                if (Array.isArray(b.zones)) {
                    context.sashi.zones = b.zones
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
                    const id = `e${context.sashi.seq++}`;
                    context.sashi.events.push(
                        context.sashiFixEvent({
                            id,
                            name:
                                context.mDomainValidation.cleanString(b.newEvent).slice(0, 60) ||
                                'Event',
                            guests: []
                        })
                    );
                    context.sashi.live = id;
                }
                if (b.copyEvent) {
                    // duplicate an event's details + roles (empty list) - handy for weekly repeats
                    const src = context.sashiEv(String(b.copyEvent));
                    if (src) {
                        const id = `e${context.sashi.seq++}`;
                        context.sashi.events.push(
                            context.sashiFixEvent({
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
                        context.sashi.live = id;
                    }
                }
                if (b.live && context.sashiEv(String(b.live))) context.sashi.live = String(b.live);
                const ev = context.sashiEv(b.event ? String(b.event) : null);
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
                            const cmd = context.sashiCleanCmd(r && r.cmd),
                                label = context.mDomainValidation
                                    .cleanString(r && r.label)
                                    .slice(0, 40);
                            if (!cmd || !label || used.has(cmd) || context.SASHI_RESERVED.has(cmd))
                                continue;
                            used.add(cmd);
                            const old = r.id && ev.roles.find((x) => x.id === String(r.id));
                            out.push({
                                id: old ? old.id : `r${context.sashi.rseq++}`,
                                label,
                                cmd,
                                spots: Math.max(0, Math.min(200, Math.round(Number(r.spots)) || 0)),
                                color: context.mNews.newsHex(r.color) || ''
                            });
                        }
                        ev.roles = out;
                        context.sashiFixEvent(ev);
                    }
                    if (Array.isArray(b.add)) context.sashiAddNames(ev, b.add, b.addRole);
                    if (b.remove !== undefined) {
                        ev.guests = ev.guests.filter((g) => g.n !== Number(b.remove));
                        context.sashiRenumber(ev);
                    }
                    if (b.move && b.move.n) {
                        const i = ev.guests.findIndex((g) => g.n === Number(b.move.n)),
                            j = i + (Number(b.move.dir) < 0 ? -1 : 1);
                        if (i >= 0 && j >= 0 && j < ev.guests.length) {
                            const t = ev.guests[i];
                            ev.guests[i] = ev.guests[j];
                            ev.guests[j] = t;
                            context.sashiRenumber(ev);
                        }
                    }
                    if (b.rename && b.rename.n) {
                        const g = ev.guests.find((x) => x.n === Number(b.rename.n));
                        const nn = context.sashiCleanName(b.rename.name);
                        if (g && nn) {
                            g.name = nn;
                            context.sashiRemember(ev, g.twitch, nn);
                        }
                    }
                    if (b.setRole && b.setRole.n) {
                        const g = ev.guests.find((x) => x.n === Number(b.setRole.n));
                        if (g)
                            g.role = ev.roles.some((r) => r.id === b.setRole.role)
                                ? b.setRole.role
                                : '';
                    }
                    if (b.checkin && b.checkin.n) setCheckin(ev, b.checkin.n, b.checkin.on);
                    if (b.resetCheckins) resetCheckins(ev);
                    if (b.clear) ev.guests = [];
                }
                if (b.forget && b.forget.game && b.forget.twitch) {
                    const m = context.sashi.names[context.sashiGameKey(b.forget.game)];
                    if (m) delete m[String(b.forget.twitch).toLowerCase()];
                }
                if (b.deleteEvent && context.sashi.events.length > 1) {
                    context.sashi.events = context.sashi.events.filter(
                        (e) => e.id !== String(b.deleteEvent)
                    );
                    if (!context.sashiEv()) context.sashi.live = context.sashi.events[0].id;
                }
                context.sashiSave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (pathname === '/api/sashimi/test' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                return context.mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    reply:
                        context.sashiChat(
                            context.mDomainValidation.cleanString(b.name) || 'TestViewer',
                            [{ t: 'text', v: context.mDomainValidation.cleanString(b.text) }]
                        ) || 'ignored'
                });
            }
            return context.mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown sashimi route.'
            });
        } catch (error) {
            return context.mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Event sign-up request failed.'
            });
        }
    }

    return { handleSashiApi: handleSashiApi };
};
