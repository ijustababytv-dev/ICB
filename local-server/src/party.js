'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const mConfig = require('./config');
const mDomainValidation = require('./domain/validation');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mTradeup = require('./tradeup');

// ---------------------------------------------------------------------------
// PARTY SIGN-UPS (Baby, 2026-10-06) - chat signs up for overprep roles at
// her Palia parties: "!tomato BabyPalia" puts their Palia name in the Tomato
// role. Roles only (no plain join). One sign-up per person: a different role
// command swaps them, "!leave" drops them. Each role has a spot limit she sets;
// once full, extra people go on that role's waitlist and move up when a spot
// opens. Several events can be saved; ONE is live (chat + overlay use it).
//   - Overlay:   /party.html      - Dashboard: /party-control.html
//   - Saved in data/parties.json
// ---------------------------------------------------------------------------
const PARTY_FILE = path.join(mConfig.DATA_DIR, 'parties.json');
/** Normalize a role command into the supported lowercase chat-command alphabet. */
function partyCmd(v) {
    return mDomainValidation
        .cleanString(v)
        .toLowerCase()
        .replace(/^!+/, '')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 24);
}

const PARTY_RESERVED = new Set([
    'leave',
    'team',
    'vote',
    'unvote',
    'here',
    'checkin',
    'signin',
    'party',
    'show',
    'hide'
]);
const PARTY_CHECKIN_CMDS = new Set(['here', 'checkin', 'signin']);
/** Create an independent party record with its initial settings. */
function partyNewEvent(seq) {
    return {
        id: `e${seq}`,
        title: 'Overprep Party',
        when: '',
        subtitle: '',
        open: true,
        roles: [
            {
                id: 'r1',
                command: 'tomato',
                label: 'Tomato',
                emoji: '🍅',
                spots: 2,
                group: 'Overprep',
                bring: ''
            },
            {
                id: 'r2',
                command: 'rice',
                label: 'Rice',
                emoji: '🍚',
                spots: 2,
                group: 'Overprep',
                bring: ''
            }
        ],
        signups: [],
        rseq: 3
    };
}

/** Normalize incoming party values to the supported fields and limits. */
function partyCleanRole(r, ev) {
    const id = r && /^r\d{1,5}$/.test(String(r.id || '')) ? String(r.id) : `r${ev.rseq++}`;
    return {
        id,
        command: partyCmd(r && r.command),
        label: mDomainValidation.cleanString(r && r.label).slice(0, 40),
        emoji: mDomainValidation.cleanString(r && r.emoji).slice(0, 8),
        spots: Math.max(1, Math.min(50, Math.round(Number(r && r.spots)) || 1)),
        // 2026-10-07: any kind of role, grouped into sections on the board (Overprep, Cooking,
        // Helpers...), plus what that role must bring - shown on stream under the role.
        group: mDomainValidation.cleanString(r && r.group).slice(0, 30),
        bring: mDomainValidation.cleanString(r && r.bring).slice(0, 200)
    };
}

/** Restore party state from disk and supply defaults for missing fields. */
function partyLoad() {
    const raw = mStorage.readJson(PARTY_FILE, null);
    if (!raw || !Array.isArray(raw.events) || !raw.events.length) {
        return {
            seq: 2,
            liveId: 'e1',
            visible: true,
            showTwitch: false,
            names: {},
            events: [partyNewEvent(1)],
            slots: ['e1', null, null, null, null, null, null]
        };
    }
    raw.names = raw.names && typeof raw.names === 'object' ? raw.names : {};
    for (const ev of raw.events) {
        ev.signups = Array.isArray(ev.signups) ? ev.signups : [];
        ev.roles = Array.isArray(ev.roles) ? ev.roles : [];
        ev.rseq = ev.rseq || 100;
    }
    if (!raw.events.some((e) => e.id === raw.liveId)) raw.liveId = raw.events[0].id;
    // 2026-10-07: up to 7 boards live at once. slots[i] = event id shown on Board i+1 (null = empty).
    // Older saves had one liveId - it becomes Board 1.
    const ids = new Set(raw.events.map((e) => e.id));
    raw.slots = Array.isArray(raw.slots)
        ? raw.slots.slice(0, PARTY_SLOTS).map((x) => (x && ids.has(x) ? x : null))
        : [raw.liveId];
    while (raw.slots.length < PARTY_SLOTS) raw.slots.push(null);
    return { visible: true, showTwitch: false, seq: 100, ...raw };
}

