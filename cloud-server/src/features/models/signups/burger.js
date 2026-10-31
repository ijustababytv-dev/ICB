'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const path = require('node:path');
    const mConfig = context.config;
    const mSignupsPoke = context.use('signups/poke');
    const mDomainTimezone = require('../../../domain/timezone');
    const mDomainValidation = require('../../../domain/validation');
    const mStorage = context.storage;
    const mEvents = context.events;
    const mParty = context.use('party');
    const mSignupsCommands = context.use('signups/commands');
    const mTeams = context.use('teams');
    const mHttpResponse = context.response;
    const mHttpBody = context.body;
    const mNews = context.use('news');

    // ---------------------------------------------------------------------------
    // BEAN BURGER SIGN-UP (Baby, 2026-10-20): its own copy of the Poke Bowl Sign-up (STREAM EVENT SIGN-UP above),
    // so changing this one never touches the others. Same features; generated from that section.
    //   - Overlay: /beanburger-signup.html   - Dashboard: /beanburger-signup-control.html   - data/beanburger-signup.json
    //   - Pops up (hidden-until-asked) with !burger / !burgers / !beanburger only. Remembered in-game names are
    //     shared with the Poke Bowl Sign-up (sashi.names), so viewers only type their name once.
    // ---------------------------------------------------------------------------
    const BBSU_FILE = path.join(mConfig.DATA_DIR, 'beanburger-signup.json');
    /** Create independent initial Bean Burger signup settings for first-run or missing saved fields. */
    function bbsuDefaults() {
        return {
            visible: true,
            open: true,
            live: 'e1',
            seq: 2,
            font: mSignupsPoke.sashi.font || 26,
            cols: mSignupsPoke.sashi.cols || 2,
            title: '🍔 Bean Burger Sign-Up',
            max: 0,
            ignore: '',
            accent: mSignupsPoke.sashi.accent || '#ff8fd8',
            panelColor: mSignupsPoke.sashi.panelColor || '#1c0e28',
            panelOpacity:
                mSignupsPoke.sashi.panelOpacity === undefined
                    ? 85
                    : mSignupsPoke.sashi.panelOpacity,
            showZones: true,
            showCountdown: true,
            rseq: 1,
            onDemand: !!mSignupsPoke.sashi.onDemand,
            showSec: mSignupsPoke.sashi.showSec || 30,
            showOnSignup: mSignupsPoke.sashi.showOnSignup !== false,
            zones: mSignupsPoke.sashi.zones.map((z) => ({ ...z })),
            events: [{ id: 'e1', name: 'Bean Burgers', guests: [] }]
        };
    }

    /** Normalize saved guests and role definitions before a signup event is used. */
    function bbsuFixEvent(ev) {
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

    /** Restore Bean Burger signup state from disk and supply defaults for missing fields. */
    function bbsuLoad() {
        const raw = mStorage.readJson(BBSU_FILE, null) || {};
        const s = { ...bbsuDefaults(), ...raw };
        if (!Array.isArray(s.events) || !s.events.length) s.events = bbsuDefaults().events;
        if (!Array.isArray(s.zones) || !s.zones.length) s.zones = bbsuDefaults().zones;
        s.zones = s.zones.filter((z) => z && mDomainTimezone.etValidTz(z.tz));
        delete s.names;
        s.events.forEach(bbsuFixEvent);
        return s;
    }

    let bbsu = bbsuLoad();
    const bbsuEv = (id) => bbsu.events.find((e) => e.id === (id || bbsu.live)) || null;

    const bbsuRenumber = (ev) => {
        ev.guests.forEach((g, i) => {
            g.n = i + 1;
        });
    };

    const bbsuEpoch = (ev) =>
        ev && ev.date && ev.time ? mDomainTimezone.etToEpoch(ev.date, ev.time, ev.tz) : null;

    // "Hidden until chat asks" (2026-10-15): with bbsu.onDemand on, the overlay stays invisible until chat types
    // "!show" or "!event" (or someone signs up / leaves, if showOnSignup), then shows for showSec seconds.
    let bbsuShowUntil = 0;
    let bbsuChatHidden = false; // "!hide <word>" from chat (2026-10-20) - hidden until "!show <word>" or the dashboard's Show it now
    /** Extend the signup display window without changing its guest list. */
    function bbsuReveal(sec) {
        bbsuShowUntil = Date.now() + (sec || bbsu.showSec || 30) * 1000;
        mEvents.broadcast('beanburger-signup', bbsuPublic());
    }

    /** Build the Bean Burger signup response consumed by dashboards and overlays. */
    function bbsuPublic() {
        const ev = bbsuEv();
        return {
            ok: true,
            visible:
                bbsu.visible && !bbsuChatHidden && (!bbsu.onDemand || Date.now() < bbsuShowUntil),
            visibleSetting: bbsu.visible,
            chatHidden: bbsuChatHidden,
            onDemand: !!bbsu.onDemand,
            showSec: bbsu.showSec || 30,
            showOnSignup: bbsu.showOnSignup !== false,
            shownLeft: bbsu.onDemand
                ? Math.max(0, Math.ceil((bbsuShowUntil - Date.now()) / 1000))
                : 0,
            open: bbsu.open,
            title: bbsu.title,
            font: bbsu.font,
            cols: bbsu.cols,
            max: bbsu.max,
            accent: bbsu.accent,
            panelColor: bbsu.panelColor,
            panelOpacity: bbsu.panelOpacity,
            showZones: bbsu.showZones,
            showCountdown: bbsu.showCountdown,
            zones: bbsu.zones.filter((z) => z.on).map((z) => ({ label: z.label, tz: z.tz })),
            event: ev
                ? {
                      id: ev.id,
                      name: ev.name,
                      game: ev.game,
                      desc: ev.desc,
                      date: ev.date,
                      time: ev.time,
                      tz: ev.tz,
                      start: bbsuEpoch(ev),
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
                          role: g.role || ''
                      }))
                  }
                : null,
            total: ev ? ev.guests.length : 0,
            now: Date.now()
        };
    }

    /** Persist operator changes to the Bean Burger signup state file. */
    function bbsuSave() {
        mStorage.writeJson(BBSU_FILE, bbsu);
        mEvents.broadcast('beanburger-signup', bbsuPublic());
    }

    const bbsuPop = () => {
        if (bbsu.onDemand && bbsu.showOnSignup !== false)
            bbsuShowUntil = Math.max(bbsuShowUntil, Date.now() + (bbsu.showSec || 30) * 1000);
    };

    const bbsuCleanName = (x) =>
        mDomainValidation
            .cleanString(x)
            .replace(/^\s*\d+[.)\-:]\s+/, '')
            .replace(/[<>]/g, '')
            .trim()
            .slice(0, 40);

    const bbsuCleanCmd = (v) =>
        mDomainValidation
            .cleanString(v)
            .toLowerCase()
            .replace(/^!+/, '')
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, 24);

    /** Add unique guest names, preserve the list limit, and renumber the resulting lineup. */
    function bbsuAddNames(ev, names, role) {
        role = ev.roles.some((r) => r.id === role) ? role : '';
        for (const raw of names) {
            const name = bbsuCleanName(raw);
            if (
                !name ||
                ev.guests.some((g) => g.name.toLowerCase() === name.toLowerCase()) ||
                ev.guests.length >= 200
            )
                continue;
            ev.guests.push({ n: 0, name, twitch: '', at: Date.now(), role });
        }
        bbsuRenumber(ev);
    }

    // Every command word some other feature uses right now, so "!tomato" is never mistaken for a Palia name.
    function bbsuIgnored() {
        const set = new Set(mSignupsPoke.SASHI_BUILTIN_IGNORE);
        for (const w of String(bbsu.ignore || '').split(/[\s,]+/)) {
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
    function bbsuPartyCmds() {
        const set = new Set();
        try {
            for (const b of mParty.partyLiveBoards())
                for (const r of b.ev.roles) if (r.command) set.add(r.command);
        } catch (_e) {}
        return set;
    }

    /** Resolve remembered viewer names for this event game without mixing different games. */
    function bbsuNames(ev) {
        const k = mSignupsPoke.sashiGameKey(ev.game);
        return mSignupsPoke.sashi.names[k] || (mSignupsPoke.sashi.names[k] = {});
    }

    // Remember their in-game name for this event's game (also for names she fixes on the dashboard).
    function bbsuRemember(ev, twitch, name) {
        if (twitch && name && bbsuNames(ev)[String(twitch).toLowerCase()] !== name) {
            bbsuNames(ev)[String(twitch).toLowerCase()] = name;
            mStorage.writeJson(mSignupsPoke.SASHI_FILE, mSignupsPoke.sashi);
        }
    }

    // A Palia name typed in chat: up to 3 words / 32 characters, no @ or links.
    function bbsuChatName(v) {
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

    /** Interpret supported Bean Burger signup chat commands while preserving unrelated messages. */
    function bbsuChat(sender, parts) {
        const twitch = mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
        if (!twitch) return '';
        const text = mParty
            .partyDecode(
                (parts || [])
                    .filter((x) => x.t === 'text')
                    .map((x) => x.v)
                    .join(' ')
            )
            .trim()
            .replace(/\s+/g, ' ');
        const ev = bbsuEv();
        if (!ev) return '';
        const key = twitch.toLowerCase();
        // "!show" / "!event" pops the sign-up on screen when it's set to "hidden until chat asks".
        if (/^!(burger|burgers|beanburger)$/i.test(text)) {
            if (bbsu.onDemand && bbsu.visible) {
                bbsuReveal();
                return 'Showing the Bean Burger Sign-Up';
            }
            return '';
        }
        // "!leave" takes their own name off the list (2026-10-11). Works even when sign-ups are closed.
        // (Party Sign-ups also hears !leave - that's fine, each only removes its own entries.)
        if (/^!leave$/i.test(text)) {
            const mine = ev.guests.find((g) => g.twitch && g.twitch.toLowerCase() === key);
            if (!mine) return '';
            ev.guests = ev.guests.filter((g) => g !== mine);
            bbsuRenumber(ev);
            bbsuSave();
            return `${mine.name} left`;
        }
        const mine = ev.guests.find((g) => g.twitch && g.twitch.toLowerCase() === key);
        // ----- events WITH roles: "!<role command> [Palia name]" -----
        if (ev.roles.length) {
            const m = /^!([a-z0-9_]+)(?: (.+))?$/i.exec(text);
            if (!m) return '';
            const role = ev.roles.find((r) => r.cmd === m[1].toLowerCase());
            if (!role) return '';
            if (!bbsu.open) return `${twitch}: sign-ups are closed`;
            let name = m[2] ? bbsuChatName(m[2]) : '';
            if (m[2] && !name) return '';
            if (!name) name = (mine && mine.name) || bbsuNames(ev)[key] || twitch;
            const taken = ev.guests.find(
                (g) => g.name.toLowerCase() === name.toLowerCase() && g !== mine
            );
            if (taken) return `${name} is already signed up`;
            bbsuRemember(ev, twitch, name);
            if (mine) {
                const moved = mine.role !== role.id;
                mine.name = name;
                if (moved) {
                    mine.role = role.id;
                    mine.at = Date.now();
                    ev.guests = ev.guests.filter((g) => g !== mine).concat([mine]);
                    bbsuRenumber(ev);
                }
                bbsuPop();
                bbsuSave();
                return moved ? `${name} switched to ${role.label}` : `${name} updated`;
            }
            if (bbsu.max && ev.guests.length >= bbsu.max) return `Event is full (${bbsu.max})`;
            ev.guests.push({
                n: ev.guests.length + 1,
                name,
                twitch,
                at: Date.now(),
                role: role.id
            });
            bbsuPop();
            bbsuSave();
            const pos = ev.guests.filter((g) => g.role === role.id).length;
            return role.spots && pos > role.spots
                ? `${name} is on the ${role.label} waitlist (#${pos - role.spots})`
                : `${name} signed up for ${role.label}`;
        }
        // ----- events WITHOUT roles: "!Palia Name" (2026-10-10 / -11 rules) -----
        if (!bbsu.open) return '';
        // "!signup" alone = use the name we remember for this game (from their first sign-up).
        if (/^!signup$/i.test(text)) {
            const known = bbsuNames(ev)[key];
            if (!known) return `${twitch}: type ! + your ${ev.game} name the first time`;
            if (mine) return '';
            if (ev.guests.some((g) => g.name.toLowerCase() === known.toLowerCase()))
                return `${known} is already signed up`;
            if (bbsu.max && ev.guests.length >= bbsu.max) return `Event is full (${bbsu.max})`;
            ev.guests.push({
                n: ev.guests.length + 1,
                name: known,
                twitch,
                at: Date.now(),
                role: ''
            });
            bbsuPop();
            bbsuSave();
            return `${known} signed up (#${ev.guests.length})`;
        }
        const m = /^!([^\s!][^!]{0,31})$/.exec(text);
        if (!m) return '';
        const name = bbsuChatName(m[1]);
        if (!name) return '';
        const low = name.toLowerCase(),
            first = low.split(' ')[0];
        // The first word decides whether it's another command ("!vote 2", "!tomato Kitsuu", "!hug Bob").
        const ign = bbsuIgnored();
        if (ign.has(first) || ign.has(low) || /^(leave|party|show|here)\d*$/.test(first)) return '';
        const taken = ev.guests.find((g) => g.name.toLowerCase() === low);
        if (taken) return taken.twitch.toLowerCase() === key ? '' : `${name} is already signed up`;
        bbsuRemember(ev, twitch, name);
        if (mine) {
            mine.name = name;
            bbsuPop();
            bbsuSave();
            return `${twitch} changed their name to ${name} (#${mine.n})`;
        }
        if (bbsu.max && ev.guests.length >= bbsu.max) return `Event is full (${bbsu.max})`;
        ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: '' });
        bbsuPop();
        bbsuSave();
        return `${name} signed up (#${ev.guests.length})`;
    }

    /** Validate and dispatch Bean Burger signup API requests, returning client errors for invalid input. */

    const createBurgerApi = require('./burger-api')({
        mSignupsPoke: mSignupsPoke,

        mDomainTimezone: mDomainTimezone,

        mDomainValidation: mDomainValidation,

        mStorage: mStorage,

        mSignupsCommands: mSignupsCommands,

        mHttpResponse: mHttpResponse,

        mHttpBody: mHttpBody,

        mNews: mNews,

        bbsuFixEvent: bbsuFixEvent,

        get bbsu() {
            return bbsu;
        },

        bbsuEv: bbsuEv,

        bbsuRenumber: bbsuRenumber,

        get bbsuShowUntil() {
            return bbsuShowUntil;
        },

        set bbsuShowUntil(value) {
            bbsuShowUntil = value;
        },

        get bbsuChatHidden() {
            return bbsuChatHidden;
        },

        set bbsuChatHidden(value) {
            bbsuChatHidden = value;
        },

        bbsuPublic: bbsuPublic,

        bbsuSave: bbsuSave,

        bbsuCleanName: bbsuCleanName,

        bbsuCleanCmd: bbsuCleanCmd,

        bbsuAddNames: bbsuAddNames,

        bbsuPartyCmds: bbsuPartyCmds,

        bbsuRemember: bbsuRemember,

        bbsuChat: bbsuChat
    });
    const handleBbsuApi = createBurgerApi.handleBbsuApi;

    Object.assign(exports, { bbsuPublic, bbsuEv, bbsuChat, handleBbsuApi });

    // Accessors keep replacement state visible to routes and collaborating features.
    Object.defineProperties(exports, {
        bbsuChatHidden: {
            enumerable: true,
            get: () => bbsuChatHidden,

            set: (value) => {
                bbsuChatHidden = value;
            }
        },
        bbsu: {
            enumerable: true,
            get: () => bbsu,

            set: (value) => {
                bbsu = value;
            }
        },
        bbsuShowUntil: {
            enumerable: true,
            get: () => bbsuShowUntil,

            set: (value) => {
                bbsuShowUntil = value;
            }
        }
    });
    context.runtime.register(
        'beanburger-signup',
        () => ({ bbsuShowUntil, bbsuChatHidden }),
        (value) => {
            bbsuShowUntil = value.bbsuShowUntil;
            bbsuChatHidden = value.bbsuChatHidden;
        }
    );
};
