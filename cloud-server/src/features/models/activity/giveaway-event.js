'use strict';
/** Apply normalized support facts within the owner's command transaction. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const mGiveawayState = context.use('giveaway/state');
    const mDomainValidation = require('../../../domain/validation');
    const mAvatars = context.use('avatars');
    const mStreamFrame = context.use('stream-frame');
    const mNeonChat = context.use('neon-chat');
    const mGiveawayActivity = context.use('giveaway/activity');

    /** Return a transport-independent outcome from the existing giveaway rules. */
    function reply(status, payload) {
        return { status, payload };
    }

    /** Apply one live event through the existing ticket engine; reporting never awards again. */
    function applyEvent(body) {
        const type = mDomainValidation.cleanString(body.type);
        const username = mDomainValidation.cleanString(body.username);
        mGiveawayState.listenerStatus.lastSeen = new Date().toISOString();
        mGiveawayState.listenerStatus.lastEventAt = mGiveawayState.listenerStatus.lastSeen;
        mGiveawayState.listenerStatus.lastEvent = `${type}${username ? ' from ' + username : ''}${
            type === 'bits' ? ' (' + body.amount + ' bits)' : ''
        }${type === 'gifts' ? ' (' + body.count + ' gifted)' : ''}${
            type === 'sub' && body.months > 1 ? ' (' + body.months + ' months)' : ''
        }`;
        try {
            if (type !== 'chat') mAvatars.avEvent(type, username, body);
        } catch (_error) {}
        // The animated overlay reacts to follows, subs, gifts, bits and raids (never throws).
        // Blocked names (bots, test accounts) do not set it off.
        if (type !== 'chat' && !(username && mGiveawayState.isBlocked(username))) {
            mStreamFrame.frameEvent(type, username, body);
            mNeonChat.neonChatEvent(type, username, body); // highlighted line in Neon Chat
        }
        const blocked = username && mGiveawayState.isBlocked(username);
        // Report-only events: no unicorns, just the nightly log.
        if (type === 'follow') {
            if (username) mGiveawayActivity.logActivity({ type: 'follow', username });
            return reply(200, { ok: true });
        }
        if (type === 'raid') {
            mGiveawayActivity.logActivity({
                type: 'raid',
                username,
                viewers: Math.max(0, Math.trunc(Number(body.viewers)) || 0)
            });
            return reply(200, { ok: true });
        }
        if (blocked) {
            // Real support from a blocked name (e.g. a sub) still goes in the report.
            if (type !== 'chat')
                mGiveawayActivity.logActivity({
                    type,
                    username,
                    blocked: true,
                    months: body.months,
                    count: body.count,
                    amount: body.amount,
                    tier: mDomainValidation.cleanString(body.tier),
                    subType: mDomainValidation.cleanString(body.subType)
                });
            return reply(200, { ok: true, note: 'blocked name, ignored.' });
        }

        if (type === 'chat') {
            if (!username)
                return reply(400, {
                    ok: false,
                    error: 'username is required.'
                });
            mGiveawayState.giveaway.chatActiveThisWindow[
                mGiveawayState.ensureEntrant(username).username
            ] = true;
            mGiveawayState.ensureEntrant(username).lastSeenAt = new Date().toISOString();
            mGiveawayState.markChatDirty();
            return reply(200, { ok: true });
        }

        if (type === 'sub') {
            if (!username)
                return reply(400, {
                    ok: false,
                    error: 'username is required.'
                });
            const entrant = mGiveawayState.ensureEntrant(username);
            // Firehose sends months_purchased: 1 for a normal sub/resub, more when
            // someone buys several months at once.
            const months = Math.min(24, Math.max(1, Math.trunc(Number(body.months)) || 1));
            const before = mGiveawayState.entrantTotal(entrant);
            entrant.counts.subMonths += months;
            mGiveawayState.recomputeEntrant(entrant);
            mGiveawayActivity.logActivity({
                type: 'sub',
                username: entrant.username,
                months,
                tier: mDomainValidation.cleanString(body.tier),
                subType: mDomainValidation.cleanString(body.subType),
                unicorns: mGiveawayState.entrantTotal(entrant) - before
            });
            entrant.lastSeenAt = new Date().toISOString();
            mGiveawayState.broadcastGiveaway();
            return reply(200, {
                ok: true,
                entrant: { ...entrant, totalTickets: mGiveawayState.entrantTotal(entrant) }
            });
        }

        if (type === 'gifts') {
            if (!username)
                return reply(400, {
                    ok: false,
                    error: 'username is required.'
                });
            const count = Math.max(0, Math.trunc(Number(body.count)) || 0);
            if (count <= 0)
                return reply(200, {
                    ok: true,
                    note: 'count was 0, nothing awarded.'
                });
            const entrant = mGiveawayState.ensureEntrant(username);
            const before = mGiveawayState.entrantTotal(entrant);
            entrant.counts.giftedSubs += count;
            mGiveawayState.recomputeEntrant(entrant);
            mGiveawayActivity.logActivity({
                type: 'gifts',
                username: entrant.username,
                count,
                tier: mDomainValidation.cleanString(body.tier),
                unicorns: mGiveawayState.entrantTotal(entrant) - before
            });
            entrant.lastSeenAt = new Date().toISOString();
            mGiveawayState.broadcastGiveaway();
            return reply(200, {
                ok: true,
                entrant: { ...entrant, totalTickets: mGiveawayState.entrantTotal(entrant) }
            });
        }

        if (type === 'bits') {
            if (!username)
                return reply(400, {
                    ok: false,
                    error: 'username is required.'
                });
            const amount = Math.max(0, Math.trunc(Number(body.amount)) || 0);
            if (amount <= 0)
                return reply(200, {
                    ok: true,
                    note: 'no bits, nothing recorded.'
                });
            const entrant = mGiveawayState.ensureEntrant(username);
            // Bits add up across cheers: 60 + 50 = 110 bits = 1 unicorn at 100 per.
            const before = mGiveawayState.entrantTotal(entrant);
            entrant.counts.bits += amount;
            mGiveawayState.recomputeEntrant(entrant);
            mGiveawayActivity.logActivity({
                type: 'bits',
                username: entrant.username,
                amount,
                unicorns: mGiveawayState.entrantTotal(entrant) - before
            });
            entrant.lastSeenAt = new Date().toISOString();
            mGiveawayState.broadcastGiveaway();
            return reply(200, {
                ok: true,
                entrant: { ...entrant, totalTickets: mGiveawayState.entrantTotal(entrant) }
            });
        }

        return reply(400, {
            ok: false,
            error: `Unknown event type "${type}".`
        });
    }

    Object.assign(exports, { applyEvent });
};