const PARTY_SLOTS = 7;
// Her own art per party (2026-10-07): pictures live in assets/party/ (upload on the dashboard or drop files in).
const PARTY_ART_DIR = path.join(mConfig.APP_DIR, 'assets', 'party');
try {
    fs.mkdirSync(PARTY_ART_DIR, { recursive: true });
} catch (_error) {}
const partyArtUrl = (f) => (f ? `/assets/party/${encodeURIComponent(f)}` : null);

/** Locate supported local party artwork while tolerating missing files. */
function partyArtFile(v) {
    const f = v ? path.basename(String(v)) : null;
    return f &&
        mDomainValidation.DECOR_IMAGE_EXT.test(f) &&
        fs.existsSync(path.join(PARTY_ART_DIR, f))
        ? f
        : null;
}

let parties = partyLoad();
// One-time import (2026-10-07): if data/party-seed.json exists, its events are ADDED (existing events
// and sign-ups are never touched) and put on the boards it names, then the file is renamed so it
// never imports twice. Lets Claude set up Baby's weekly parties while ICB is running.
(function partyImportSeed() {
    const file = path.join(mConfig.DATA_DIR, 'party-seed.json');
    if (!fs.existsSync(file)) return;
    try {
        const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const se of (Array.isArray(seed.events) ? seed.events : []).slice(0, 20)) {
            const ev = partyNewEvent(parties.seq++);
            ev.title = mDomainValidation.cleanString(se.title).slice(0, 80) || ev.title;
            ev.when = mDomainValidation.cleanString(se.when).slice(0, 80);
            ev.subtitle = mDomainValidation.cleanString(se.subtitle).slice(0, 140);
            ev.open = se.open !== false;
            ev.roles = (Array.isArray(se.roles) ? se.roles : [])
                .slice(0, 20)
                .map((r) => partyCleanRole({ ...r, id: undefined }, ev))
                .filter((r) => r.command && !PARTY_RESERVED.has(r.command));
            for (const r of ev.roles) if (!r.label) r.label = r.command;
            parties.events.push(ev);
            const n = Math.round(Number(se.board));
            if (n >= 1 && n <= PARTY_SLOTS && !(se.boardIfEmpty && parties.slots[n - 1])) {
                parties.slots = parties.slots.map((x) => (x === ev.id ? null : x));
                parties.slots[n - 1] = ev.id;
            }
        }
        mStorage.writeJson(PARTY_FILE, parties);
        fs.renameSync(file, path.join(mConfig.DATA_DIR, `party-seed.imported-${Date.now()}.json`));
        console.log('[party] imported party-seed.json');
    } catch (error) {
        console.log('[party] party-seed.json not imported:', error.message);
    }
})();
// Board 1's event (kept for older callers) and every live board.
function partyLive() {
    return (
        parties.events.find((e) => e.id === parties.slots[0]) ||
        parties.events.find((e) => e.id === parties.liveId) ||
        parties.events[0]
    );
}

/** Resolve the configured live board slots while ignoring missing saved events. */
function partyLiveBoards() {
    const out = [];
    parties.slots.forEach((id, i) => {
        const ev = id && parties.events.find((e) => e.id === id);
        if (ev && !out.some((o) => o.ev === ev)) out.push({ slot: i + 1, ev });
    });
    return out;
}

// How many live boards use each role command - shared ones get the board number added (e.g. !tomato3).
function partySharedCmds() {
    const count = {};
    // Only boards with sign-ups OPEN compete for a command, so closed nights don't force numbers.
    for (const { ev } of partyLiveBoards())
        if (ev.open)
            for (const c of new Set(ev.roles.map((r) => r.command).filter(Boolean)))
                count[c] = (count[c] || 0) + 1;
    return count;
}

