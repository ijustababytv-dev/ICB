'use strict';

const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mDomainNeonChat = require('./domain/neon-chat');

// ---------------------------------------------------------------------------
// NEON CHAT (Baby, 2026-10-25) - a chat box in her synthwave overlay style, as its own Meld
// layer she sizes and places herself. Messages come from the Meld listener's chat relay
// (/api/activity/raw, text + emotes); follows, subs, gifts, bits and raids can show as
// highlighted lines. Rules in domain/neon-chat.js.
//   - Overlay:   /neon-chat.html (ES5, polls /api/neonchat every 2 s)
//   - Dashboard: /neon-chat-control.html
//   - Settings in data/neonchat.json; chat lines are kept in memory only (last 60).
// ---------------------------------------------------------------------------
const feed = require('./cloud/state-feed');

/** Restore saved settings, filling in anything new with its default. */
function chatLoad() {
    const raw = feed.document('neonchat.json') || {};
    const d = mDomainNeonChat.neonChatDefaults();
    return {
        ...d,
        ...raw,
        roleColors: { ...d.roleColors, ...(raw.roleColors || {}) },
        events: { ...d.events, ...(raw.events || {}) },
        hideNames: Array.isArray(raw.hideNames) ? raw.hideNames : d.hideNames
    };
}

let chat = chatLoad();
const store = { seq: 0, lines: [], clearedAt: 0 };
let testCount = 0;
let visualOwner = null;
/** Account changes clear transient text; ordinary words never enter a persistence API. */
function refreshVisuals() {
    const owner = require('./cloud/session').current()?.account.id || null;
    if (owner !== visualOwner) {
        store.lines = [];
        store.clearedAt = store.seq;
        visualOwner = owner;
    }
    chat = chatLoad();
}

const TEST_LINES = [
    ['streamer', 'Welcome to the neon beach! 🌴'],
    ['mod', 'Remember to be kind in chat 💜'],
    ['vip', 'This overlay is so pretty ✨'],
    ['sub', 'Hype! Let’s gooo'],
    ['viewer', 'Hi from the sunset side of the island 🌅']
];

/** Build the response the overlay and dashboard read. `since` skips lines already shown. */
function chatPublic(since) {
    refreshVisuals();
    const after = Number(since) || 0;
    return {
        ok: true,
        ...chat,
        seq: store.seq,
        clearedAt: store.clearedAt,
        now: Date.now(),
        lines: store.lines.filter((l) => l.n > after)
    };
}

/**
 * Called for every chat message the Meld listener relays. `data` is the relayed message
 * (sender name, attributes, optional senderInfo with badges/colour), `parts` its text and
 * emote pieces. Never throws, so the chat box can never break other chat features.
 */
function neonChatRelay(data, parts) {
    refreshVisuals();
    try {
        const info = data.senderInfo && typeof data.senderInfo === 'object' ? data.senderInfo : {};
        const attrs = Array.isArray(data.attributes) ? data.attributes : [];
        mDomainNeonChat.pushLine(
            store,
            mDomainNeonChat.chatLine(chat, data.sender, parts, {
                badges: info.badges,
                color: info.color,
                action: attrs.indexOf('RP_ACTION') >= 0
            })
        );
    } catch (_error) {
        // Display only.
    }
}

/** Called for follows, subs, gifted subs, bits and raids; adds a highlighted line if switched on. */
function neonChatEvent(type, username, body) {
    refreshVisuals();
    try {
        mDomainNeonChat.pushLine(store, mDomainNeonChat.eventLine(chat, type, username, body));
    } catch (_error) {
        // Display only.
    }
}

/** Dashboard buttons: a sample chat line (cycling through roles), a sample event, or clear. */
function dashboardActions(body) {
    if (body.testMessage) {
        const [role, text] = TEST_LINES[testCount++ % TEST_LINES.length];
        const name =
            role === 'streamer'
                ? chat.streamerName
                : `Test${role[0].toUpperCase()}${role.slice(1)}`;
        const badges =
            role === 'viewer' || role === 'streamer'
                ? []
                : [role === 'mod' ? 'moderator' : role === 'sub' ? 'subscriber' : 'vip'];
        mDomainNeonChat.pushLine(
            store,
            mDomainNeonChat.chatLine(chat, name, [{ t: 'text', v: text }], { badges })
        );
    }
    if (mDomainNeonChat.EVENT_TYPES.includes(body.testEvent)) {
        const sample = { months: 6, count: 5, amount: 500, viewers: 25 };
        mDomainNeonChat.pushLine(
            store,
            mDomainNeonChat.eventLine(
                { ...chat, events: { [body.testEvent]: true } },
                body.testEvent,
                'TestFriend',
                sample
            )
        );
    }
    if (body.clear) {
        store.lines = [];
        store.clearedAt = store.seq;
    }
}

/** Handle GET/POST /api/neonchat. */
async function handleNeonChatApi(req, res, pathname, method, url) {
    try {
        if (pathname === '/api/neonchat' && method === 'GET')
            return mHttpResponse.sendJson(
                res,
                200,
                chatPublic(url && url.searchParams.get('since'))
            );
        if (pathname === '/api/neonchat' && method === 'POST') {
            const body = await mHttpBody.readBody(req);
            const settings = Object.fromEntries(
                Object.entries(body).filter(
                    ([key]) => !['testMessage', 'testEvent', 'clear'].includes(key)
                )
            );
            if (Object.keys(settings).length)
                await require('./cloud/features').command(
                    'neonchat',
                    {
                        path: '/api/neonchat',
                        method: 'POST',
                        values: settings
                    },
                    'request',
                    require('./cloud/browser-revisions').expectedRevision(req, 'neonchat')
                );
            refreshVisuals();
            dashboardActions(body);
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown neon chat route.' });
    } catch (error) {
        return mHttpResponse.sendJson(res, 400, {
            ok: false,
            error: error.message || 'Neon chat request failed.'
        });
    }
}

Object.assign(exports, { handleNeonChatApi, chatPublic, neonChatRelay, neonChatEvent });
