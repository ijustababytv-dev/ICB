'use strict';
const { replaceRows } = require('./rows');
const { saveCollections } = require('./entities');

/** Save rows with explicit identifiers and typed progress columns for each feature family. */
async function saveProgress(client, owner, feature, doc) {
    const handled = await saveCollections(client, owner, feature, doc);
    if (feature === 'steam')
        for (const key of await require('./steam').saveSteam(client, owner, doc)) handled.add(key);
    if (feature === 'todos') {
        await replaceRows(
            client,
            'todos',
            owner,
            ['daily', 'weekly'].flatMap((list) =>
                (doc[list] || []).map((item, position) => ({
                    list,
                    id: item.id,
                    text: item.text,
                    kind: item.kind,
                    done: !!item.done,
                    current: item.current || 0,
                    target: item.target || 1,
                    position,
                    created_at: item.createdAt || new Date().toISOString()
                }))
            )
        );
        handled.add('daily');
        handled.add('weekly');
    }
    if (feature === 'turnline') {
        await replaceRows(
            client,
            'turn_entries',
            owner,
            (doc.people || []).map((item, position) => ({
                id: item.id,
                name: item.name,
                state: item.state,
                position
            }))
        );
        handled.add('people');
    }
    if (feature === 'giveaway') {
        await replaceRows(
            client,
            'giveaway_entrants',
            owner,
            Object.entries(doc.entrants || {}).map(([key, entry]) => ({
                name_key: key,
                name: entry.username || key,
                tickets: [
                    'chatTickets',
                    'subTickets',
                    'giftTickets',
                    'bitsTickets',
                    'manualTickets'
                ].reduce((sum, key) => sum + (Number(entry[key]) || 0), 0),
                bits: entry.counts?.bits || 0,
                months: entry.counts?.subMonths || 0,
                gifts: entry.counts?.giftedSubs || 0,
                notes: entry.note || '',
                details: entry
            }))
        );
        await replaceRows(
            client,
            'giveaway_winners',
            owner,
            (doc.winners || []).map((entry, position) => ({
                id: String(position),
                position,
                details: entry
            }))
        );
        handled.add('entrants');
        handled.add('winners');
        const active = Object.keys(doc.chatActiveThisWindow || {});
        const window = Date.parse(doc.windowStartedAt) || 0;
        await client.query(
            'UPDATE chat_window_presence SET awarded_at=now() WHERE owner_id=$1 AND window_id<$2 AND awarded_at IS NULL',
            [owner, window]
        );
        if (active.length)
            await client.query(
                `INSERT INTO chat_window_presence(owner_id,name_key,window_id,occurred_at)
            SELECT $1,name,$2,now() FROM unnest($3::text[]) name ON CONFLICT DO NOTHING`,
                [owner, window, active]
            );
        handled.add('chatActiveThisWindow');
    }
    if (feature === 'poll') {
        await replaceRows(
            client,
            'poll_options',
            owner,
            (doc.options || []).map((item, position) => ({
                id: item.id,
                label: item.label,
                image: item.image || null,
                position
            }))
        );
        await replaceRows(
            client,
            'poll_votes',
            owner,
            Object.entries(doc.votes || {}).flatMap(([key, vote]) =>
                (vote.picks || []).map((id) => ({
                    name_key: key,
                    option_id: id,
                    display_name: vote.name,
                    subscriber: !!vote.sub,
                    occurred_at: vote.at || 0
                }))
            )
        );
        handled.add('options');
        handled.add('votes');
    }
    if (['sashimi-signin', 'beanburger-signup', 'flowtree-signup'].includes(feature)) {
        await replaceRows(
            client,
            'signup_events',
            owner,
            (doc.events || []).map((event, position) => {
                const { guests, ...details } = event;
                return { feature, id: event.id, position, details };
            }),
            { feature }
        );
        await replaceRows(
            client,
            'signup_entries',
            owner,
            (doc.events || []).flatMap((event) =>
                (event.guests || []).map((guest, position) => ({
                    feature,
                    event_id: event.id,
                    id: String(guest.n ?? position),
                    name_key: String(
                        guest.twitch || guest.name || guest.n || position
                    ).toLowerCase(),
                    display_name: String(guest.name || guest.twitch || ''),
                    position,
                    checked_in: !!guest.checkedIn,
                    details: guest
                }))
            ),
            { feature }
        );
        handled.add('events');
    }
    if (feature === 'teams' || feature === 'hunt') {
        const rows = Object.entries(doc.players || {}).map(([key, item]) => ({
            name_key: key,
            display_name: item.name || key,
            team_id: item.team || null,
            details: item,
            ...(feature === 'teams'
                ? {
                      score: Object.values(item.points || {}).reduce(
                          (sum, value) => sum + (Number(value) || 0),
                          0
                      )
                  }
                : {})
        }));
        await replaceRows(
            client,
            feature === 'teams' ? 'team_members' : 'hunt_players',
            owner,
            rows
        );
        handled.add('players');
    }
    if (feature === 'countdowns') {
        await replaceRows(
            client,
            'feature_timers',
            owner,
            (doc.list || []).map((item, position) => ({
                feature,
                id: item.id,
                position,
                ends_at: item.endsAt || null,
                paused_ms: item.leftMs || 0,
                status: item.status || 'idle',
                details: item
            })),
            { feature }
        );
        handled.add('list');
    }
    if (feature === 'live' || feature === 'resource-trackers') {
        const prefix = feature === 'live' ? 'live/' : 'card/';
        await client.query(
            'DELETE FROM resource_progress WHERE owner_id=$1 AND resource_id LIKE $2',
            [owner, prefix + '%']
        );
        const counts = feature === 'live' ? doc.resources || {} : doc.counts || {};
        for (const [id, quantity] of Object.entries(counts))
            await client.query(
                `INSERT INTO resource_progress(owner_id,resource_id,quantity,secondary_quantity)
            VALUES($1,$2,$3,$4)`,
                [owner, prefix + id, quantity, doc.secondaryCounts?.[id] || 0]
            );
        handled.add(feature === 'live' ? 'resources' : 'counts');
        if (feature === 'resource-trackers') {
            handled.add('secondaryCounts');
            await replaceRows(
                client,
                'resource_slot_progress',
                owner,
                Object.entries(doc.slotCounts || {}).flatMap(([id, slots]) =>
                    Object.entries(slots).map(([slot, quantity]) => ({
                        resource_id: id,
                        slot_id: slot,
                        quantity
                    }))
                )
            );
            handled.add('slotCounts');
        }
    }
    if (feature === 'weekly-accomplishments') {
        await replaceRows(
            client,
            'weekly_progress',
            owner,
            Object.entries(doc.progress || {}).map(([id, value]) => ({
                goal_id: id,
                week_start: doc.weekStart || '',
                quantity: value.count || 0,
                done: !!value.done
            }))
        );
        handled.add('progress');
    }
    return handled;
}

module.exports = { saveProgress };
