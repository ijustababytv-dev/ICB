'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContext } = require('../src/features/context');
const { executeRequest, finalizeDue } = require('../src/features/executor');
const { gameFact } = require('../../local-server/src/domain/game-facts');
const { applyGame } = require('../src/features/inputs');
const { safeValue } = require('../src/features/contracts');
const { reportCsv } = require('../src/features/reports');

test('owner stock overrides and progress survive context replacement independently', async () => {
    let context = createContext({}).initialize();
    const card = context
        .use('resources')
        .resourceTrackers.cards.find((card) => card.mode === 'countdown');
    const route = '/api/resource-trackers/' + card.id;
    await executeRequest(context, 'resource-trackers', {
        path: route + '/set-start',
        method: 'POST',
        values: { startAt: 42 }
    });
    context = createContext(context.documents).initialize();
    assert.equal(context.use('resources').findResourceCard(card.id).startAt, 42);
    await executeRequest(context, 'resource-trackers', {
        path: route + '/adjust',
        method: 'POST',
        values: { delta: -3 }
    });
    context = createContext(context.documents).initialize();
    assert.equal(context.use('resources').findResourceCard(card.id).count, 39);
    context.use('resources').resetCountdownStock();
    assert.equal(context.use('resources').findResourceCard(card.id).count, 42);
});

test('real incremental parser shapes preserve lost fertilizer, star crops, prefix matches and Primary exclusion', () => {
    const context = createContext({
        'live.json': { resources: { amber: 1 }, reconciliation: { required: false } }
    }).initialize();
    for (const line of [
        'Inventory lost: itemtype_fertilizer_harvestbooster x2',
        'Inventory gained: itemtype_crop_apple (1*) x5',
        'Inventory gained: itemtype_mineral_ore_silver x3, itemtype_mineral_rock_stone x2'
    ]) {
        const fact = gameFact(line);
        safeValue(fact);
        applyGame(context, {
            sequence: 1,
            source_key: 'fixture',
            at: new Date().toISOString(),
            fact
        });
    }
    assert.equal(
        context.documents['weekly-accomplishments.json'].progress['fertilizer-30'].count,
        2
    );
    assert.equal(
        context.documents['weekly-accomplishments.json'].progress['crops-star-10'].count,
        5
    );
    assert.equal(context.documents['weekly-accomplishments.json'].progress['mine-20'].count, 1);
    assert.equal(gameFact('Primary gained: itemtype_crop_apple x999'), null);
});

test('cloud alarm occurrences survive cold starts, expire and never catch up an old sound on login', () => {
    const before = Date.parse('2026-10-31T10:14:59Z');
    let context = createContext({}, { now: before }).initialize();
    finalizeDue(context);
    context.runtime.checkpoint();
    context = createContext(context.documents, { now: before + 2000 }).initialize();
    finalizeDue(context);
    context.runtime.checkpoint();
    const event = context.documents['paliaclock.json'].runtime.pcEvents[0];
    assert.equal(event.at, Date.parse('2026-10-31T10:15:00Z'));
    context = createContext(context.documents, { now: before + 4000 }).initialize();
    finalizeDue(context);
    context.runtime.checkpoint();
    assert.equal(context.documents['paliaclock.json'].runtime.pcEvents.length, 1);
    assert.equal(
        context.documents['paliaclock.json'].runtime.pcEvents[0].occurrence_id,
        event.occurrence_id
    );
    context = createContext(context.documents, { now: before + 20000 }).initialize();
    finalizeDue(context);
    context.runtime.checkpoint();
    assert.equal(context.documents['paliaclock.json'].runtime.pcEvents.length, 0);
    const fresh = createContext({}, { now: before + 20000 }).initialize();
    finalizeDue(fresh);
    fresh.runtime.checkpoint();
    assert.deepEqual(fresh.documents['paliaclock.json'].runtime.pcEvents, []);
});

test('cloud artwork commands accept indexed filenames and refuse unknown files or image payloads', async () => {
    const context = createContext(
        {},
        { assets: [{ relative_path: 'assets/poll/fixture.png', bytes: 100, modified_at: 1000 }] }
    ).initialize();
    await executeRequest(context, 'poll', {
        path: '/api/poll/image',
        method: 'POST',
        values: { asset_ref: 'assets/poll/fixture.png', label: 'Fixture badge' }
    });
    assert.equal(context.documents['poll.json'].options.at(-1).image, 'fixture.png');
    await assert.rejects(
        () =>
            executeRequest(context, 'poll', {
                path: '/api/poll/image',
                method: 'POST',
                values: { asset_ref: 'assets/poll/missing.png' }
            }),
        /feature_command_rejected/
    );
    assert.throws(
        () => safeValue({ image: 'data:' + 'image/png;base64,' + 'AAAA' }),
        /invalid_feature_string/
    );
});

test('feature CSV exports neutralize deliberate names and retain typed numeric totals', () => {
    const csv = reportCsv([{ name: '=1+1', tickets: 12 }]);
    assert.match(csv, /'=1\+1/);
    assert.match(csv, /"12"/);
});
