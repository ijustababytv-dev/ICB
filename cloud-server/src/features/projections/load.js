'use strict';
const { readRows } = require('./rows');
const { loadCollections } = require('./entities');

/** Hydrate typed entities into the established domain DTO shapes without changing saved behavior. */
async function loadProgress(client, owner, documents, byFeature) {
    /** Ignore absent/unmigrated documents instead of silently initializing another feature. */
    function document(feature) {
        return documents[byFeature.get(feature)?.file];
    }

    await loadCollections(client, owner, documents, byFeature);
    if (document('steam')) await require('./steam').loadSteam(client, owner, document('steam'));
    if (document('todos')) {
        const doc = document('todos');
        doc.daily = [];
        doc.weekly = [];
        for (const row of (await readRows(client, 'todos', owner)).sort(
            (a, b) => a.position - b.position
        )) {
            const item = {
                id: row.id,
                text: row.text,
                kind: row.kind,
                createdAt: row.created_at.toISOString()
            };
            Object.assign(
                item,
                row.kind === 'goal'
                    ? { current: Number(row.current), target: Number(row.target) }
                    : { done: row.done }
            );
            doc[row.list].push(item);
        }
    }
    if (document('turnline'))
        document('turnline').people = (await readRows(client, 'turn_entries', owner))
            .sort((a, b) => a.position - b.position)
            .map((row) => ({ id: Number(row.id), name: row.name, state: row.state }));
    if (document('giveaway')) {
        const doc = document('giveaway');
        doc.entrants = Object.fromEntries(
            (await readRows(client, 'giveaway_entrants', owner)).map((row) => [
                row.name_key,
                row.details
            ])
        );
        doc.winners = (await readRows(client, 'giveaway_winners', owner))
            .sort((a, b) => a.position - b.position)
            .map((row) => row.details);
        doc.chatActiveThisWindow = Object.fromEntries(
            (
                await client.query(
                    'SELECT name_key FROM chat_window_presence WHERE owner_id=$1 AND awarded_at IS NULL',
                    [owner]
                )
            ).rows.map((row) => [row.name_key, true])
        );
    }
    if (document('poll')) {
        const doc = document('poll');
        doc.options = (await readRows(client, 'poll_options', owner))
            .sort((a, b) => a.position - b.position)
            .map((row) => ({ id: row.id, label: row.label, image: row.image }));
        doc.votes = {};
        for (const row of await readRows(client, 'poll_votes', owner)) {
            const vote =
                doc.votes[row.name_key] ||
                (doc.votes[row.name_key] = {
                    name: row.display_name,
                    sub: row.subscriber,
                    at: Number(row.occurred_at),
                    picks: []
                });
            vote.picks.push(row.option_id);
        }
    }
    const signupEvents = await readRows(client, 'signup_events', owner);
    const signupEntries = await readRows(client, 'signup_entries', owner);
    for (const feature of ['sashimi-signin', 'beanburger-signup', 'flowtree-signup'])
        if (document(feature)) {
            document(feature).events = signupEvents
                .filter((row) => row.feature === feature)
                .sort((a, b) => a.position - b.position)
                .map((row) => ({
                    ...row.details,
                    guests: signupEntries
                        .filter((guest) => guest.feature === feature && guest.event_id === row.id)
                        .sort((a, b) => a.position - b.position)
                        .map((guest) => guest.details)
                }));
        }
    for (const [feature, table] of [
        ['teams', 'team_members'],
        ['hunt', 'hunt_players']
    ])
        if (document(feature))
            document(feature).players = Object.fromEntries(
                (await readRows(client, table, owner)).map((row) => [row.name_key, row.details])
            );
    if (document('countdowns'))
        document('countdowns').list = (await readRows(client, 'feature_timers', owner))
            .filter((row) => row.feature === 'countdowns')
            .sort((a, b) => a.position - b.position)
            .map((row) => ({
                ...row.details,
                endsAt: Number(row.ends_at) || 0,
                leftMs: Number(row.paused_ms),
                status: row.status
            }));
    const counts = await readRows(client, 'resource_progress', owner);
    if (document('live'))
        document('live').resources = Object.fromEntries(
            counts
                .filter((row) => row.resource_id.startsWith('live/'))
                .map((row) => [row.resource_id.slice(5), Number(row.quantity)])
        );
    if (document('resource-trackers')) {
        const doc = document('resource-trackers');
        doc.counts = {};
        doc.secondaryCounts = {};
        doc.slotCounts = {};
        for (const row of counts.filter((row) => row.resource_id.startsWith('card/'))) {
            doc.counts[row.resource_id.slice(5)] = Number(row.quantity);
            doc.secondaryCounts[row.resource_id.slice(5)] = Number(row.secondary_quantity);
        }
        for (const row of await readRows(client, 'resource_slot_progress', owner)) {
            const slots = doc.slotCounts[row.resource_id] || (doc.slotCounts[row.resource_id] = {});
            slots[row.slot_id] = Number(row.quantity);
        }
    }
    if (document('weekly-accomplishments'))
        document('weekly-accomplishments').progress = Object.fromEntries(
            (await readRows(client, 'weekly_progress', owner)).map((row) => [
                row.goal_id,
                { count: Number(row.quantity), done: row.done }
            ])
        );
}

module.exports = { loadProgress };
