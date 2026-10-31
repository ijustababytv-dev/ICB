'use strict';

// -----------------------------------------------------------------------
// STREAM GIVEAWAY — built 2026-09-24 for the pink/purple "fluffy unicorn"
// giveaway, one night's worth of tickets, two prize types (plushie, mystery
// outfit), fed by a Meld Firehose listener layer (giveaway-listener.html)
// that relays raw chat/sub/gifts/purchase events to /api/giveaway/event.
// This server does ALL the ticket math - the listener page is a dumb relay.
//
// Ticket rules, confirmed with Baby:
//   - Chat: 1 ticket per rolling 10-minute window with >=1 message, no cap,
//     adds up all night (CHAT_WINDOW_MS tick below).
//   - Sub/resub: 1 ticket per sub event (one per real month subscribed,
//     assuming Twitch/Firehose fires a sub event once per billing month -
//     unverified against a real event yet, first thing to check on air).
//   - Gifted subs: 2 tickets per sub gifted, credited to the GIFTER.
//   - Bits: 1 ticket per full 100 bits (250 bits = 2 tickets, remainder
//     dropped). NOTE: the exact field name Firehose uses for a bits amount
//     on its "purchase" event is unverified - see giveaway-listener.html.
//   - Donations: explicitly out of scope for tonight (Baby's call) - use
//     the dashboard's manual ticket adjuster for anything that isn't chat/
//     sub/gift/bits.
//   - Same ticket pool feeds both prize types.
//   - Plushie winners stay in the pool (can win again). Mystery Outfit
//     winners are removed from future Mystery Outfit draws only - they
//     stay eligible for Plushie draws.
//   - Everything ROLLS OVER between streams (entrants, unicorn counts,
//     breakdowns, winners, Mystery Outfit locks) - it's all saved to
//     data/giveaway.json and only the dashboard's Reset button clears it.
//     Baby's call, 2026-09-25.
//
// Rates (2026-09-25, Baby: "2 and 4 everywhere"): each entrant stores raw
// COUNTS (chat windows, sub months, gifted subs, bits cheered) and the
// *Tickets fields are recomputed from giveaway.rates. Changing a rate on the
// dashboard re-prices everyone, live and hand-entered alike.
const GIVEAWAY_DEFAULTS = {
    windowStartedAt: null,
    entrants: {}, // username -> { username, counts:{chatWindows,subMonths,giftedSubs,bits}, chatTickets, subTickets, giftTickets, bitsTickets (derived), manualTickets, note, mysteryOutfitWon, lastSeenAt }
    chatActiveThisWindow: {}, // username -> true, cleared every CHAT_WINDOW_MS tick
    winners: [], // { username, prize, tickets, at }
    manualLog: [], // { username, kind, amount, delta, reason, at } - dashboard "Give fluffy unicorns" history, newest last
    // Fluffy unicorns earned per thing. Survives Reset (it's a setting).
    rates: { chatWindow: 1, subMonth: 2, giftedSub: 4, bitsPerUnicorn: 100 },
    // The on-screen jar starts empty each stream day while everyone's counts
    // roll over (Baby, 2026-09-25). Snapshot of each viewer's counts when the
    // jar was last emptied; the jar shows only what was earned since.
    jarBaseline: { night: null, startedAt: null, snapshot: {} },
    // Never part of the giveaway: Baby herself + chat bots. Case-insensitive.
    // Survives Reset. Edited on the dashboard. (Baby, 2026-09-25: "I don't
    // want me nor any bots in the giveaways".)
    blocked: [
        'IJustABabyTv',
        'StreamDatabase',
        'Nightbot',
        'StreamElements',
        'Streamlabs',
        'Moobot',
        'Fossabot',
        'Sery_Bot',
        'Wizebot',
        'SoundAlerts',
        'Blerp',
        'KofiStreamBot',
        'StreamStickers',
        'TangiaBot',
        'PokemonCommunityGame',
        'BotRixOficial',
        'CommanderRoot',
        'LurxxBot',
        'Streamlootsbot',
        'Own3d',
        'Anonymous'
    ],
    // On-screen wording for the overlays, edited from giveaway-control.html.
    // Survives "Reset for tonight" - reset only clears entrants/winners.
    display: {
        entrantsTitle: '🦄 Giveaway Entrants 🦄',
        emptyMessage: 'No entries yet — chat, sub, gift, or cheer to get in!',
        maxRows: 10,
        tickerMessages: [
            'Chat every 10 min = 1 fluffy unicorn, all night long!',
            'Sub = 2 fluffy unicorns a month. Gift a sub = 4 fluffy unicorns EACH!',
            '100 bits = 1 fluffy unicorn (250 bits = 2 fluffy unicorns)',
            'Plushie drawings every ~30 min - you can win more than once!',
            'Mystery Outfit drawing every hour - one per person per night!'
        ],
        winnersTitle: '🏆 Winners Circle 🏆',
        winnersEmptyMessage: 'No winners drawn yet tonight!',
        // unicorn-jar.html settings
        jarSide: 'right', // 'left' | 'center' | 'right'
        unicornSize: 'medium', // 'small' | 'medium' | 'large'
        showNames: false, // print each viewer's name on their unicorns (Baby turned this off 2026-09-25)
        magic: true, // cloud, falling stars and rainbow on unicorn-jar.html
        // What to call the current prize on the winner banner/board (Baby,
        // 2026-09-26), e.g. "Squishmallow Corgi" instead of the generic
        // "Plushie". Baked into each winnerRecord at draw time (see /draw
        // below) so past winners keep whatever was current when they won.
        // Empty = fall back to the generic "Plushie" / "Mystery Outfit" wording.
        currentPrizeLabel: ''
    },
    // Baby (2026-09-26): a "Test" button so she can show someone how a
    // drawing looks without it being a real one. Bumping seq tells
    // unicorn-jar.html to run the full show with IJustABabyTv as the
    // winner - it never touches entrants, giveaway.winners, or the
    // activity log, so it can't leak into the real Winners Circle or
    // nightly report, and it works even though IJustABabyTv is blocked.
    testDraw: { seq: 0, prize: 'plushie' }
};
const CHAT_WINDOW_MS = 10 * 60 * 1000;

Object.assign(exports, { GIVEAWAY_DEFAULTS, CHAT_WINDOW_MS });
