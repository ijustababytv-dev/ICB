'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkInViewer, setCheckin, resetCheckins } = require('../../src/domain/signup-checkins');
const createPokeChat = require('../../src/signups/poke-chat');

/** Keep roles and manual signups in the fixture so attendance cannot silently erase them. */
function event() {
    return {
        name: 'Dinner',
        guests: [
            { n: 1, name: 'Moon Pie', twitch: 'Viewer', role: 'cook' },
            { n: 2, name: 'Manual Guest', twitch: '', role: 'guest' }
        ]
    };
}

test('chat check-in matches Twitch case-insensitively and preserves the first timestamp', () => {
    const ev = event();
    assert.equal(checkInViewer(ev, 'VIEWER', 123).changed, true);
    assert.equal(ev.guests[0].checkedIn, 123);
    const again = checkInViewer(ev, 'viewer', 456);
    assert.equal(again.changed, false);
    assert.match(again.reply, /already checked in/);
    assert.equal(ev.guests[0].checkedIn, 123);
});

test('unknown viewers and display names cannot check in someone else', () => {
    const ev = event();
    const before = structuredClone(ev);
    for (const name of ['Unknown', 'Moon Pie', 'Manual Guest', '']) {
        const result = checkInViewer(ev, name, 123);
        assert.equal(result.changed, false);
        assert.match(result.reply, /isn't signed up/);
    }
    assert.deepEqual(ev, before);
});

test('dashboard attendance supports toggle, explicit state and manual guests', () => {
    const ev = event();
    setCheckin(ev, '2', undefined, 123);
    assert.equal(ev.guests[1].checkedIn, 123);
    setCheckin(ev, 2, undefined, 456);
    assert.equal(ev.guests[1].checkedIn, null);
    setCheckin(ev, 1, true, 789);
    assert.equal(ev.guests[0].checkedIn, 789);
    setCheckin(ev, 1, false, 999);
    assert.equal(ev.guests[0].checkedIn, null);
    const before = structuredClone(ev);
    setCheckin(ev, 999, true, 111);
    assert.deepEqual(ev, before);
});

test('reset clears attendance without clearing guests, names or roles', () => {
    const ev = event();
    setCheckin(ev, 1, true, 123);
    setCheckin(ev, 2, true, 456);
    resetCheckins(ev);
    assert.deepEqual(ev, {
        ...event(),
        guests: event().guests.map((g) => ({ ...g, checkedIn: null }))
    });
    assert.doesNotThrow(() => resetCheckins({ guests: [] }));
});

test('attendance aliases work after signup closes and save only when attendance changes', () => {
    for (const command of ['!here', '!CHECKIN', '!signin']) {
        const ev = event();
        let saves = 0;
        let pops = 0;
        const { sashiChat } = createPokeChat({
            mDomainValidation: { cleanString: (s) => s.trim() },

            mParty: { partyDecode: (s) => s },

            sashi: { open: false },
            sashiEv: () => ev,

            sashiSave: () => saves++,

            sashiPop: () => pops++
        });
        const parts = [{ t: 'text', v: command }];
        assert.match(sashiChat('@Viewer', parts), /Moon Pie is here/);
        assert.match(sashiChat('viewer', parts), /already checked in/);
        assert.match(sashiChat('Stranger', parts), /isn't signed up/);
        assert.equal(saves, 1);
        assert.equal(pops, 1);
    }
});
