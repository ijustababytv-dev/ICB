'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const {
        SASHI_BUILTIN_IGNORE,
        SASHI_RESERVED,
        SASHI_ZONE_PRESETS,
        SASHI_ZONE_DEFAULT_ON
    } = require('./poke-options');
    const path = require('node:path');
    const mConfig = context.config;
    const mDomainValidation = require('../../../domain/validation');
    const mDomainTimezone = require('../../../domain/timezone');
    const mStorage = context.storage;
    const mEvents = context.events;
    const mParty = context.use('party');
    const mSignupsCommands = context.use('signups/commands');
    const mTeams = context.use('teams');
    const mHttpResponse = context.response;
    const mHttpBody = context.body;
    const mNews = context.use('news');

    // ---------------------------------------------------------------------------
    // STREAM EVENT SIGN-UP (was "Sashimi Sign-Up"; Baby 2026-10-09 -> 2026-10-12 "like Sesh, but for stream").
    // Each saved event has: name, description, a start time (date + time in her zone) shown converted
    // into the world time zones she ticks, a live countdown, and OPTIONAL roles - each role has its
    // own chat command (e.g. "!fish Moon Pie"), an optional number of spots and a waitlist past that.
    //   - No roles on an event: chat signs up with "!" + Palia name (e.g. "!Moon Pie"), like before.
    //   - With roles: "!<role command> PaliaName" (or just "!<role command>" = remembered / Twitch name).
    //     Switching role = typing another role's command. One sign-up per Twitch account per event.
    //   - "!leave" takes their own name off (even when sign-ups are closed).
    //   - Each event has a GAME (Palia, Aniimo...). ICB remembers every viewer's in-game name per game
    //     (sashi.names[gameKey][twitch]) the first time they sign up, so next time "!<role command>"
    //     or "!signup" alone is enough.
    // She sets up roles herself on the dashboard (never pre-fill or guess roles for her).
    //   - Overlay:   /sashimi-signin.html      - Dashboard: /sashimi-signin-control.html  (names kept so Meld links still work)
    //   - Saved in data/sashimi-signin.json (several saved events, one live)
    // No isBlocked() on purpose: Baby can sign herself up too.
    // ---------------------------------------------------------------------------
    const SASHI_FILE = path.join(mConfig.DATA_DIR, 'sashimi-signin.json');

    const sashiGameKey = (g) =>
        (
            mDomainValidation
                .cleanString(g)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '') || 'palia'
        ).slice(0, 30);

    // World clocks she can tick on the dashboard (shared by all events).

    /** Create independent initial Poke Bowl signup settings for first-run or missing saved fields. */
    function sashiDefaults() {
        return {
            visible: true,
            open: true,
            live: 'e1',
            seq: 2,
            font: 26,
            cols: 2,
            title: '🍣 Sashimi Sign-Up',
            max: 0,
            ignore: '',
            accent: '#ff8fd8',
            panelColor: '#1c0e28',
            panelOpacity: 85,
            showZones: true,
            showCountdown: true,
            names: {},
            rseq: 1,
            zones: SASHI_ZONE_PRESETS.map((z) => ({
                ...z,
                on: SASHI_ZONE_DEFAULT_ON.includes(z.tz)
            })),
            events: [{ id: 'e1', name: 'Friday Sashimi', guests: [] }]
        };
    }

    /** Normalize saved guests and role definitions before a signup event is used. */
    function sashiFixEvent(ev) {
        ev.guests = Array.isArray(ev.guests) ? ev.guests : [];
        ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
        ev.desc = typeof ev.desc === 'string' ? ev.desc : '';
        ev.date = typeof ev.date === 'string' ? ev.date : '';
        ev.time = typeof ev.time === 'string' ? ev.time : '';
        ev.tz = mDomainTimezone.etValidTz(ev.tz) ? ev.tz : 'America/Chicago';
        ev.game = mDomainValidation.cleanString(ev.game).slice(0, 30) || 'Palia';
        for (const g of ev.guests)
            if (typeof g.role !== 'string' || !ev.roles.some((r) => r.id === g.role)) g.role = '';
        return ev;
    }

    /** Restore Poke Bowl signup state from disk and supply defaults for missing fields. */
    function sashiLoad() {
        const raw = mStorage.readJson(SASHI_FILE, null) || {};
        const s = { ...sashiDefaults(), ...raw };
        if (!Array.isArray(s.events) || !s.events.length) s.events = sashiDefaults().events;
        if (s.title === '🍣 Sashimi Sign-In') s.title = '🍣 Sashimi Sign-Up';
        if (!Array.isArray(s.zones) || !s.zones.length) s.zones = sashiDefaults().zones;
        s.zones = s.zones.filter((z) => z && mDomainTimezone.etValidTz(z.tz));
        s.names = s.names && typeof s.names === 'object' ? s.names : {};
        // 2026-10-12: names are kept per game. Older saves had one flat {twitch: name} list - that was Palia.
        if (Object.keys(s.names).some((k) => typeof s.names[k] === 'string')) {
            const flat = s.names;
            s.names = { palia: {} };
            for (const k of Object.keys(flat))
                if (typeof flat[k] === 'string') s.names.palia[k] = flat[k];
                else s.names[k] = flat[k];
        }
        s.events.forEach(sashiFixEvent);
        return s;
    }

    let sashi = sashiLoad();
    const sashiEv = (id) => sashi.events.find((e) => e.id === (id || sashi.live)) || null;

    const sashiRenumber = (ev) => {
        ev.guests.forEach((g, i) => {
            g.n = i + 1;
        });
    };

    const sashiEpoch = (ev) =>
        ev && ev.date && ev.time ? mDomainTimezone.etToEpoch(ev.date, ev.time, ev.tz) : null;

    // "Hidden until chat asks" (2026-10-15): with sashi.onDemand on, the overlay stays invisible until chat types
    // "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
    let sashiShowUntil = 0;
    let sashiChatHidden = false; // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
    /** Extend the signup display window without changing its guest list. */
    function sashiReveal(sec) {
        sashiShowUntil = Date.now() + (sec || sashi.showSec || 30) * 1000;
        mEvents.broadcast('sashimi', sashiPublic());
    }

    /** Build the Poke Bowl signup response consumed by dashboards and overlays. */
    function sashiPublic() {
        const ev = sashiEv();
        return {
            ok: true,
            visible:
                sashi.visible &&
                !sashiChatHidden &&
                (!sashi.onDemand || Date.now() < sashiShowUntil),
            visibleSetting: sashi.visible,
            chatHidden: sashiChatHidden,
            onDemand: !!sashi.onDemand,
            showSec: sashi.showSec || 30,
            showOnSignup: sashi.showOnSignup !== false,
            shownLeft: sashi.onDemand
                ? Math.max(0, Math.ceil((sashiShowUntil - Date.now()) / 1000))
                : 0,
            open: sashi.open,
            title: sashi.title,
            font: sashi.font,
            cols: sashi.cols,
            max: sashi.max,
            accent: sashi.accent,
            panelColor: sashi.panelColor,
            panelOpacity: sashi.panelOpacity,
            showZones: sashi.showZones,
            showCountdown: sashi.showCountdown,
            zones: sashi.zones.filter((z) => z.on).map((z) => ({ label: z.label, tz: z.tz })),
            event: ev
                ? {
                      id: ev.id,
                      name: ev.name,
                      game: ev.game,
                      desc: ev.desc,
                      date: ev.date,
                      time: ev.time,
                      tz: ev.tz,
                      start: sashiEpoch(ev),
                      roles: ev.roles.map((r) => ({
                          id: r.id,
                          label: r.label,
                          cmd: r.cmd,
                          spots: r.spots || 0,
                          color: r.color || ''
                      })),
                      guests: ev.guests.map((g) => ({
                          n: g.n,
                          name: g.name,
                          twitch: g.twitch || '',
                          at: g.at || 0,
                          role: g.role || '',
                          checkedIn: g.checkedIn || 0
                      }))
                  }
                : null,
            total: ev ? ev.guests.length : 0,
            checkedIn: ev ? ev.guests.filter((g) => g.checkedIn).length : 0,
            now: Date.now()
        };
    }

    /** Persist operator changes to the Poke Bowl signup state file. */
    function sashiSave() {
        mStorage.writeJson(SASHI_FILE, sashi);
        mEvents.broadcast('sashimi', sashiPublic());
    }

    const sashiPop = () => {
        if (sashi.onDemand && sashi.showOnSignup !== false)
            sashiShowUntil = Math.max(sashiShowUntil, Date.now() + (sashi.showSec || 30) * 1000);
    };

    const sashiCleanName = (x) =>
        mDomainValidation
            .cleanString(x)
            .replace(/^\s*\d+[.)\-:]\s+/, '')
            .replace(/[<>]/g, '')
            .trim()
            .slice(0, 40);

    const sashiCleanCmd = (v) =>
        mDomainValidation
            .cleanString(v)
            .toLowerCase()
            .replace(/^!+/, '')
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, 24);

    /** Add unique guest names, preserve the list limit, and renumber the resulting lineup. */
    function sashiAddNames(ev, names, role) {
        role = ev.roles.some((r) => r.id === role) ? role : '';
        for (const raw of names) {
            const name = sashiCleanName(raw);
            if (
                !name ||
                ev.guests.some((g) => g.name.toLowerCase() === name.toLowerCase()) ||
                ev.guests.length >= 200
            )
                continue;
            ev.guests.push({ n: 0, name, twitch: '', at: Date.now(), role });
        }
        sashiRenumber(ev);
    }

    // Every command word some other feature uses right now, so "!tomato" is never mistaken for a Palia name.
    function sashiIgnored() {
        const set = new Set(SASHI_BUILTIN_IGNORE);
        for (const w of String(sashi.ignore || '').split(/[\s,]+/)) {
            const c = w.toLowerCase().replace(/^!+/, '');
            if (c) set.add(c);
        }
        try {
            for (const b of mParty.partyLiveBoards())
                for (const r of b.ev.roles)
                    if (r.command) {
                        set.add(r.command);
                        for (let i = 1; i <= 7; i++) set.add(r.command + i);
                    }
        } catch (_e) {}
        for (const c of mSignupsCommands.signupRoleCmds()) set.add(c);
        try {
            [mTeams.teams.item.command]
                .concat(mTeams.teams.item.aliases ? mTeams.teams.item.aliases.split(/,\s*/) : [])
                .forEach((c) => {
                    if (c) set.add(String(c).toLowerCase());
                });
        } catch (_e) {}
        return set;
    }

    // Party-board role commands that are live right now (to warn her about clashes).
    function sashiPartyCmds() {
        const set = new Set();
        try {
            for (const b of mParty.partyLiveBoards())
                for (const r of b.ev.roles) if (r.command) set.add(r.command);
        } catch (_e) {}
        return set;
    }

    /** Resolve remembered viewer names for this event game without mixing different games. */
    function sashiNames(ev) {
        const k = sashiGameKey(ev.game);
        return sashi.names[k] || (sashi.names[k] = {});
    }

    // Remember their in-game name for this event's game (also for names she fixes on the dashboard).
    function sashiRemember(ev, twitch, name) {
        if (twitch && name) sashiNames(ev)[String(twitch).toLowerCase()] = name;
    }

    // A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
    function sashiChatName(v) {
        const name = String(v || '')
            .replace(/^\[|\]$/g, '')
            .replace(/[<>]/g, '')
            .trim();
        if (
            name.length < 2 ||
            name.length > 32 ||
            !/[a-z]/i.test(name) ||
            name.split(' ').length > 3 ||
            /@|https?:|www\./i.test(name)
        )
            return '';
        return name;
    }

    /** Interpret supported Poke Bowl signup chat commands while preserving unrelated messages. */

    const createPokeChat = require('./poke-chat')({
        mDomainValidation: mDomainValidation,

        mParty: mParty,

        get sashi() {
            return sashi;
        },

        sashiEv: sashiEv,

        sashiRenumber: sashiRenumber,

        sashiReveal: sashiReveal,

        sashiSave: sashiSave,

        sashiPop: sashiPop,

        sashiIgnored: sashiIgnored,

        sashiNames: sashiNames,

        sashiRemember: sashiRemember,

        sashiChatName: sashiChatName
    });
    const sashiChat = createPokeChat.sashiChat;

    /** Validate and dispatch Poke Bowl signup API requests, returning client errors for invalid input. */

    const createPokeApi = require('./poke-api')({
        get SASHI_BUILTIN_IGNORE() {
            return SASHI_BUILTIN_IGNORE;
        },

        get SASHI_RESERVED() {
            return SASHI_RESERVED;
        },

        mDomainValidation: mDomainValidation,

        mDomainTimezone: mDomainTimezone,

        mSignupsCommands: mSignupsCommands,

        mHttpResponse: mHttpResponse,

        mHttpBody: mHttpBody,

        mNews: mNews,

        sashiGameKey: sashiGameKey,

        sashiFixEvent: sashiFixEvent,

        get sashi() {
            return sashi;
        },

        sashiEv: sashiEv,

        sashiRenumber: sashiRenumber,

        get sashiShowUntil() {
            return sashiShowUntil;
        },

        set sashiShowUntil(value) {
            sashiShowUntil = value;
        },

        get sashiChatHidden() {
            return sashiChatHidden;
        },

        set sashiChatHidden(value) {
            sashiChatHidden = value;
        },

        sashiPublic: sashiPublic,

        sashiSave: sashiSave,

        sashiCleanName: sashiCleanName,

        sashiCleanCmd: sashiCleanCmd,

        sashiAddNames: sashiAddNames,

        sashiPartyCmds: sashiPartyCmds,

        sashiRemember: sashiRemember,

        sashiChat: sashiChat
    });
    const handleSashiApi = createPokeApi.handleSashiApi;

    Object.assign(exports, {
        SASHI_BUILTIN_IGNORE,
        sashiGameKey,
        SASHI_FILE,
        SASHI_RESERVED,
        sashiPublic,
        sashiEv,
        sashiChat,
        handleSashiApi
    });

    // Accessors keep replacement state visible to routes and collaborating features.
    Object.defineProperties(exports, {
        sashi: {
            enumerable: true,
            get: () => sashi,

            set: (value) => {
                sashi = value;
            }
        },
        sashiChatHidden: {
            enumerable: true,
            get: () => sashiChatHidden,

            set: (value) => {
                sashiChatHidden = value;
            }
        },
        sashiShowUntil: {
            enumerable: true,
            get: () => sashiShowUntil,

            set: (value) => {
                sashiShowUntil = value;
            }
        }
    });
    context.runtime.register(
        'sashimi-signin',
        () => ({ sashiShowUntil, sashiChatHidden }),
        (value) => {
            sashiShowUntil = value.sashiShowUntil;
            sashiChatHidden = value.sashiChatHidden;
        }
    );
};