// SPOTLIGHT board (2026-10-07): one extra Meld layer (/party.html?board=spot) that rotates through
// every live board; a viewer can type "!party 3" to pull Board 3 up for spotHoldSec so they can sign up.
let partySpot = { slot: null, until: 0, by: '' };
/** Temporarily spotlight the requested party slot for an overlay viewer. */
function partySpotRequest(n, by) {
    if (!(n >= 1 && n <= PARTY_SLOTS) || !parties.slots[n - 1]) return false;
    partySpot = { slot: n, until: Date.now() + (parties.spotHoldSec || 60) * 1000, by: by || '' };
    return true;
}

/** Return the spotlight slot only while its requested display window remains active. */
function partySpotSlot() {
    const live = partyLiveBoards().map((b) => b.slot);
    if (!live.length) return null;
    if (partySpot.slot && Date.now() < partySpot.until && live.includes(partySpot.slot))
        return partySpot.slot;
    const step = Math.max(5, parties.spotRotateSec || 20) * 1000;
    return live[Math.floor(Date.now() / step) % live.length];
}

/** Describe the current spotlight for dashboards and overlays. */
function partySpotInfo() {
    const held = partySpot.slot && Date.now() < partySpot.until;
    return {
        slot: partySpotSlot(),
        held: !!held,
        by: held ? partySpot.by : '',
        leftSec: held ? Math.ceil((partySpot.until - Date.now()) / 1000) : 0,
        rotateSec: parties.spotRotateSec || 20,
        holdSec: parties.spotHoldSec || 60,
        chat: parties.spotChat !== false,
        boards: partyLiveBoards().map((b) => ({ slot: b.slot, title: b.ev.title }))
    };
}

// "Hidden until chat asks" (2026-10-15): with parties.onDemand on, boards stay invisible until chat types
// "!show" / "!party" (all live boards) or "!show 3" / "!party 3" (Board 3), or someone signs up (showOnSignup).
const partyShowUntil = {}; // slot -> ms ; 'all' -> ms
let partyChatHidden = false; // "!hide cake" from chat (2026-10-20)
/** Extend the requested party display window without changing guest assignments. */
function partyReveal(n, sec) {
    const until = Date.now() + (sec || parties.showSec || 30) * 1000;
    if (n === 'all') partyShowUntil.all = until;
    else if (n >= 1 && n <= PARTY_SLOTS) partyShowUntil[n] = until;
    mEvents.broadcast('party', partyPublic());
}

/** Apply on-demand visibility and temporary reveal windows to a board slot. */
function partyShown(n) {
    if (!parties.visible || partyChatHidden) return false;
    if (!parties.onDemand) return true;
    const now = Date.now();
    if (n === 'spot')
        return now < (partyShowUntil.all || 0) || !!(partySpot.slot && now < partySpot.until);
    return now < (partyShowUntil.all || 0) || now < (partyShowUntil[n] || 0);
}

/** Find the visible slot assigned to a saved event. */
function partySlotOf(evId) {
    const i = parties.slots.indexOf(evId);
    return i >= 0 ? i + 1 : null;
}

// Who is in a role vs waiting: first `spots` sign-ups (by time) are in.
function partyView(ev) {
    const roles = ev.roles.map((r) => {
        const list = ev.signups.filter((s) => s.role === r.id).sort((a, b) => a.at - b.at);
        const pv = (s) => ({ twitch: s.twitch, palia: s.palia, in: !!s.checkedIn });

        return {
            ...r,
            collapsed: !!(ev.collapsed && ev.collapsed[r.id]),
            people: list.slice(0, r.spots).map(pv),
            waitlist: list.slice(r.spots).map(pv)
        };
    });
    const filled = roles.reduce((a, r) => a + r.people.length, 0);
    const spots = roles.reduce((a, r) => a + r.spots, 0);
    const checkedIn = ev.signups.filter((s) => s.checkedIn).length;
    // The exact command chat should type on this board (board number added when another live board shares it).
    const slot = partySlotOf(ev.id),
        shared = partySharedCmds();
    for (const r of roles)
        r.cmdShown = slot && ev.open && shared[r.command] > 1 ? r.command + slot : r.command;
    return {
        id: ev.id,
        title: ev.title,
        when: ev.when,
        subtitle: ev.subtitle,
        open: ev.open,
        roles,
        filled,
        spots,
        checkedIn,
        startAt: Number(ev.startAt) || null,
        warnMin: Number(ev.warnMin) || 10,
        slot,
        art: {
            bg: partyArtUrl(ev.bgImage),
            title: partyArtUrl(ev.titleImage),
            fit: ev.bgFit === 'contain' ? 'contain' : 'cover',
            panel: ev.panel === undefined ? 86 : Number(ev.panel),
            roleCards: ev.roleCards === undefined ? 40 : Number(ev.roleCards),
            border: ev.border !== false,
            bgFile: ev.bgImage || null,
            titleFile: ev.titleImage || null
        }
    };
}

