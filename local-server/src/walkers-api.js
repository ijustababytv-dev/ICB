'use strict';
/** createWalkersApi keeps related operations together and reads shared state at call time. */
module.exports = function createWalkersApi(context) {
    async function handleWalkersApi(req, res, pathname, method, url) {
        try {
            if (pathname === '/api/walkers/state' && method === 'GET') {
                const since = Number(url.searchParams.get('since')) || 0;
                return context.mHttpResponse.sendJson(res, 200, context.walkerOverlayState(since));
            }
            if (pathname === '/api/walkers/admin' && method === 'GET')
                return context.mHttpResponse.sendJson(res, 200, context.walkerAdminState());

            if (pathname === '/api/walkers/settings' && (method === 'PUT' || method === 'POST')) {
                const body = await context.mHttpBody.readBody(req);
                const s = context.walkers.settings;
                if (typeof body.enabled === 'boolean') s.enabled = body.enabled;
                if (typeof body.artFacesLeft === 'boolean') s.artFacesLeft = body.artFacesLeft;
                context.walkerCleanLook(s, body);
                for (const [k, [lo, hi]] of Object.entries(context.WALKERS_LIMITS)) {
                    if (body[k] === undefined) continue;
                    const n = Number(body[k]);
                    if (Number.isFinite(n)) s[k] = Math.min(hi, Math.max(lo, n));
                }
                if (Array.isArray(body.reminders))
                    s.reminders = body.reminders
                        .map((r) => context.mDomainValidation.cleanString(r).slice(0, 140))
                        .filter(Boolean)
                        .slice(0, 30);
                if (body.anims && typeof body.anims === 'object')
                    s.anims = context.walkerCleanAnims(body.anims, s.anims);
                if (context.WALKERS_ENTRANCES[body.entrance]) s.entrance = body.entrance;
                if (context.WALKERS_EXITS[body.exitStyle]) s.exitStyle = body.exitStyle;
                context.saveWalkers();
                return context.mHttpResponse.sendJson(res, 200, context.walkerAdminState());
            }

            // { name, allowed: true | false | null (automatic), art: filename | null }
            if (pathname === '/api/walkers/person' && (method === 'PUT' || method === 'POST')) {
                const body = await context.mHttpBody.readBody(req);
                const name = context.mDomainValidation
                    .cleanString(body.name)
                    .replace(/^@/, '')
                    .slice(0, 40);
                if (!name)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Missing name.'
                    });
                const key = name.toLowerCase();
                const p =
                    context.walkers.people[key] ||
                    (context.walkers.people[key] = {
                        name,
                        allowed: null,
                        art: null,
                        lastSeen: null
                    });
                if (body.allowed === true || body.allowed === false || body.allowed === null)
                    p.allowed = body.allowed;
                if (body.art === null || body.art === '') p.art = null;
                else if (typeof body.art === 'string') {
                    const ref = context.walkerCleanArtRef(body.art);
                    if (ref && ref.startsWith('personal:')) {
                        if (!p.personal || p.personal !== ref.slice(9))
                            return context.mHttpResponse.sendJson(res, 400, {
                                ok: false,
                                error: 'Upload their own picture first.'
                            });
                        p.art = ref;
                    } else if (ref && ref.startsWith('subs:')) {
                        if (!context.walkerSubArt().includes(ref.slice(5)))
                            return context.mHttpResponse.sendJson(res, 400, {
                                ok: false,
                                error: 'No such subscriber picture.'
                            });
                        if (!context.walkerIsSub(name))
                            return context.mHttpResponse.sendJson(res, 400, {
                                ok: false,
                                error: `${name} isn't a subscriber, so they can't have a subscriber-only picture.`
                            });
                        p.art = ref;
                    } else if (ref && context.walkerArt().includes(ref)) p.art = ref;
                }
                context.saveWalkers();
                return context.mHttpResponse.sendJson(res, 200, context.walkerAdminState());
            }

            // Test button: a pretend chatter says something (shows even if not ticked).
            // { id }: every unicorn on screen does that animation right now (preview).
            if (pathname === '/api/walkers/try' && method === 'POST') {
                const body = await context.mHttpBody.readBody(req);
                const id = String(body.id || '');
                if (
                    !context.WALKERS_ANIMS.some((a) => a.id === id) &&
                    !context.WALKERS_ENTRANCES[id.replace(/^enter:/, '')] &&
                    !context.WALKERS_EXITS[id.replace(/^exit:/, '')]
                )
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Unknown animation.'
                    });
                context.walkerTry = { id, at: Date.now() };
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }

            if (pathname === '/api/walkers/test' && method === 'POST') {
                const body = await context.mHttpBody.readBody(req);
                const name =
                    context.mDomainValidation.cleanString(body.name) ||
                    `TestUnicorn${1 + Math.floor(Math.random() * 9)}`;
                const text =
                    context.mDomainValidation.cleanString(body.text).slice(0, 300) ||
                    'Hi everyone! 🦄';
                context.walkerChat(name, [{ t: 'text', v: text }], true);
                return context.mHttpResponse.sendJson(res, 200, { ok: true, name });
            }

            // One person's own picture: { name, dataUrl } - saved just for them and picked for them.
            if (pathname === '/api/walkers/person-art' && method === 'POST') {
                const body = await context.mHttpBody.readBody(req);
                const name = context.mDomainValidation
                    .cleanString(body.name)
                    .replace(/^@/, '')
                    .slice(0, 40);
                if (!name)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Missing name.'
                    });
                const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
                    String(body.dataUrl || '')
                );
                if (!match)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Image must be a PNG, JPG, WEBP, or GIF.'
                    });
                const buffer = Buffer.from(match[2], 'base64');
                if (buffer.length > 8 * 1024 * 1024)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Image is too large (max 8MB).'
                    });
                const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
                const base = context.mTradeup.tradeupSlug(name);
                let filename = `${base}.${ext}`,
                    n = 2;
                while (
                    context.fs.existsSync(context.path.join(context.WALKERS_PERSONAL_DIR, filename))
                )
                    filename = `${base}-${n++}.${ext}`;
                context.fs.writeFileSync(
                    context.path.join(context.WALKERS_PERSONAL_DIR, filename),
                    buffer
                );
                const key = name.toLowerCase();
                const p =
                    context.walkers.people[key] ||
                    (context.walkers.people[key] = {
                        name,
                        allowed: null,
                        art: null,
                        lastSeen: null
                    });
                // Their old personal picture is kept in the folder, just no longer used.
                p.personal = filename;
                p.art = `personal:${filename}`;
                context.saveWalkers();
                return context.mHttpResponse.sendJson(res, 200, context.walkerAdminState());
            }

            // Add a picture: { dataUrl, name, pool: 'all' | 'subs' }
            if (pathname === '/api/walkers/art' && method === 'POST') {
                const body = await context.mHttpBody.readBody(req);
                const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
                    String(body.dataUrl || '')
                );
                if (!match)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Image must be a PNG, JPG, WEBP, or GIF.'
                    });
                const buffer = Buffer.from(match[2], 'base64');
                if (buffer.length > 8 * 1024 * 1024)
                    return context.mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Image is too large (max 8MB).'
                    });
                const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
                const base = context.mTradeup.tradeupSlug(
                    String(body.name || 'unicorn').replace(/\.[a-z0-9]+$/i, '')
                );
                const dir =
                    body.pool === 'subs' ? context.WALKERS_SUB_ART_DIR : context.WALKERS_ART_DIR;
                context.fs.mkdirSync(dir, { recursive: true });
                let filename = `${base}.${ext}`,
                    n = 2;
                while (context.fs.existsSync(context.path.join(dir, filename)))
                    filename = `${base}-${n++}.${ext}`;
                context.fs.writeFileSync(context.path.join(dir, filename), buffer);
                return context.mHttpResponse.sendJson(res, 200, context.walkerAdminState());
            }

            // Move a picture between everyone's pool and subscriber-only: { file, to: 'subs' | 'all' }
            if (pathname === '/api/walkers/art/move' && method === 'POST') {
                const body = await context.mHttpBody.readBody(req);
                const file = context.path.basename(String(body.file || ''));
                const toSubs = body.to === 'subs';
                const fromDir = toSubs ? context.WALKERS_ART_DIR : context.WALKERS_SUB_ART_DIR,
                    toDir = toSubs ? context.WALKERS_SUB_ART_DIR : context.WALKERS_ART_DIR;
                if (
                    !context.mDomainValidation.DECOR_IMAGE_EXT.test(file) ||
                    !context.fs.existsSync(context.path.join(fromDir, file))
                )
                    return context.mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'No such picture.'
                    });
                let target = file,
                    n = 2;
                const stem = file.replace(/\.[^.]+$/, ''),
                    ext = context.path.extname(file);
                while (context.fs.existsSync(context.path.join(toDir, target)))
                    target = `${stem}-${n++}${ext}`;
                context.fs.mkdirSync(toDir, { recursive: true });
                context.fs.renameSync(
                    context.path.join(fromDir, file),
                    context.path.join(toDir, target)
                );
                // Keep anyone who had this picture picked on it (non-subs lose a sub-only pick and go back to random).
                for (const p of Object.values(context.walkers.people)) {
                    if (toSubs && p.art === file)
                        p.art = context.walkerIsSub(p.name) ? `subs:${target}` : null;
                    if (!toSubs && p.art === `subs:${file}`) p.art = target;
                }
                context.saveWalkers();
                return context.mHttpResponse.sendJson(res, 200, context.walkerAdminState());
            }

            // Send every unicorn off screen right now.
            if (pathname === '/api/walkers/clear' && method === 'POST') {
                context.walkers.clearAt = Date.now();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            return context.mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown walkers route.'
            });
        } catch (error) {
            return context.mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Walkers request failed.'
            });
        }
    }

    return { handleWalkersApi: handleWalkersApi };
};
