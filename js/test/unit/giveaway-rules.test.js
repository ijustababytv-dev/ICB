'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Feature storage is isolated before importing it. Importing a feature starts no timers or server.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-giveaway-unit-'));
process.env.ICB_CLEAN_DATA_DIR = temp;
const giveaway = require('../../server/giveaway/state');
const { GIVEAWAY_DEFAULTS } = require('../../server/giveaway/defaults');
beforeEach(() => {
    giveaway.giveaway = structuredClone(GIVEAWAY_DEFAULTS);
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('case-insensitive chat and dashboard names share one entrant', () => {
    const a = giveaway.ensureEntrant('Baby');
    assert.equal(giveaway.ensureEntrant('baby'), a);
    assert.equal(giveaway.findEntrantKey('BABY'), 'Baby');
    assert.equal(Object.keys(giveaway.giveaway.entrants).length, 1);
});
test('earned tickets use current rates, floor partial bits, and clamp manual deductions', () => {
    const entrant = giveaway.ensureEntrant('Viewer');
    entrant.counts = { chatWindows: 2, subMonths: 3, giftedSubs: 2, bits: 299 };
    entrant.manualTickets = -100;
    giveaway.recomputeEntrant(entrant);
    assert.deepEqual(
        [entrant.chatTickets, entrant.subTickets, entrant.giftTickets, entrant.bitsTickets],
        [2, 6, 8, 2]
    );
    assert.equal(entrant.manualTickets, -18);
    assert.equal(giveaway.entrantTotal(entrant), 0);
});
test('rate changes reprice earned counts while retaining valid manual credits', () => {
    const entrant = giveaway.ensureEntrant('Viewer');
    entrant.counts.subMonths = 2;
    entrant.manualTickets = 3;
    giveaway.giveaway.rates.subMonth = 5;
    giveaway.recomputeEntrant(entrant);
    assert.equal(giveaway.entrantTotal(entrant), 13);
});
test('blocked names are removed from entrants and the active chat window', () => {
    giveaway.ensureEntrant('Bot');
    giveaway.ensureEntrant('Viewer');
    giveaway.giveaway.chatActiveThisWindow = { Bot: true, Viewer: true };
    giveaway.giveaway.blocked = ['bot'];
    assert.equal(giveaway.isBlocked('@BOT'), true);
    assert.deepEqual(giveaway.purgeBlocked(), ['Bot']);
    assert.deepEqual(Object.keys(giveaway.giveaway.entrants), ['Viewer']);
    assert.deepEqual(giveaway.giveaway.chatActiveThisWindow, { Viewer: true });
});
test('chat earns one ticket per active window, not per message; blocked users earn none', () => {
    giveaway.ensureEntrant('Viewer');
    giveaway.ensureEntrant('Bot');
    giveaway.giveaway.blocked = ['bot'];
    giveaway.giveaway.chatActiveThisWindow = { Viewer: true, Bot: true };
    giveaway.awardChatWindow();
    assert.equal(giveaway.giveaway.entrants.Viewer.counts.chatWindows, 1);
    assert.equal(giveaway.giveaway.entrants.Bot.counts.chatWindows, 0);
    assert.deepEqual(giveaway.giveaway.chatActiveThisWindow, {});
    giveaway.awardChatWindow();
    assert.equal(giveaway.giveaway.entrants.Viewer.counts.chatWindows, 1);
});
test('emptying the display jar preserves ticket totals and only shows subsequent additions', () => {
    const entrant = giveaway.ensureEntrant('Viewer');
    entrant.counts.subMonths = 3;
    giveaway.recomputeEntrant(entrant);
    giveaway.snapshotJar();
    assert.equal(giveaway.jarView().total, 0);
    assert.equal(giveaway.entrantTotal(entrant), 6);
    entrant.counts.subMonths += 1;
    giveaway.recomputeEntrant(entrant);
    assert.equal(giveaway.jarView().total, 2);
});
test('repricing a jar baseline cannot manufacture newly earned tickets', () => {
    const entrant = giveaway.ensureEntrant('Viewer');
    entrant.counts.subMonths = 3;
    giveaway.recomputeEntrant(entrant);
    giveaway.snapshotJar();
    giveaway.giveaway.rates.subMonth = 7;
    giveaway.recomputeEntrant(entrant);
    assert.equal(giveaway.jarView().total, 0);
});
test('rate validation truncates, bounds, and falls back for non-finite inputs', () => {
    assert.equal(giveaway.cleanRate(2.9, 1, 0, 100), 2);
    assert.equal(giveaway.cleanRate(-5, 1, 0, 100), 0);
    assert.equal(giveaway.cleanRate(500, 1, 0, 100), 100);
    assert.equal(giveaway.cleanRate('bad', 1, 0, 100), 1);
});
