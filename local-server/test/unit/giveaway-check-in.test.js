'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const checkIn = require('../../../cloud-server/src/domain/check-in');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-checkin-unit-'));
process.env.ICB_CLEAN_DATA_DIR = temp;
const { createContext } = require('../../../cloud-server/src/features/context');
let giveaway;
const {
    GIVEAWAY_DEFAULTS
} = require('../../../cloud-server/src/features/models/giveaway/defaults');
beforeEach(() => {
    giveaway = createContext({ 'giveaway.json': structuredClone(GIVEAWAY_DEFAULTS) })
        .initialize()
        .use('giveaway/state');
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('first chat checks a viewer in once, case-insensitively', () => {
    const ci = checkIn.forNight(null, '2026-10-31');
    assert.equal(checkIn.isEligible(ci, 'Bob'), false);
    assert.equal(checkIn.markCheckedIn(ci, 'Bob'), true);
    assert.equal(checkIn.markCheckedIn(ci, '@bob'), false);
    assert.equal(checkIn.isEligible(ci, 'BOB'), true);
});
test('a new stream night starts with nobody here but keeps the setting', () => {
    const ci = checkIn.forNight({ required: false, night: 'a', users: { bob: true } }, 'b');
    assert.deepEqual(ci, { required: false, night: 'b', users: {} });
    assert.equal(checkIn.isEligible(ci, 'anyone'), true);
});
test('jar and pool hold only checked-in viewers, with their full saved-up count', () => {
    const saved = giveaway.ensureEntrant('Saver');
    saved.counts.chatWindows = 7;
    giveaway.recomputeEntrant(saved);
    const absent = giveaway.ensureEntrant('Absent');
    absent.counts.chatWindows = 3;
    giveaway.recomputeEntrant(absent);
    assert.deepEqual(giveaway.jarView().counts, {});
    assert.equal(giveaway.poolView().total, 0);
    assert.equal(giveaway.checkInViewer('saver'), true);
    assert.deepEqual(giveaway.jarView().counts, { Saver: 7 });
    assert.deepEqual(giveaway.poolView().counts, { Saver: 7 });
    assert.equal(giveaway.isEligible('Absent'), false);
});
test('turning check-in off puts everyone back in the pool', () => {
    const e = giveaway.ensureEntrant('Viewer');
    e.counts.chatWindows = 2;
    giveaway.recomputeEntrant(e);
    giveaway.giveaway.checkInRequired = false;
    assert.equal(giveaway.poolView().total, 2);
    assert.equal(giveaway.isEligible('Viewer'), true);
});
