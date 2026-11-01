'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContext } = require('../src/features/context');
const { executeRequest } = require('../src/features/executor');
const { applyIntent } = require('../src/features/inputs');
const { saveDocument } = require('../src/features/repository');
const rules = require('../src/domain/check-in');
const beforeCutoff = Date.parse('2026-11-01T11:59:00Z');
const afterCutoff = Date.parse('2026-11-01T12:01:00Z');

/** Build a cold cloud context with one funded viewer and deterministic Chicago stream time. */
function fixture(now = beforeCutoff, documents = {}) {
    const context = createContext(documents, { now, timezone: 'America/Chicago' }).initialize();
    const state = context.use('giveaway/state');
    state.ensureEntrant('Guest').manualTickets = 7;
    return { context, state };
}

/** Exercise operator routes through the same dispatch used by cloud commands. */
function post(context, path, values = {}) {
    return executeRequest(context, 'giveaway', { path, method: 'POST', values });
}

test('check-in survives cold starts, rolls at 06:00 across DST, and never erases saved tickets', () => {
    const first = fixture();
    first.state.checkInViewer('GUEST');
    first.state.saveGiveaway();
    const second = fixture(beforeCutoff + 1000, first.context.documents);
    assert.equal(second.state.poolView().total, 7);
    const nextDay = fixture(afterCutoff, second.context.documents);
    assert.equal(nextDay.state.poolView().total, 0);
    assert.equal(nextDay.state.entrantTotal(nextDay.state.ensureEntrant('Guest')), 7);
    assert.equal(nextDay.state.checkInViewer('Guest', new Date(beforeCutoff).toISOString()), false);
    assert.equal(nextDay.state.checkInViewer('guest'), true);
    assert.equal(nextDay.state.jarView().total, 7);
    assert.equal(fixture().state.poolView().total, 0, 'Another owner context has no check-ins');
});

test('draws exclude absent/blocked viewers, respect prize locks and preserve immutable weighted results', async () => {
    const { context, state } = fixture();
    await assert.rejects(() => post(context, '/api/giveaway/draw', { prize: 'plushie' }), {
        status: 400
    });
    state.checkInViewer('Guest');
    state.ensureEntrant('Absent').manualTickets = 100;
    state.ensureEntrant('Bot').manualTickets = 100;
    state.giveaway.blocked.push('bot');
    assert.equal(state.checkInViewer('Bot'), false);
    const draw = await post(context, '/api/giveaway/draw', { prize: 'mystery-outfit' });
    assert.equal(draw.payload.winner.username, 'Guest');
    assert.deepEqual(context.draws[0].eligibility, [{ name: 'Guest', tickets: 7 }]);
    await assert.rejects(() => post(context, '/api/giveaway/draw', { prize: 'mystery-outfit' }), {
        status: 400
    });
    assert.equal((await post(context, '/api/giveaway/draw', { prize: 'plushie' })).status, 200);
});

test('empty jar rejects earlier queued chat, permits re-entry and retains the check-in setting on reset', async () => {
    const { context, state } = fixture();
    state.checkInViewer('Guest');
    await post(context, '/api/giveaway/jar/empty');
    assert.equal(state.poolView().total, 0);
    assert.equal(state.checkInViewer('Guest', new Date(beforeCutoff - 1).toISOString()), false);
    assert.equal(state.checkInViewer('Guest'), true);
    assert.equal(state.poolView().total, 7);
    await assert.rejects(() => post(context, '/api/giveaway/checkin', { required: 'false' }), {
        status: 400
    });
    await post(context, '/api/giveaway/checkin', { required: false });
    await post(context, '/api/giveaway/reset');
    assert.equal(state.ensureCheckIn().required, false);
    assert.deepEqual(state.ensureCheckIn().users, {});
});

test('duplicate presence after emptying checks in again without awarding twice in the same window', async () => {
    const { context, state } = fixture();
    const input = { kind: 'presence', sender: 'Guest', at: new Date(beforeCutoff).toISOString() };
    let inserts = 0;
    const client = { query: async () => ({ rowCount: ++inserts === 1 ? 1 : 0 }) };

    await applyIntent(context, input, client, { id: 'fixture' });
    assert.equal(state.poolView().total, 7);
    await post(context, '/api/giveaway/jar/empty');
    await applyIntent(context, input, client, { id: 'fixture' });
    assert.equal(state.poolView().total, 7);
    assert.equal(state.ensureEntrant('Guest').counts.chatWindows, 0);
    assert.deepEqual(Object.keys(state.giveaway.chatActiveThisWindow), ['Guest']);
});

test('SQL projection keeps the check-in policy in settings and participation in operational metadata', async () => {
    const { context, state } = fixture();
    state.checkInViewer('Guest');
    state.giveaway.checkInRequired = false;
    const writes = {};
    const client = {
        query: async (sql, values) => {
            if (/INSERT INTO (owner_settings|feature_metadata)/.test(sql))
                writes[sql.includes('owner_settings') ? 'settings' : 'metadata'] = JSON.parse(
                    values[2]
                );
            return { rows: [], rowCount: 0 };
        }
    };
    await saveDocument(client, 'fixture', 'giveaway.json', state.giveaway);
    assert.equal(writes.settings.checkInRequired, false);
    assert.equal(writes.settings.checkIn, undefined);
    assert.equal(writes.metadata.checkIn.users.guest, true);
    assert.equal(writes.metadata.checkInRequired, undefined);
    assert.equal(
        context.effects.some((event) => event.type === 'chat_window'),
        false
    );
});

test('check-in does not mistake inherited object properties for present viewers', () => {
    const ci = rules.forNight(null, 'fixture');
    assert.equal(rules.isEligible(ci, 'toString'), false);
    assert.equal(rules.markCheckedIn(ci, 'toString'), true);
    assert.equal(rules.isEligible(ci, 'TOSTRING'), true);
});

test('size settings clamp finite values, survive cold contexts, and reset without touching ticket totals', async () => {
    const { context, state } = fixture();
    state.checkInViewer('Guest');
    await post(context, '/api/giveaway/display', {
        jarScale: 99,
        cloudScale: 0.01,
        unicornScale: 1.234
    });
    assert.deepEqual(
        [
            state.giveaway.display.jarScale,
            state.giveaway.display.cloudScale,
            state.giveaway.display.unicornScale
        ],
        [1.5, 0.5, 1.23]
    );
    await post(context, '/api/giveaway/display', {
        jarScale: 'invalid',
        cloudScale: 1.5,
        unicornScale: 99
    });
    const restored = fixture(beforeCutoff, context.documents);
    assert.deepEqual(
        [
            restored.state.giveaway.display.jarScale,
            restored.state.giveaway.display.cloudScale,
            restored.state.giveaway.display.unicornScale
        ],
        [1.5, 1.5, 2]
    );
    await post(restored.context, '/api/giveaway/display/reset');
    assert.equal(restored.state.giveaway.display.jarScale, 1);
    assert.equal(restored.state.poolView().total, 7);
});
