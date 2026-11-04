'use strict';
const { replaceRows } = require('./rows');
const { stableId } = require('../../domain/stable-id');
const FEATURES = ['sashimi-signin', 'beanburger-signup', 'flowtree-signup', 'parties'];

/** Project all board types into ordered entries and explicit attendance rows, retaining legacy API shapes. */
async function saveSignups(client, owner, feature, doc) {
    if (!FEATURES.includes(feature)) return false;
    const child = feature === 'parties' ? 'signups' : 'guests';
    await replaceRows(
        client,
        'signup_events',
        owner,
        (doc.events || []).map((event, position) => {
            const details = { ...event };
            delete details[child];
            return {
                feature,
                id: event.id,
                event_uuid: stableId(owner, feature, event.id),
                position,
                details
            };
        }),
        { feature }
    );
    const entries = (doc.events || []).flatMap((event) =>
        (event[child] || []).map((guest, position) => {
            const name = String(
                guest.twitch || guest.name || guest.palia || guest.n || position
            ).toLowerCase();
            return {
                feature,
                event_id: event.id,
                id: stableId(owner, feature, event.id, name, guest.role || ''),
                name_key: name,
                display_name: String(guest.name || guest.palia || guest.twitch || ''),
                position,
                checked_in: !!guest.checkedIn,
                details: guest
            };
        })
    );
    await replaceRows(client, 'signup_entries', owner, entries, { feature });
    const checkins = [
        ...new Map(
            entries
                .filter((entry) => entry.checked_in)
                .map((entry) => [
                    entry.event_id + ':' + entry.name_key,
                    {
                        feature,
                        event_id: entry.event_id,
                        name_key: entry.name_key,
                        checked_at:
                            typeof entry.details.checkedIn === 'number'
                                ? new Date(entry.details.checkedIn).toISOString()
                                : new Date().toISOString()
                    }
                ])
        ).values()
    ];
    await replaceRows(client, 'signup_checkins', owner, checkins, { feature });
    return true;
}

module.exports = { FEATURES, saveSignups };
