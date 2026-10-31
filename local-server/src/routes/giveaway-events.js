'use strict';

const mHttpResponse = require('../http/response');
const mGiveawayState = require('../giveaway/state');
const mHttpBody = require('../http/body');
const mDomainValidation = require('../domain/validation');
const mGiveawayActivity = require('../giveaway/activity');

/** Handle giveaway events requests; reject unmatched paths. */
async function handleGiveawayEventsApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (method === 'POST') require('../activity/collector').requireCapacity();
    // ---------------- Stream Giveaway ----------------
    if (pathname === '/api/giveaway/state' && method === 'GET') {
        return mHttpResponse.sendJson(res, 200, {
            ok: true,
            giveaway: mGiveawayState.publicGiveaway()
        });
    }

    // Called by giveaway-listener.html (the Meld Firehose relay) for every raw
    // chat/sub/gifts/bits event. This is the ONLY place ticket math happens.
    if (pathname === '/api/giveaway/event' && method === 'POST') {
        const body = await mHttpBody.readBody(req);
        if (body.type === 'chat') require('../activity/collector').chat(body);
        const result = mGiveawayActivity.withEvent(body, () =>
            require('../activity/giveaway-event').applyEvent(body)
        );
        if (body.type !== 'chat') mGiveawayState.saveGiveaway();
        return mHttpResponse.sendJson(res, result.status, result.payload);
    }

    // Dashboard-only manual ticket adjustment (donations, corrections, etc.
    // that don't come through Firehose).
    // Accepts one `username` or a `usernames` array (e.g. a list of existing
    // subs), matches existing entrants case-insensitively so "bob" and "Bob"
    // don't become two people, and logs every give/take with a reason.
    if (pathname === '/api/giveaway/manual' && method === 'POST') {
        const body = await mHttpBody.readBody(req);
        const rawNames = Array.isArray(body.usernames) ? body.usernames : [body.username];
        const seen = new Set();
        const names = [];
        for (const raw of rawNames) {
            const name = mDomainValidation.cleanString(raw).replace(/^@/, '');
            if (name && !seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                names.push(name);
            }
        }
        // kind: what Baby is adding. "unicorns" = plain fluffy unicorns;
        // "subMonths" / "giftedSubs" / "bits" = the real thing, priced by rates
        // and shown in that viewer's breakdown + sub info (6 months -> sub 12).
        const KIND_FIELDS = { subMonths: 'subMonths', giftedSubs: 'giftedSubs', bits: 'bits' };
        const kind = KIND_FIELDS[body.kind] ? body.kind : 'unicorns';
        const amount = Math.trunc(Number(body.amount !== undefined ? body.amount : body.delta));
        const maxAmount = kind === 'bits' ? 1000000 : 1000;
        const reason = mDomainValidation.cleanString(body.reason).slice(0, 80);
        if (!names.length)
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: 'Type at least one username.'
            });
        if (names.length > 200)
            return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Max 200 names at once.' });
        if (!Number.isFinite(amount) || amount === 0)
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: 'Amount must be a non-zero whole number.'
            });
        if (Math.abs(amount) > maxAmount)
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: `Amount must be between -${maxAmount} and ${maxAmount}.`
            });

        if (!Array.isArray(mGiveawayState.giveaway.manualLog))
            mGiveawayState.giveaway.manualLog = [];
        const results = [];
        const now = new Date().toISOString();
        const skipped = names.filter((n) => mGiveawayState.isBlocked(n));
        for (const name of names.filter((n) => !mGiveawayState.isBlocked(n))) {
            const existingKey = mGiveawayState.findEntrantKey(name);
            const entrant = mGiveawayState.ensureEntrant(existingKey || name);
            const totalBefore = mGiveawayState.entrantTotal(entrant);
            let appliedAmount;
            if (kind === 'unicorns') {
                const before = entrant.manualTickets;
                // Manual can go negative to correct auto-earned unicorns, but a
                // viewer's total never drops below 0.
                const autoEarned = totalBefore - before;
                entrant.manualTickets = Math.max(-autoEarned, entrant.manualTickets + amount);
                appliedAmount = entrant.manualTickets - before;
            } else {
                const field = KIND_FIELDS[kind];
                const before = entrant.counts[field];
                entrant.counts[field] = Math.max(0, before + amount);
                appliedAmount = entrant.counts[field] - before;
                mGiveawayState.recomputeEntrant(entrant);
            }
            const delta = mGiveawayState.entrantTotal(entrant) - totalBefore;
            mGiveawayState.giveaway.manualLog.push({
                username: entrant.username,
                kind,
                amount: appliedAmount,
                delta,
                reason,
                at: now
            });
            mGiveawayActivity.logActivity({
                type: 'manual',
                username: entrant.username,
                kind,
                amount: appliedAmount,
                unicorns: delta,
                reason
            });
            results.push({
                username: entrant.username,
                kind,
                appliedAmount,
                applied: delta,
                totalTickets: mGiveawayState.entrantTotal(entrant),
                wasNew: !existingKey
            });
        }
        if (mGiveawayState.giveaway.manualLog.length > 300)
            mGiveawayState.giveaway.manualLog = mGiveawayState.giveaway.manualLog.slice(-300);
        if (!results.length)
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: `${skipped.join(', ')} ${
                    skipped.length === 1 ? 'is' : 'are'
                } on the block list.`
            });
        mGiveawayState.broadcastGiveaway();
        return mHttpResponse.sendJson(res, 200, { ok: true, results, skipped });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}

Object.assign(exports, { handleGiveawayEventsApi });
