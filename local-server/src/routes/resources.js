'use strict';

const mOverlayDiagnostics = require('../overlay-diagnostics');
const mHttpResponse = require('../http/response');
const mResources = require('../resources');
const mHttpBody = require('../http/body');
const fs = require('node:fs');

/** Handle resources requests; reject unmatched paths. */
async function handleResourcesApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    // ---------------- resource trackers ----------------
    if (pathname === '/api/resource-trackers' && method === 'GET') {
        mOverlayDiagnostics.notePoll(url.searchParams.get('src'));
        return mHttpResponse.sendJson(res, 200, {
            ok: true,
            resourceTrackers: mResources.resourceTrackersView()
        });
    }

    if (pathname === '/api/resource-trackers/reset-session' && ['POST', 'PUT'].includes(method)) {
        mResources.resetResourceSession('manual');
        return mHttpResponse.sendJson(res, 200, {
            ok: true,
            resourceTrackers: mResources.resourceTrackersView()
        });
    }

    if (pathname === '/api/resource-trackers/undo-reset' && ['POST', 'PUT'].includes(method)) {
        if (!mResources.undoResourceReset())
            return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Nothing to undo.' });
        return mHttpResponse.sendJson(res, 200, {
            ok: true,
            resourceTrackers: mResources.resourceTrackersView()
        });
    }

    {
        const match = pathname.match(
            /^\/api\/resource-trackers\/([a-z0-9-]+)\/(adjust|set|visible|set-start)$/i
        );
        if (match && ['POST', 'PUT'].includes(method)) {
            const card = mResources.findResourceCard(match[1].toLowerCase());
            if (!card)
                return mHttpResponse.sendJson(res, 404, {
                    ok: false,
                    error: 'No resource tracker with that id.'
                });
            const body = await mHttpBody.readBody(req);
            if (match[2] === 'set-start') {
                // Countdown cards only (e.g. Sashimi): change the batch size on the
                // fly. Persists to config/resource-trackers.json so it also survives
                // a restart, AND restocks the live count right now - a new batch
                // starting means "I have this many now", not "wait for a restart".
                if (card.mode !== 'countdown') {
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: `${card.name} isn't a countdown card - there's no batch size to set.`
                    });
                }
                const startAt = Math.trunc(Number(body.startAt));
                if (!Number.isFinite(startAt) || startAt < 0) {
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Send a whole number of 0 or more.'
                    });
                }
                card.startAt = startAt;
                card.count = startAt;
                try {
                    const cfg = JSON.parse(fs.readFileSync(mResources.RESOURCE_CARDS_FILE, 'utf8'));
                    const def = (cfg.cards || []).find((c) => c.id === card.id);
                    if (def) {
                        def.startAt = startAt;
                        fs.writeFileSync(
                            mResources.RESOURCE_CARDS_FILE,
                            JSON.stringify(cfg, null, 2)
                        );
                    }
                } catch (_error) {
                    /* live change still applies even if the config write fails */
                }
            } else if (match[2] === 'adjust' || match[2] === 'set') {
                if (card.mode === 'lifetime' && mResources.LIFETIME_SOURCE[card.id]) {
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: `${card.name} mirrors the main ${
                            mResources.LIFETIME_SOURCE[card.id]
                        } total. Correct it in the reconciliation panel so there is only ever one number.`
                    });
                }
                const value = Number(match[2] === 'adjust' ? body.delta : body.value);
                if (!Number.isFinite(value))
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Send a whole number.'
                    });
                card.count = Math.max(
                    0,
                    match[2] === 'adjust' ? card.count + Math.trunc(value) : Math.trunc(value)
                );
            } else {
                card.visible = Boolean(body.visible);
            }
            mResources.broadcastResourceTrackers();
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                resourceTrackers: mResources.resourceTrackersView()
            });
        }
    }

    {
        const match = pathname.match(
            /^\/api\/resource-trackers\/([a-z0-9-]+)\/secondary\/(adjust|set)$/i
        );
        if (match && ['POST', 'PUT'].includes(method)) {
            const card = mResources.findResourceCard(match[1].toLowerCase());
            if (!card)
                return mHttpResponse.sendJson(res, 404, {
                    ok: false,
                    error: 'No resource tracker with that id.'
                });
            if (!card.secondary) {
                return mHttpResponse.sendJson(res, 400, {
                    ok: false,
                    error: `${card.name} doesn't have a secondary count.`
                });
            }
            const body = await mHttpBody.readBody(req);
            const value = Number(match[2] === 'adjust' ? body.delta : body.value);
            if (!Number.isFinite(value))
                return mHttpResponse.sendJson(res, 400, {
                    ok: false,
                    error: 'Send a whole number.'
                });
            card.secondaryCount = Math.max(
                0,
                match[2] === 'adjust'
                    ? (card.secondaryCount || 0) + Math.trunc(value)
                    : Math.trunc(value)
            );
            mResources.broadcastResourceTrackers();
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                resourceTrackers: mResources.resourceTrackersView()
            });
        }
    }

    {
        // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection): each
        // material tracked on the card gets its own adjust/set, same shape as
        // every other per-card route, just addressed by card id AND slot id.
        const match = pathname.match(
            /^\/api\/resource-trackers\/([a-z0-9-]+)\/slot\/([a-z0-9-]+)\/(adjust|set|set-start)$/i
        );
        if (match && ['POST', 'PUT'].includes(method)) {
            const card = mResources.findResourceCard(match[1].toLowerCase());
            if (!card)
                return mHttpResponse.sendJson(res, 404, {
                    ok: false,
                    error: 'No resource tracker with that id.'
                });
            if (!Array.isArray(card.slots)) {
                return mHttpResponse.sendJson(res, 400, {
                    ok: false,
                    error: `${card.name} doesn't have slots.`
                });
            }
            const slot = card.slots.find((s) => s.id === match[2].toLowerCase());
            if (!slot)
                return mHttpResponse.sendJson(res, 404, {
                    ok: false,
                    error: 'No slot with that id on this card.'
                });
            const body = await mHttpBody.readBody(req);
            if (match[3] === 'set-start') {
                // Countdown slots only: change this box's batch size and restock it now,
                // saved to config/resource-trackers.json so it survives a restart.
                const startAt = Math.trunc(Number(body.startAt));
                if (slot.mode !== 'countdown' || !Number.isFinite(startAt) || startAt < 0)
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Send a whole number of 0 or more for a countdown box.'
                    });
                slot.startAt = startAt;
                slot.count = startAt;
                try {
                    const cfg = JSON.parse(fs.readFileSync(mResources.RESOURCE_CARDS_FILE, 'utf8'));
                    const def = (cfg.cards || []).find((c) => c.id === card.id);
                    const defSlot = def && (def.slots || []).find((s) => s.id === slot.id);
                    if (defSlot) {
                        defSlot.startAt = startAt;
                        fs.writeFileSync(
                            mResources.RESOURCE_CARDS_FILE,
                            JSON.stringify(cfg, null, 2)
                        );
                    }
                } catch (_error) {
                    /* live change still applies even if the config write fails */
                }
                mResources.broadcastResourceTrackers();
                return mHttpResponse.sendJson(res, 200, {
                    ok: true,
                    resourceTrackers: mResources.resourceTrackersView()
                });
            }
            const value = Number(match[3] === 'adjust' ? body.delta : body.value);
            if (!Number.isFinite(value))
                return mHttpResponse.sendJson(res, 400, {
                    ok: false,
                    error: 'Send a whole number.'
                });
            slot.count = Math.max(
                0,
                match[3] === 'adjust' ? (slot.count || 0) + Math.trunc(value) : Math.trunc(value)
            );
            mResources.broadcastResourceTrackers();
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                resourceTrackers: mResources.resourceTrackersView()
            });
        }
    }

    {
        // Zero every slot on a collection card at once (e.g. after turning
        // materials in) - same "are you sure" confirm pattern the dashboard
        // already uses for every other reset button.
        const match = pathname.match(/^\/api\/resource-trackers\/([a-z0-9-]+)\/slots-reset$/i);
        if (match && ['POST', 'PUT'].includes(method)) {
            const card = mResources.findResourceCard(match[1].toLowerCase());
            if (!card)
                return mHttpResponse.sendJson(res, 404, {
                    ok: false,
                    error: 'No resource tracker with that id.'
                });
            if (!Array.isArray(card.slots)) {
                return mHttpResponse.sendJson(res, 400, {
                    ok: false,
                    error: `${card.name} doesn't have slots.`
                });
            }
            for (const slot of card.slots)
                slot.count = slot.mode === 'countdown' ? Number(slot.startAt) || 0 : 0;
            mResources.broadcastResourceTrackers();
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                resourceTrackers: mResources.resourceTrackersView()
            });
        }
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}

Object.assign(exports, { handleResourcesApi });
