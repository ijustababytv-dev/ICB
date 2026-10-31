'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paliaHours, pcUntil, pcCleanAlarm } = require('../../src/domain/palia-time');
const { etToEpoch, etValidTz } = require('../../src/domain/timezone');

test('Palia time advances 24 game hours per real hour and wraps at midnight', () => {
    assert.equal(paliaHours(Date.parse('2026-10-22T12:15:00Z')), 6);
    assert.equal(paliaHours(Date.parse('2026-10-22T12:00:00Z')), 0);
    assert.equal(paliaHours(Date.parse('2026-10-22T12:30:00Z')), 12);
    assert.equal(paliaHours(Date.parse('2026-10-22T13:15:00Z')), 6);
});
test('Palia alarms choose the next occurrence, including exact-time and midnight boundaries', () => {
    const now = Date.parse('2026-10-22T12:15:00Z');
    assert.equal(pcUntil('07:00', now) - now, 150000);
    assert.equal(pcUntil('06:00', now) - now, 3600000);
    assert.equal(pcUntil('00:00', now) - now, 2700000);
});
test('alarm normalization clamps display time and preserves one-time switches', () => {
    const alarm = pcCleanAlarm({ time: '99:99', label: ' hello ', on: false, once: true }, 1);
    assert.equal(alarm.time, '23:59');
    assert.equal(alarm.label, 'hello');
    assert.equal(alarm.on, false);
    assert.equal(alarm.once, true);
    assert.equal(pcCleanAlarm({ time: 'bad' }, 0).time, '06:00');
});
test('event times apply the date-specific Chicago daylight saving offset', () => {
    assert.equal(
        etToEpoch('2026-07-01', '12:00', 'America/Chicago'),
        Date.parse('2026-07-01T17:00:00Z')
    );
    assert.equal(
        etToEpoch('2026-12-01', '12:00', 'America/Chicago'),
        Date.parse('2026-12-01T18:00:00Z')
    );
    assert.equal(etToEpoch('2026-07-01', '12:00', 'UTC'), Date.parse('2026-07-01T12:00:00Z'));
});
test('malformed dates and nonexistent zones cannot start an event countdown', () => {
    assert.equal(etToEpoch('bad', '12:00', 'UTC'), null);
    assert.equal(etToEpoch('2026-10-22', 'noon', 'UTC'), null);
    assert.equal(etToEpoch('2026-10-22', '12:00', 'Mars/Example'), null);
    assert.equal(etValidTz('America/Chicago'), true);
});
