'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const path = require('node:path');
    const mConfig = context.config;
    const mDomainValidation = require('../../domain/validation');
    const mStorage = context.storage;
    const mHttpResponse = context.response;
    const mHttpBody = context.body;
    const mEvents = context.events;

    // ---------------------------------------------------------------------------
    // ICB HOME (Baby, 2026-09-29) - one master page (hub.html, also served at
    // "/") with a tile for every dashboard, so she doesn't need a bookmark for
    // each. Tiles can be dragged into any order, custom links can be added, and
    // each tile has an "open when ICB starts" box - the start/restart .bat files
    // ask /api/hub/startup-urls which pages to open.
    // Saved in data/hub.json: { order: [ids], startup: [ids], custom: [...] }.
    // ---------------------------------------------------------------------------
    const HUB_FILE = path.join(mConfig.DATA_DIR, 'hub.json');
    const HUB_BUILTIN = [
        {
            id: 'cloud',
            icon: '☁',
            name: 'Cloud account',
            url: '/cloud.html',
            desc: 'Sign in, check sync status, and open stored daily reports'
        },
        {
            id: 'spritetv',
            icon: '📺',
            name: 'Sprite TV',
            url: '/sprite-tv-control.html',
            desc: 'Retro TV showing caught sprites, manual picks, and slideshows'
        },
        {
            id: 'trackers',
            icon: '📊',
            name: 'Tracker Command Center',
            url: '/control.html',
            desc: 'Resource trackers, skins, to-do lists, weekly goals'
        },
        {
            id: 'giveaway',
            icon: '🦄',
            name: 'Giveaway & Unicorn Jar',
            url: '/giveaway-control.html',
            desc: 'Draws, give unicorns, rates, board text, backups'
        },
        {
            id: 'report',
            icon: '📄',
            name: 'Nightly Report',
            url: '/giveaway-report.html',
            desc: 'Everything that happened on stream - print or CSV'
        },
        {
            id: 'plushie',
            icon: '🧸',
            name: 'Plushie Jar',
            url: '/tradeup-control.html',
            desc: 'Plushie catalog and the plushie jar pick'
        },
        {
            id: 'decor',
            icon: '🍂',
            name: 'Decor Overlays',
            url: '/decor-control.html',
            desc: 'Falling leaves and other seasonal screen decor'
        },
        {
            id: 'timer',
            icon: '⏳',
            name: 'Countdowns',
            url: '/countdown-control.html',
            desc: 'Starting soon / BRB countdowns - themes, size, your own text and end message'
        },
        {
            id: 'worldclock',
            icon: '🌍',
            name: 'World Time Bar',
            url: '/worldclock-control.html',
            desc: 'Time zone clocks overlay'
        },
        {
            id: 'poll',
            icon: '🗳️',
            name: 'Badge Vote',
            url: '/poll-control.html',
            desc: 'Let chat vote on badges with !vote - images, live results, winner reveal'
        },
        {
            id: 'newsticker',
            icon: '📰',
            name: 'News Ticker',
            url: '/newsticker-control.html',
            desc: 'Scrolling news bar along the bottom of stream - messages, alert, colours, speed'
        },
        {
            id: 'steam',
            icon: '🏅',
            name: 'Steam Achievements',
            url: '/steam-control.html',
            desc: 'Aniimo achievement pop-ups + progress on stream, read from Steam'
        },
        {
            id: 'party',
            icon: '🎂',
            name: 'Cake Sign-Ups',
            url: '/party-control.html',
            desc: 'Chat signs up for overprep roles with !tomato PaliaName - events, roles, spots, waitlist'
        },
        {
            id: 'avatars',
            icon: '👻',
            name: 'Chat Avatars',
            url: '/chat-avatars-control.html',
            desc: 'Chatters become little sprites wandering the bottom of stream with speech bubbles'
        },
        {
            id: 'paliaclock',
            icon: '🕰️',
            name: 'Palia Clock',
            url: '/palia-clock-control.html',
            desc: 'In-game Palia time on stream, with alarms at Palia times'
        },
        {
            id: 'hunt',
            icon: '🎃',
            name: 'Team Hunt',
            url: '/hunt-control.html',
            desc: 'Team contest - chat joins with !team a, finds score with !cloth / !plushie, each worth its own points'
        },
        {
            id: 'spritejar',
            icon: '🫙',
            name: 'Sprite Jar',
            url: '/sprite-jar-control.html',
            desc: 'Stream overlay - !jonesy gold floats that sprite out of the jar into the sticker book'
        },
        {
            id: 'sprites',
            icon: '🎮',
            name: 'Fortnite Sprites',
            url: '/sprites-control.html',
            desc: 'Every sprite + variant this season - tap the circles as you catch them'
        },
        {
            id: 'aniimo',
            icon: '✨',
            name: 'Aniimo Dex',
            url: '/aniimo-control.html',
            desc: 'Catch & variant checklist - progress overlay, new-catch pop-ups, chat !need look-ups, quick checker'
        },
        {
            id: 'desktop',
            icon: '🖥️',
            name: 'Desktop Widgets',
            url: '/desktop-control.html',
            desc: 'Put any widget on your desktop over your game - move, size, show/hide from here'
        },
        {
            id: 'sashimi',
            icon: '🥗',
            name: 'Poke Bowl Sign-up',
            url: '/sashimi-signin-control.html',
            desc: 'Sesh-style event sign-ups from chat - time in world time zones, countdown, roles with their own !commands'
        },
        {
            id: 'bbsignup',
            icon: '🍔',
            name: 'Bean Burger Sign-Up',
            url: '/beanburger-signup-control.html',
            desc: 'Its own sign-up widget (a copy of the Poke Bowl Sign-up) - events, roles with !commands, world times, countdown. Pops up with !burger'
        },
        {
            id: 'ftsignup',
            icon: '🌳',
            name: 'Flow Tree Sign-Up',
            url: '/flowtree-signup-control.html',
            desc: 'Its own sign-up widget (a copy of the Poke Bowl Sign-up) - events, roles with !commands, world times, countdown. Pops up with !flow'
        },
        {
            id: 'eventtime',
            icon: '🕒',
            name: 'Event Time Converter',
            url: '/eventtime-control.html',
            desc: 'Type when an event starts - shows that time + day in PDT, MDT, CDT, EDT, GMT+1, GMT+2'
        },
        {
            id: 'teams',
            icon: '🏆',
            name: 'Team Contest',
            url: '/teams-control.html',
            desc: 'Grinding-party teams: chat joins with !team a, scores with !cloth +2 - live board'
        },
        {
            id: 'walkers',
            icon: '💬',
            name: 'Chat Unicorns',
            url: '/walkers-control.html',
            desc: "Chatters' unicorns hopping along the bottom - who gets one, reminders"
        },
        {
            id: 'oceanfish',
            icon: '🐟',
            name: 'Ocean Fish',
            url: '/ocean-fish-control.html',
            desc: 'Ocean waves and jumping fish overlay - several fish pictures, group jumps, sparkles'
        },
        {
            id: 'streamframe',
            icon: '🌴',
            name: 'Animated Overlay',
            url: '/stream-frame-control.html',
            desc: 'Your synthwave overlay with neon glow, a running light, sun shimmer, sparkles, and reactions to follows, subs, bits and raids'
        },
        {
            id: 'neonchat',
            icon: '💬',
            name: 'Neon Chat',
            url: '/neon-chat-control.html',
            desc: 'Chat box in the synthwave overlay style - its own Meld layer you size and place, with emotes, role colours and event lines'
        },
        {
            id: 'turnline',
            icon: '🔁',
            name: 'Turn Line',
            url: '/turn-line-control.html',
            desc: 'Viewers sign up with !turn to take turns starting the same dish - current person green, finished red, Done button for the next'
        }
    ];
    const HUB_DEFAULT_STARTUP = ['trackers']; // what the .bat opened before the hub existed

    /** Normalize incoming hub values to the supported fields and limits. */
    function hubCleanUrl(value) {
        const url = mDomainValidation.cleanString(value).slice(0, 500);
        if (/^\/[^\s]*$/.test(url)) return url; // an ICB page like /timer-control.html
        if (/^https?:\/\/[^\s]+$/i.test(url)) return url; // any web link
        return '';
    }

    /** Restore hub state from disk and supply defaults for missing fields. */
    function loadHub() {
        const raw = mStorage.readJson(HUB_FILE, {}) || {};
        const custom = Array.isArray(raw.custom)
            ? raw.custom
                  .map((c) => ({
                      id: /^c\d+$/.test(String(c && c.id))
                          ? c.id
                          : `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
                      icon: mDomainValidation.cleanString(c && c.icon).slice(0, 8) || '🔗',
                      name: mDomainValidation.cleanString(c && c.name).slice(0, 60),
                      url: hubCleanUrl(c && c.url),
                      desc: mDomainValidation.cleanString(c && c.desc).slice(0, 120)
                  }))
                  .filter((c) => c.name && c.url)
            : [];
        const ids = new Set([...HUB_BUILTIN.map((t) => t.id), ...custom.map((c) => c.id)]);
        const order = (Array.isArray(raw.order) ? raw.order : []).filter((id) => ids.has(id));
        for (const id of ids) if (!order.includes(id)) order.push(id); // new tiles go at the end
        const startup = Array.isArray(raw.startup)
            ? raw.startup.filter((id) => ids.has(id))
            : HUB_DEFAULT_STARTUP.slice();
        return { order, startup, custom };
    }

    let hub = loadHub();

    /** Build the hub response consumed by dashboards and overlays. */
    function hubPublic() {
        const all = [
            ...HUB_BUILTIN.map((t) => ({ ...t, builtin: true })),
            ...hub.custom.map((c) => ({ ...c, builtin: false }))
        ];
        const byId = new Map(all.map((t) => [t.id, t]));
        return {
            ok: true,
            tiles: hub.order
                .map((id) => ({ ...byId.get(id), startup: hub.startup.includes(id) }))
                .filter((t) => t.id)
        };
    }

    /** Validate and dispatch hub API requests, returning client errors for invalid input. */
    async function handleHubApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/hub' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, hubPublic());

            // What the start/restart .bat files open: the hub first, then every
            // ticked page, as full URLs.
            if (pathname === '/api/hub/startup-urls' && method === 'GET') {
                const base = `http://${mConfig.HOST}:${mConfig.PORT}`;
                const pub = hubPublic().tiles;
                const urls = [`${base}/hub.html`];
                for (const t of pub)
                    if (t.startup) urls.push(t.url.startsWith('/') ? base + t.url : t.url);
                return mHttpResponse.sendJson(res, 200, { ok: true, urls });
            }

            // Save order / startup ticks / custom links (any subset).
            if (pathname === '/api/hub' && (method === 'PUT' || method === 'POST')) {
                const body = await mHttpBody.readBody(req);
                const next = { order: hub.order, startup: hub.startup, custom: hub.custom };
                if (Array.isArray(body.custom)) next.custom = body.custom;
                if (Array.isArray(body.order)) next.order = body.order.map(String);
                if (Array.isArray(body.startup)) next.startup = body.startup.map(String);
                mStorage.writeJson(HUB_FILE, next);
                hub = loadHub();
                mStorage.writeJson(HUB_FILE, hub);
                mEvents.broadcast('hub', hubPublic());
                return mHttpResponse.sendJson(res, 200, hubPublic());
            }

            return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown hub route.' });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Hub request failed.'
            });
        }
    }

    Object.assign(exports, { hubPublic, handleHubApi });
};
