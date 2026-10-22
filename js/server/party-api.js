'use strict';
/** createPartyApi keeps related operations together and reads shared state at call time. */
module.exports = function createPartyApi(context) {
    async function handlePartyApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/party' && method === 'GET') {
                const q = new context.URL(req.url, 'http://x').searchParams;
                const bq = String(q.get('board') || q.get('slot') || '');
                if (bq === 'spot' || bq === 'spotlight') {
                    const sl = context.partySpotSlot();
                    return context.mHttpResponse.sendJson(res, 200, {
                        ...(sl
                            ? context.partyPublic(sl)
                            : {
                                  ok: true,
                                  showTwitch: context.parties.showTwitch,
                                  empty: true,
                                  event: null,
                                  now: Date.now()
                              }),
                        visible: context.partyShown('spot'),
                        spot: context.partySpotInfo()
                    });
                }
                let slot = Number(bq) || 1;
                if (q.get('event')) {
                    const sl = context.partySlotOf(String(q.get('event')));
                    if (sl) slot = sl;
                }
                return context.mHttpResponse.sendJson(res, 200, context.partyPublic(slot));
            }
            if (pathname === '/api/party/admin' && method === 'GET') {
                const art = (() => {
                    try {
                        return context.fs
                            .readdirSync(context.PARTY_ART_DIR)
                            .filter((f) => context.mDomainValidation.DECOR_IMAGE_EXT.test(f))
                            .sort((x, y) => x.localeCompare(y));
                    } catch (_e) {
                        return [];
                    }
                })();
                return context.mHttpResponse.sendJson(res, 200, {
                    ...context.partyPublic(),
                    visible: context.parties.visible,
                    showSec: context.parties.showSec || 30,
                    showOnSignup: context.parties.showOnSignup !== false,
                    art,
                    liveId: context.parties.slots[0] || null,
                    slots: context.parties.slots,
                    spot: context.partySpotInfo(),
                    events: context.parties.events.map((e) => ({
                        id: e.id,
                        title: e.title,
                        when: e.when,
                        count: e.signups.length,
                        slot: context.partySlotOf(e.id)
                    })),
                    full: context.parties.events.map((e) => ({
                        ...context.partyView(e),
                        signups: e.signups.slice().sort((a, b) => a.at - b.at)
                    }))
                });
            }
            const b = ['POST', 'PUT', 'PATCH'].includes(method)
                ? await context.mHttpBody.readBody(req)
                : {};
            const findEv = (id) =>
                context.parties.events.find((e) => e.id === String(id || '')) || null;

            if (pathname === '/api/party/settings' && method === 'POST') {
                if (typeof b.visible === 'boolean') context.parties.visible = b.visible;
                if (typeof b.showTwitch === 'boolean') context.parties.showTwitch = b.showTwitch;
                if (b.liveId && findEv(b.liveId)) {
                    context.parties.liveId = String(b.liveId);
                    context.parties.slots[0] = String(b.liveId);
                }
                // Put an event on a board: { board: 1-7, eventId | null }. An event sits on one board at a time.
                if (b.board !== undefined) {
                    const n = Math.round(Number(b.board));
                    if (!(n >= 1 && n <= context.PARTY_SLOTS))
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'Board must be 1-7.'
                        });
                    const id = b.eventId && findEv(b.eventId) ? String(b.eventId) : null;
                    if (id)
                        context.parties.slots = context.parties.slots.map((x) =>
                            x === id ? null : x
                        );
                    context.parties.slots[n - 1] = id;
                    if (n === 1 && id) context.parties.liveId = id;
                }
                if (b.spotRotateSec !== undefined)
                    context.parties.spotRotateSec = Math.max(
                        5,
                        Math.min(300, Math.round(Number(b.spotRotateSec)) || 20)
                    );
                if (b.spotHoldSec !== undefined)
                    context.parties.spotHoldSec = Math.max(
                        10,
                        Math.min(600, Math.round(Number(b.spotHoldSec)) || 60)
                    );
                if (typeof b.spotChat === 'boolean') context.parties.spotChat = b.spotChat;
                if (b.spotShow !== undefined)
                    context.partySpotRequest(Number(b.spotShow), 'dashboard');
                if (typeof b.onDemand === 'boolean') context.parties.onDemand = b.onDemand;
                if (typeof b.showOnSignup === 'boolean')
                    context.parties.showOnSignup = b.showOnSignup;
                if (b.showSec !== undefined)
                    context.parties.showSec = Math.max(
                        5,
                        Math.min(600, Math.round(Number(b.showSec)) || 30)
                    );
                if (b.showNow) {
                    context.partyChatHidden = false;
                    context.partyReveal(b.showNow === 'all' ? 'all' : Number(b.showNow));
                }
                if (b.hideNow) {
                    for (const k of Object.keys(context.partyShowUntil))
                        delete context.partyShowUntil[k];
                    context.partySpot.until = 0;
                    context.partyChatHidden = true;
                }
                context.partySave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            // Create a new event: { copyFrom? } copies title/roles (not sign-ups).
            if (pathname === '/api/party/event/new' && method === 'POST') {
                const ev = context.partyNewEvent(context.parties.seq++);
                const src = findEv(b.copyFrom);
                if (src) {
                    ev.title = src.title;
                    ev.subtitle = src.subtitle;
                    ev.roles = JSON.parse(JSON.stringify(src.roles));
                    ev.rseq = src.rseq;
                    for (const k of [
                        'bgImage',
                        'titleImage',
                        'bgFit',
                        'panel',
                        'roleCards',
                        'border'
                    ])
                        if (src[k] !== undefined) ev[k] = src[k];
                }
                context.parties.events.push(ev);
                if (b.makeLive) {
                    const free = context.parties.slots.indexOf(null);
                    if (free >= 0) context.parties.slots[free] = ev.id;
                }
                context.partySave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true, id: ev.id });
            }
            if (pathname === '/api/party/event' && method === 'POST') {
                const ev = findEv(b.id);
                if (!ev)
                    return context.mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'Event not found.'
                    });
                if (b.delete) {
                    if (context.parties.events.length <= 1)
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'Keep at least one event.'
                        });
                    context.parties.events = context.parties.events.filter((e) => e !== ev);
                    context.parties.slots = context.parties.slots.map((x) =>
                        x === ev.id ? null : x
                    );
                    if (context.parties.liveId === ev.id)
                        context.parties.liveId =
                            context.parties.slots.find(Boolean) || context.parties.events[0].id;
                    context.partySave();
                    return context.mHttpResponse.sendJson(res, 200, { ok: true });
                }
                if (typeof b.title === 'string')
                    ev.title = context.mDomainValidation.cleanString(b.title).slice(0, 80);
                if (typeof b.when === 'string')
                    ev.when = context.mDomainValidation.cleanString(b.when).slice(0, 80);
                if (typeof b.subtitle === 'string')
                    ev.subtitle = context.mDomainValidation.cleanString(b.subtitle).slice(0, 140);
                if (typeof b.open === 'boolean') ev.open = b.open;
                // Party countdown: startAt = exact moment (ms) the party starts, null = no countdown.
                // Names not signed in turn yellow `warnMin` minutes before, red once it starts.
                if (b.startAt !== undefined)
                    ev.startAt =
                        b.startAt === null
                            ? null
                            : Number(b.startAt) > 0
                            ? Math.round(Number(b.startAt))
                            : null;
                if (b.warnMin !== undefined)
                    ev.warnMin = Math.max(1, Math.min(120, Math.round(Number(b.warnMin)) || 10));
                if (b.resetCheckins) for (const x of ev.signups) x.checkedIn = null;
                // Art: background picture, title banner picture, fit, panel darkness % (0 = see-through), role card darkness %, border.
                if (b.bgImage !== undefined) ev.bgImage = context.partyArtFile(b.bgImage);
                if (b.titleImage !== undefined) ev.titleImage = context.partyArtFile(b.titleImage);
                if (b.bgFit === 'cover' || b.bgFit === 'contain') ev.bgFit = b.bgFit;
                if (b.panel !== undefined)
                    ev.panel = Math.max(0, Math.min(100, Math.round(Number(b.panel)) || 0));
                if (b.roleCards !== undefined)
                    ev.roleCards = Math.max(0, Math.min(100, Math.round(Number(b.roleCards)) || 0));
                if (typeof b.border === 'boolean') ev.border = b.border;
                if (b.artToAll) {
                    for (const o of context.parties.events)
                        for (const k of [
                            'bgImage',
                            'titleImage',
                            'bgFit',
                            'panel',
                            'roleCards',
                            'border'
                        ])
                            o[k] = ev[k];
                }
                if (Array.isArray(b.roles)) {
                    const roles = b.roles
                        .slice(0, 20)
                        .map((r) => context.partyCleanRole(r, ev))
                        .filter((r) => r.command && !context.PARTY_RESERVED.has(r.command));
                    const seen = new Set();
                    const dup = roles.find((r) => {
                        if (seen.has(r.command)) return true;
                        seen.add(r.command);
                        return false;
                    });
                    if (dup)
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: `Two roles use !${dup.command}.`
                        });
                    for (const r of roles) if (!r.label) r.label = r.command;
                    ev.roles = roles;
                    const ids = new Set(roles.map((r) => r.id));
                    ev.signups = ev.signups.filter((s) => ids.has(s.role));
                }
                if (b.clearSignups) ev.signups = [];
                context.partySave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            // Her edits to one person: { id (event), key, role?, palia?, remove? } or add { id, twitch, palia, role }.
            if (pathname === '/api/party/signup' && method === 'POST') {
                const ev = findEv(b.id);
                if (!ev)
                    return context.mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'Event not found.'
                    });
                const key = context.mDomainValidation
                    .cleanString(b.key || b.twitch)
                    .replace(/^@/, '')
                    .toLowerCase()
                    .slice(0, 40);
                if (!key)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Name needed.'
                    });
                let s = ev.signups.find((x) => x.key === key);
                if (b.remove) {
                    ev.signups = ev.signups.filter((x) => x.key !== key);
                    context.partySave();
                    return context.mHttpResponse.sendJson(res, 200, { ok: true });
                }
                const role = b.role ? ev.roles.find((r) => r.id === b.role) : null;
                if (!s) {
                    if (!role)
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'Pick a role.'
                        });
                    const twitch = context.mDomainValidation
                        .cleanString(b.twitch)
                        .replace(/^@/, '')
                        .slice(0, 40);
                    s = {
                        key,
                        twitch,
                        palia:
                            context.mDomainValidation.cleanString(b.palia).slice(0, 32) || twitch,
                        role: role.id,
                        at: Date.now()
                    };
                    ev.signups.push(s);
                } else {
                    if (role && role.id !== s.role) {
                        s.role = role.id;
                        s.at = Date.now();
                    }
                    if (
                        typeof b.palia === 'string' &&
                        context.mDomainValidation.cleanString(b.palia)
                    )
                        s.palia = context.mDomainValidation.cleanString(b.palia).slice(0, 32);
                    if (b.top) s.at = Math.min(...ev.signups.map((x) => x.at)) - 1; // move to the front of the role (off the waitlist)
                    if (typeof b.checkedIn === 'boolean')
                        s.checkedIn = b.checkedIn ? Date.now() : null;
                }
                context.partySave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            // Fold / unfold role panels on stream (2026-10-07): { id: eventId, roleId, collapsed? } toggles one;
            // { id, all: true|false } folds or opens every role. Clicking a role header on the Meld board calls this too.
            if (pathname === '/api/party/collapse' && method === 'POST') {
                const ev = findEv(b.id);
                if (!ev)
                    return context.mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'Event not found.'
                    });
                ev.collapsed = ev.collapsed && typeof ev.collapsed === 'object' ? ev.collapsed : {};
                if (typeof b.all === 'boolean') {
                    ev.collapsed = {};
                    if (b.all) for (const r of ev.roles) ev.collapsed[r.id] = true;
                } else {
                    const r = ev.roles.find((x) => x.id === String(b.roleId || ''));
                    if (!r)
                        return context.mHttpResponse.sendJson(res, 404, {
                            ok: false,
                            error: 'Role not found.'
                        });
                    const want =
                        typeof b.collapsed === 'boolean' ? b.collapsed : !ev.collapsed[r.id];
                    if (want) ev.collapsed[r.id] = true;
                    else delete ev.collapsed[r.id];
                }
                context.partySave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            // Upload a picture for party boards: { dataUrl, name } -> assets/party/<name>.png
            if (pathname === '/api/party/image' && method === 'POST') {
                const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
                    String(b.dataUrl || '')
                );
                if (!match)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Picture must be a PNG, JPG, WEBP, or GIF.'
                    });
                const buffer = Buffer.from(match[2], 'base64');
                if (buffer.length > 9 * 1024 * 1024)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Picture is too large (max 8MB) - the dashboard shrinks big pictures automatically.'
                    });
                const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
                const base =
                    context.mTradeup.tradeupSlug(
                        String(b.name || 'party-art').replace(/\.[a-z0-9]+$/i, '')
                    ) || 'party-art';
                let filename = `${base}.${ext}`,
                    n = 2;
                while (context.fs.existsSync(context.path.join(context.PARTY_ART_DIR, filename)))
                    filename = `${base}-${n++}.${ext}`;
                context.fs.writeFileSync(
                    context.path.join(context.PARTY_ART_DIR, filename),
                    buffer
                );
                return context.mHttpResponse.sendJson(res, 200, { ok: true, file: filename });
            }
            if (pathname === '/api/party/test' && method === 'POST') {
                const r = context.partyChat(
                    context.mDomainValidation.cleanString(b.name) || 'TestViewer',
                    [{ t: 'text', v: context.mDomainValidation.cleanString(b.text) }]
                );
                return context.mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    result: r || 'ignored (not a sign-up command on any live board)'
                });
            }
            return context.mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown party route.'
            });
        } catch (error) {
            return context.mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Party request failed.'
            });
        }
    }

    return { handlePartyApi: handlePartyApi };
};