/** Build the party response consumed by dashboards and overlays. */
function partyPublic(slot) {
    const n = Math.max(1, Math.min(PARTY_SLOTS, Number(slot) || 1));
    const id = parties.slots[n - 1],
        ev = id && parties.events.find((e) => e.id === id);
    return {
        ok: true,
        visible: partyShown(n),
        visibleSetting: parties.visible,
        chatHidden: partyChatHidden,
        onDemand: !!parties.onDemand,
        showTwitch: parties.showTwitch,
        board: n,
        empty: !ev,
        event: ev ? partyView(ev) : null,
        now: Date.now()
    };
}

/** Persist operator changes to the party state file. */
function partySave() {
    mStorage.writeJson(PARTY_FILE, parties);
    mEvents.broadcast('party', partyPublic());
}

// Meld sends chat text HTML-encoded (an apostrophe arrives as &#39;) - turn it back into plain text.
function partyDecode(t) {
    return String(t || '')
        .replace(/&#(\d{1,6});/g, (_m, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
        .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n) =>
            String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16)))
        )
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Interpret supported party chat commands while preserving unrelated messages. */

const createPartyChat = require('./party-chat')({
    mDomainValidation: mDomainValidation,

    PARTY_CHECKIN_CMDS: PARTY_CHECKIN_CMDS,

    get parties() {
        return parties;
    },

    partyLiveBoards: partyLiveBoards,

    partySpotRequest: partySpotRequest,

    partyReveal: partyReveal,

    partySlotOf: partySlotOf,

    partySave: partySave,

    partyDecode: partyDecode
});
const partyChat = createPartyChat.partyChat;

/** Validate and dispatch party API requests, returning client errors for invalid input. */

const createPartyApi = require('./party-api')({
    fs: fs,

    path: path,

    get URL() {
        return URL;
    },

    mDomainValidation: mDomainValidation,

    mHttpResponse: mHttpResponse,

    mHttpBody: mHttpBody,

    mTradeup: mTradeup,

    PARTY_RESERVED: PARTY_RESERVED,

    partyNewEvent: partyNewEvent,

    partyCleanRole: partyCleanRole,

    PARTY_SLOTS: PARTY_SLOTS,

    PARTY_ART_DIR: PARTY_ART_DIR,

    partyArtFile: partyArtFile,

    get parties() {
        return parties;
    },

    get partySpot() {
        return partySpot;
    },

    partySpotRequest: partySpotRequest,

    partySpotSlot: partySpotSlot,

    partySpotInfo: partySpotInfo,

    partyShowUntil: partyShowUntil,

    get partyChatHidden() {
        return partyChatHidden;
    },

    set partyChatHidden(value) {
        partyChatHidden = value;
    },

    partyReveal: partyReveal,

    partyShown: partyShown,

    partySlotOf: partySlotOf,

    partyView: partyView,

    partyPublic: partyPublic,

    partySave: partySave,

    partyChat: partyChat
});
const handlePartyApi = createPartyApi.handlePartyApi;

Object.assign(exports, {
    partyLiveBoards,
    partyDecode,
    partyReveal,
    partyPublic,
    partyShowUntil,
    partyChat,
    handlePartyApi
});

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    partyChatHidden: {
        enumerable: true,
        get: () => partyChatHidden,

        set: (value) => {
            partyChatHidden = value;
        }
    },
    parties: {
        enumerable: true,
        get: () => parties,

        set: (value) => {
            parties = value;
        }
    },
    partySpot: {
        enumerable: true,
        get: () => partySpot,

        set: (value) => {
            partySpot = value;
        }
    }
});
