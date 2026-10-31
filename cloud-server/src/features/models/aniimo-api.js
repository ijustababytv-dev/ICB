'use strict';
/** createAniimoApi keeps related operations together and reads shared state at call time. */
module.exports = function createAniimoApi(context) {
    async function handleDexApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/aniimo' && method === 'GET')
                return context.mHttpResponse.sendJson(res, 200, context.dexPublic());
            if (pathname === '/api/aniimo/admin' && method === 'GET')
                return context.mHttpResponse.sendJson(res, 200, {
                    ...context.dexPublic(),
                    roster: context.dex.roster.map((a) => ({
                        ...a,
                        img: context.dexImg(a),
                        formImgs: context.dexFormImgs(a)
                    })),
                    checked: context.dex.checked,
                    popupSec: context.dex.popupSec,
                    lookupSec: context.dex.lookupSec,
                    elements: context.DEX_ELEMENTS
                });
            if (pathname === '/api/aniimo' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                for (const k of ['visible', 'chat', 'showElements'])
                    if (typeof b[k] === 'boolean') context.dex[k] = b[k];
                if (typeof b.title === 'string')
                    context.dex.title = context.mDomainValidation.cleanString(b.title).slice(0, 60);
                if (b.popupSec !== undefined)
                    context.dex.popupSec = Math.max(
                        2,
                        Math.min(60, Math.round(Number(b.popupSec)) || 8)
                    );
                if (b.lookupSec !== undefined)
                    context.dex.lookupSec = Math.max(
                        4,
                        Math.min(60, Math.round(Number(b.lookupSec)) || 14)
                    );
                if (b.panelOpacity !== undefined)
                    context.dex.panelOpacity = Math.max(
                        0,
                        Math.min(100, Math.round(Number(b.panelOpacity)) || 0)
                    );
                for (const k of ['accent', 'panelColor'])
                    if (b[k] !== undefined && context.mNews.newsHex(b[k])) context.dex[k] = b[k];
                if (b.check && b.check.id)
                    context.dexSet(
                        b.check.id,
                        context.dexCleanVariant(b.check.variant),
                        b.check.on !== false
                    );
                if (b.checkAll && b.checkAll.id) {
                    const a = context.dexFind(b.checkAll.id);
                    if (a)
                        for (const v of a.variants)
                            context.dexSet(a.id, v, b.checkAll.on !== false);
                }
                if (b.lookup) {
                    const a = context.dexSearch(b.lookup);
                    if (a) {
                        const now = Date.now();
                        context.dexLookup = {
                            kind: 'need',
                            by: '',
                            id: a.id,
                            name: a.name,
                            number: a.number,
                            element: a.element,
                            img: context.dexImg(a),
                            formImgs: context.dexFormImgs(a),
                            have: a.variants.filter(
                                (v) => context.dex.checked[context.dexKey(a.id, v)]
                            ),
                            need: a.variants.filter(
                                (v) => !context.dex.checked[context.dexKey(a.id, v)]
                            ),
                            until: now + context.dex.lookupSec * 1000,
                            at: now
                        };
                    }
                }
                if (b.lookupDex) {
                    const now = Date.now();
                    context.dexLookup = {
                        kind: 'dex',
                        by: '',
                        until: now + context.dex.lookupSec * 1000,
                        at: now
                    };
                }
                if (b.hideNow) {
                    context.dexPopup = null;
                    context.dexLookup = null;
                }
                // Roster editing (hers): save one Aniimo (new or existing), or remove one.
                if (b.saveAniimo) {
                    const old = b.saveAniimo.id ? context.dexFind(b.saveAniimo.id) : null;
                    const a = context.dexCleanAniimo(
                        b.saveAniimo,
                        old ? old.id : `x${context.dex.seq++}`
                    );
                    if (!a.name)
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'An Aniimo needs a name.'
                        });
                    if (!a.variants.length) a.variants = ['Basic Form'];
                    if (old) {
                        a.image = old.image || ''; // the picture is set with /api/aniimo/image, not the edit form
                        a.formImages = Object.fromEntries(
                            Object.entries(old.formImages || {}).filter(([v]) =>
                                a.variants.includes(v)
                            )
                        );
                        for (const v of old.variants)
                            if (!a.variants.includes(v))
                                delete context.dex.checked[context.dexKey(old.id, v)]; // removed forms lose their check
                        Object.assign(old, a);
                    } else context.dex.roster.push(a);
                    context.dex.roster.sort(
                        (x, y) =>
                            (parseInt(x.number, 10) || 1e9) - (parseInt(y.number, 10) || 1e9) ||
                            x.name.localeCompare(y.name)
                    );
                }
                if (b.removeAniimo) {
                    const a = context.dexFind(b.removeAniimo);
                    if (a) {
                        for (const v of a.variants)
                            delete context.dex.checked[context.dexKey(a.id, v)];
                        context.dex.roster = context.dex.roster.filter((x) => x !== a);
                        context.dex.recent = context.dex.recent.filter((r) => r.id !== a.id);
                    }
                }
                // Add / rename a form on EVERY Aniimo at once (e.g. a new mutation type arrives in a patch).
                if (b.addFormAll) {
                    const v = context.dexCleanVariant(b.addFormAll);
                    if (v)
                        for (const a of context.dex.roster)
                            if (!a.variants.includes(v)) a.variants.push(v);
                }
                if (b.renameForm && b.renameForm.from && b.renameForm.to) {
                    const f = context.dexCleanVariant(b.renameForm.from),
                        t = context.dexCleanVariant(b.renameForm.to);
                    if (f && t && f !== t)
                        for (const a of context.dex.roster) {
                            const i = a.variants.indexOf(f);
                            if (i >= 0 && !a.variants.includes(t)) {
                                a.variants[i] = t;
                                if (a.formImages && a.formImages[f]) {
                                    a.formImages[t] = a.formImages[f];
                                    delete a.formImages[f];
                                }
                                const k = context.dexKey(a.id, f);
                                if (context.dex.checked[k]) {
                                    context.dex.checked[context.dexKey(a.id, t)] =
                                        context.dex.checked[k];
                                    delete context.dex.checked[k];
                                }
                            }
                        }
                }
                // Import: our own backup ({checked:{"id|variant":ts}}) or the friend tracker's ({checked:{"number|name|variant":true}}).
                if (b.import && typeof b.import === 'object') {
                    const src =
                        b.import.checked && typeof b.import.checked === 'object'
                            ? b.import.checked
                            : b.import;
                    let n = 0;
                    if (Array.isArray(b.import.roster) && b.import.roster.length && b.replaceRoster)
                        context.dex.roster = b.import.roster
                            .map((a) => context.dexCleanAniimo(a))
                            .filter((a) => a.id && a.name);
                    for (const k of Object.keys(src)) {
                        if (!src[k]) continue;
                        const p = k.split('|'),
                            id = p[0],
                            v = context.dexCleanVariant(p[p.length - 1]);
                        const a =
                            context.dexFind(id) ||
                            context.dex.roster.find((x) => p.length > 2 && x.name === p[1]);
                        if (
                            a &&
                            a.variants.includes(v) &&
                            !context.dex.checked[context.dexKey(a.id, v)]
                        ) {
                            context.dex.checked[context.dexKey(a.id, v)] =
                                typeof src[k] === 'number' ? src[k] : Date.now();
                            n++;
                        }
                    }
                    context.dexSave();
                    return context.mHttpResponse.sendJson(res, 200, { ok: true, imported: n });
                }
                if (b.resetChecks === 'yes') {
                    context.dex.checked = {};
                    context.dex.recent = [];
                }
                context.dexSave();
                return context.mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (pathname === '/api/aniimo/export' && method === 'GET') {
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="aniimo-dex-backup.json"'
                });
                return res.end(
                    JSON.stringify(
                        {
                            app: 'ICB Aniimo Dex',
                            exportedAt: new Date().toISOString(),
                            roster: context.dex.roster,
                            checked: context.dex.checked
                        },
                        null,
                        2
                    )
                );
            }
            // Picture for one Aniimo: { id, dataUrl } saves it (assets/aniimo/<number>.<ext>); { id, remove: true } clears it.
            if (pathname === '/api/aniimo/image' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                const a = context.dexFind(b.id);
                if (!a)
                    return context.mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'No Aniimo with that id.'
                    });
                // A photo for ONE form: { id, variant, dataUrl } / { id, variant, remove: true }. Optional tick: true also ticks it.
                if (b.variant) {
                    const v = context.dexCleanVariant(b.variant);
                    if (!a.variants.includes(v))
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'That Aniimo has no such form.'
                        });
                    a.formImages = a.formImages || {};
                    if (a.formImages[v]) {
                        try {
                            context.fs.unlinkSync(
                                context.path.join(context.DEX_ART_DIR, a.formImages[v])
                            );
                        } catch (_e) {}
                    }
                    if (b.remove) {
                        delete a.formImages[v];
                        context.dexSave();
                        return context.mHttpResponse.sendJson(res, 200, { ok: true });
                    }
                    const fm = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(
                        String(b.dataUrl || '')
                    );
                    if (!fm)
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'Picture must be a PNG, JPG, WEBP, or GIF.'
                        });
                    const fb = Buffer.from(fm[2], 'base64');
                    if (fb.length > 9 * 1024 * 1024)
                        return context.mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'Picture is too large.'
                        });
                    const fname = `${(
                        context.dexSlug(a.number) ||
                        context.dexSlug(a.name) ||
                        a.id
                    ).slice(0, 30)}__${context.dexSlug(v).slice(0, 40) || 'form'}.${
                        fm[1] === 'jpeg' ? 'jpg' : fm[1]
                    }`;
                    context.fs.writeFileSync(context.path.join(context.DEX_ART_DIR, fname), fb);
                    a.formImages[v] = fname;
                    if (b.tick) context.dexSet(a.id, v, true);
                    context.dexSave();
                    return context.mHttpResponse.sendJson(res, 200, {
                        ok: true,
                        img: context.dexFormImg(a, v)
                    });
                }
                if (b.remove) {
                    const cur = context.dexImg(a); // her uploaded picture, or a file she dropped in that was matched by name/number
                    if (cur) {
                        try {
                            context.fs.unlinkSync(
                                context.path.join(
                                    context.DEX_ART_DIR,
                                    decodeURIComponent(cur.split('/').pop().split('?')[0])
                                )
                            );
                        } catch (_e) {}
                    }
                    a.image = '';
                    context.dexArtList = null;
                    context.dexSave();
                    return context.mHttpResponse.sendJson(res, 200, { ok: true });
                }
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
                        error: 'Picture is too large.'
                    });
                const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
                const base = (context.dexSlug(a.number) || context.dexSlug(a.name) || a.id).slice(
                    0,
                    30
                );
                if (a.image) {
                    try {
                        context.fs.unlinkSync(context.path.join(context.DEX_ART_DIR, a.image));
                    } catch (_e) {}
                }
                for (const e of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
                    try {
                        context.fs.unlinkSync(
                            context.path.join(context.DEX_ART_DIR, `${base}.${e}`)
                        );
                    } catch (_e) {}
                }
                a.image = `${base}.${ext}`;
                context.fs.writeFileSync(context.path.join(context.DEX_ART_DIR, a.image), buffer);
                context.dexArtList = null;
                context.dexSave();
                return context.mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    img: context.dexImg(a)
                });
            }
            if (pathname === '/api/aniimo/test' && method === 'POST') {
                const b = await context.mHttpBody.readBody(req);
                context.dexChatSeen.clear();
                context.dexChatLast = 0;
                return context.mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    reply:
                        context.dexChat(
                            context.mDomainValidation.cleanString(b.name) || 'TestViewer',
                            [{ t: 'text', v: context.mDomainValidation.cleanString(b.text) }]
                        ) || 'ignored'
                });
            }
            return context.mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown aniimo route.'
            });
        } catch (error) {
            return context.mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Aniimo Dex request failed.'
            });
        }
    }

    return { handleDexApi: handleDexApi };
};
