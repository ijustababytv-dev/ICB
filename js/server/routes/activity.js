'use strict';

const mHttpBody = require('../http/body');
const mDomainValidation = require('../domain/validation');
const mGiveawayActivity = require('../giveaway/activity');
const mHealth = require('../health');
const mWalkers = require('../walkers');
const mPoll = require('../poll');
const mTeams = require('../teams');
const mSignupsCommands = require('../signups/commands');
const mSignupsPoke = require('../signups/poke');
const mSignupsBurger = require('../signups/burger');
const mSignupsFlow = require('../signups/flow');
const mAniimo = require('../aniimo');
const mAvatars = require('../avatars');
const mSpriteJar = require('../sprite-jar');
const mHunt = require('../hunt');
const mParty = require('../party');
const mHttpResponse = require('../http/response');
const fs = require('node:fs');
const mConfig = require('../config');
const mStorage = require('../storage');
const mGiveawayState = require('../giveaway/state');

/** Handle activity requests; reject unmatched paths. */
async function handleActivityApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    // Raw Firehose events from the listener's catch-all, for the nightly report.
    // Body is capped (readBody) and nothing here touches unicorns.
    if (pathname === '/api/activity/raw' && method === 'POST') {
        const body = await mHttpBody.readBody(req);
        const kind = mDomainValidation.cleanString(body.kind).slice(0, 60);
        if (kind) mGiveawayActivity.logActivity({ type: 'raw', kind, data: body.data });
        try {
            mHealth.healthNoteRaw(kind, body.data);
        } catch (_error) {}
        // Chat Unicorns: every chat message (sender + text + emote pictures).
        if (kind === 'chat' && body.data && typeof body.data.sender === 'string') {
            try {
                mWalkers.walkerChat(body.data.sender, mWalkers.walkerParts(body.data), false);
            } catch (_error) {}
            try {
                mPoll.pollChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            try {
                mTeams.teamsChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            let shDone = false; // "!show cake" / "!hide flow" ... (handled once, then the sign-ups skip it)
            try {
                shDone = mSignupsCommands.signupShowHideChat(
                    body.data.sender,
                    mWalkers.walkerParts(body.data)
                );
            } catch (_error) {}
            if (!shDone) {
                try {
                    mSignupsPoke.sashiChat(body.data.sender, mWalkers.walkerParts(body.data));
                } catch (_error) {}
                try {
                    mSignupsBurger.bbsuChat(body.data.sender, mWalkers.walkerParts(body.data));
                } catch (_error) {}
                try {
                    mSignupsFlow.ftsuChat(body.data.sender, mWalkers.walkerParts(body.data));
                } catch (_error) {}
            }
            try {
                mAniimo.dexChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            try {
                mAvatars.avChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            try {
                mSpriteJar.sjChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            try {
                mHunt.huntChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            if (!shDone)
                try {
                    mParty.partyChat(body.data.sender, mWalkers.walkerParts(body.data));
                } catch (_error) {}
        }
        return mHttpResponse.sendJson(res, 200, { ok: true });
    }
    // Nightly report data (giveaway-report.html).
    if (pathname === '/api/activity/nights' && method === 'GET') {
        let nights = [];
        try {
            nights = fs
                .readdirSync(mConfig.ACTIVITY_DIR)
                .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
                .map((n) => n.slice(0, 10))
                .sort()
                .reverse();
        } catch (_error) {
            nights = [];
        }
        return mHttpResponse.sendJson(res, 200, {
            ok: true,
            nights,
            tonight: mGiveawayActivity.nightKey(new Date())
        });
    }
    if (pathname === '/api/activity/night' && method === 'GET') {
        const key = url.searchParams.get('date') || mGiveawayActivity.nightKey(new Date());
        const events = mGiveawayActivity.readNight(key);
        if (events === null)
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: 'date must look like 2026-09-25.'
            });
        return mHttpResponse.sendJson(res, 200, {
            ok: true,
            date: key,
            events,
            rates: mStorage.clone(mGiveawayState.giveaway.rates),
            blocked: mStorage.clone(mGiveawayState.giveaway.blocked || []),
            standings: Object.values(mGiveawayState.giveaway.entrants).map((e) => ({
                username: e.username,
                total: mGiveawayState.entrantTotal(e),
                counts: e.counts,
                note: e.note,
                mysteryOutfitWon: !!e.mysteryOutfitWon
            }))
        });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}

Object.assign(exports, { handleActivityApi });
