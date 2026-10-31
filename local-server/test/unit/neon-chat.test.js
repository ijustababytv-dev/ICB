'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chatRules = require('../../src/domain/neon-chat');

const root = path.resolve(__dirname, '../../..');
const text = (v) => [{ t: 'text', v }];

/** Fresh settings for each test so rules cannot leak between cases. */
function state() {
    return chatRules.neonChatDefaults();
}

test('defaults hide commands, show every event line, and are independent copies', () => {
    const a = state();
    const b = state();
    a.events.raid = false;
    a.hideNames.push('bot');
    assert.equal(b.events.raid, true);
    assert.deepEqual(b.hideNames, []);
    assert.equal(b.hideCommands, true);
    assert.equal(b.streamerName, 'IJustABabyTv');
});

test('settings clamp numbers, clean names and colours, and ignore bad values', () => {
    const s = chatRules.applySettings(state(), {
        textSize: 200,
        maxMessages: 0,
        fadeSec: 7,
        nameFont: 'comic',
        title: '  NEON CHAT  ',
        hideNames: '@StreamElements, nightbot nightbot',
        roleColors: { mod: 'blue', vip: '#00FF00', viewer: '' },
        events: { follow: false, chat: true }
    });
    assert.deepEqual([s.textSize, s.maxMessages, s.fadeSec], [48, 1, 5]);
    assert.equal(s.nameFont, 'script');
    assert.equal(s.title, 'NEON CHAT');
    assert.deepEqual(s.hideNames, ['streamelements', 'nightbot']);
    assert.deepEqual(
        [s.roleColors.mod, s.roleColors.vip, s.roleColors.viewer],
        ['#7af3ff', '#00FF00', '']
    );
    assert.equal(s.events.follow, false);
    assert.equal(s.events.chat, undefined);
});

test('background colour and strength: hex only, strength 0 to 100', () => {
    const s = state();
    assert.deepEqual([s.bgColor, s.bgOpacity], ['#24063a', 88]);
    chatRules.applySettings(s, { bgColor: 'pink', bgOpacity: -5 });
    assert.deepEqual([s.bgColor, s.bgOpacity], ['#24063a', 0]);
    chatRules.applySettings(s, { bgColor: '#000000', bgOpacity: 140 });
    assert.deepEqual([s.bgColor, s.bgOpacity], ['#000000', 100]);
});

test('roles come from badges, and the streamer is also known by name', () => {
    assert.equal(chatRules.chatterRole('IJUSTABABYTV', {}, 'IJustABabyTv'), 'streamer');
    assert.equal(chatRules.chatterRole('x', { badges: ['broadcaster'] }, 'me'), 'streamer');
    assert.equal(chatRules.chatterRole('x', { badges: ['Moderator'] }, 'me'), 'mod');
    assert.equal(chatRules.chatterRole('x', { badges: ['vip', 'subscriber'] }, 'me'), 'vip');
    assert.equal(chatRules.chatterRole('x', { badges: ['founder'] }, 'me'), 'sub');
    assert.equal(chatRules.chatterRole('x', { badges: 'oops' }, 'me'), 'viewer');
});

test('name colours: role colour first, then Twitch colour if allowed, then a stable neon pick', () => {
    const s = state();
    assert.equal(chatRules.nameColor(s, 'Mod1', 'mod', { color: '#123456' }), '#7af3ff');
    assert.equal(
        chatRules.nameColor(s, 'Pal', 'viewer', { color: '#123456' }),
        chatRules.paletteColor('pal')
    );
    s.useTwitchColors = true;
    assert.equal(chatRules.nameColor(s, 'Pal', 'viewer', { color: '#123456' }), '#123456');
    assert.equal(chatRules.paletteColor('moon'), chatRules.paletteColor('moon'));
});

test('chat lines hide bots, commands, /me lines when asked, and empty messages', () => {
    const s = state();
    s.hideNames = ['nightbot'];
    assert.equal(chatRules.chatLine(s, 'Nightbot', text('hi')), null);
    assert.equal(chatRules.chatLine(s, 'Viewer', text('!lurk')), null);
    assert.equal(chatRules.chatLine(s, 'Viewer', text('   ')), null);
    assert.ok(chatRules.chatLine(s, 'Viewer', text('ads soon'), { action: true }));
    s.hideMe = true;
    assert.equal(chatRules.chatLine(s, 'Viewer', text('ads soon'), { action: true }), null);
    s.hideCommands = false;
    assert.equal(chatRules.chatLine(s, 'Viewer', text('!lurk')).parts[0].v, '!lurk');
});

test('chat lines keep safe emotes only and carry role and colour', () => {
    const s = state();
    const line = chatRules.chatLine(
        s,
        '@Vox',
        [
            { t: 'text', v: 'nice ' },
            { t: 'emote', url: 'https://static-cdn.jtvnw.net/e/25', name: 'Kappa' },
            { t: 'emote', url: 'javascript:alert(1)', name: 'bad' }
        ],
        { badges: ['subscriber'] },
        42
    );
    assert.equal(line.name, 'Vox');
    assert.equal(line.role, 'sub');
    assert.equal(line.color, '#c99bff');
    assert.equal(line.at, 42);
    assert.deepEqual(
        line.parts.map((p) => p.t),
        ['text', 'emote']
    );
});

test('event lines read naturally and respect their switches', () => {
    const s = state();
    assert.equal(chatRules.eventLine(s, 'gifts', 'Moon', { count: 1 }).text, 'Moon gifted 1 sub!');
    assert.equal(chatRules.eventLine(s, 'gifts', 'Moon', { count: 5 }).text, 'Moon gifted 5 subs!');
    assert.equal(
        chatRules.eventLine(s, 'sub', 'Moon', { months: 6 }).text,
        'Moon subscribed for 6 months!'
    );
    assert.equal(
        chatRules.eventLine(s, 'raid', '', { viewers: 'x' }).text,
        'Someone is raiding with 0 viewers!'
    );
    assert.equal(chatRules.eventLine(s, 'chat', 'Moon'), null);
    s.events.bits = false;
    assert.equal(chatRules.eventLine(s, 'bits', 'Moon', { amount: 100 }), null);
});

test('the kept list numbers every line and keeps the latest sixty', () => {
    const store = { seq: 0, lines: [] };
    assert.equal(chatRules.pushLine(store, null), 0);
    for (let i = 0; i < 70; i++) chatRules.pushLine(store, { kind: 'chat', at: i });
    assert.equal(store.lines.length, 60);
    assert.equal(store.lines[59].n, 70);
    assert.equal(store.lines[0].n, 11);
});

test('the Meld chat overlay stays plain ES5 and polls without EventSource', () => {
    const code = fs
        .readFileSync(path.join(root, 'ui', 'js', 'neon-chat.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    // A class declaration (not the word class inside HTML strings like class="badge").
    assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|`|\bclass\s+[A-Za-z_$]/);
    assert.doesNotMatch(code, /EventSource/);
});
