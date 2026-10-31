'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContext } = require('../src/features/context');
const { executeRequest } = require('../src/features/executor');
const { safeValue, sanitize, command } = require('../src/features/contracts');
const { weightedDraw } = require('../src/domain/weighted-draw');
const { definitions } = require('../src/features/context/config');
const facts = require('../src/domain/game-facts');
const resourceRules = require('../src/domain/resource-rules');
const { randomUUID } = require('node:crypto');

test('feature factories isolate owners, preserve Turn Line actions, and never touch local data', async () => {
    const first = createContext({}).initialize();
    const second = createContext({}).initialize();
    await executeRequest(first, 'turnline', {
        path: '/api/turnline',
        method: 'POST',
        values: { add: 'Guest' }
    });
    const left = await executeRequest(first, 'turnline', { path: '/api/turnline' });
    const right = await executeRequest(second, 'turnline', { path: '/api/turnline' });
    assert.equal(left.payload.people[0].name, 'Guest');
    assert.deepEqual(right.payload.people, []);
    await executeRequest(first, 'turnline', {
        path: '/api/turnline',
        method: 'POST',
        values: { done: true }
    });
    assert.equal(first.documents['turnline.json'].people[0].state, 'done');
    await executeRequest(first, 'turnline', {
        path: '/api/turnline',
        method: 'POST',
        values: { undo: true }
    });
    assert.equal(first.documents['turnline.json'].people[0].state, 'go');
    assert.throws(
        () => first.files.writeFileSync('/private/secret.json', '{}'),
        /local_file_operation/
    );
});

test('countdown stock survives new Lambda/context instances instead of resetting on every request', () => {
    const config = definitions()['resource-trackers.json'];
    const card = config.cards.find((card) => card.mode === 'countdown');
    assert.ok(card);
    const document = { counts: { [card.id]: 7 }, slotCounts: {}, secondaryCounts: {} };
    for (let attempt = 0; attempt < 3; attempt++) {
        const context = createContext({ 'resource-trackers.json': document }).initialize();
        assert.equal(context.use('resources').findResourceCard(card.id).count, 7);
    }
});

test('cloud resource rules consume typed increments and reject Primary/raw input', () => {
    const state = {
        cards: [{ id: 'fixture', mode: 'session', tokens: ['itemtype_fixture'], count: 0 }]
    };
    assert.equal(
        resourceRules.applyResourceEvent(state, 'Inventory gained: itemtype_fixture x99'),
        false
    );
    assert.equal(facts.valid({ source: 'primary', direction: 'gained', items: [] }), false);
    assert.equal(
        resourceRules.applyResourceEvent(state, {
            source: 'inventory',
            direction: 'gained',
            items: [{ token: 'itemtype_fixture', quantity: 3, star: true }]
        }),
        true
    );
    assert.equal(state.cards[0].count, 3);
});

test('feature envelopes refuse transcript, credential and changed-protocol shapes', () => {
    assert.throws(
        () => safeValue({ parts: [{ text: 'private-fixture-phrase' }] }),
        /private_feature_field/
    );
    assert.throws(() => safeValue({ nested: { password: 'fixture' } }), /private_feature_field/);
    assert.deepEqual(
        sanitize({ reader: { line: 'private-fixture-phrase' }, title: 'Operator title' }),
        { title: 'Operator title' }
    );
    assert.throws(() => command({ protocol_version: 1 }), /feature_protocol_required/);
    assert.throws(
        () =>
            command({
                protocol_version: 2,
                command_id: randomUUID(),
                expected_revision: 0,
                action: 'request',
                operands: {},
                owner_id: randomUUID()
            }),
        /invalid_fields/
    );
});

test('weighted drawings handle large ticket counts without a ticket-sized array', () => {
    assert.deepEqual(weightedDraw([{ name: 'Only', tickets: 1000000000 }]), {
        name: 'Only',
        total: 1000000000
    });
    assert.throws(() => weightedDraw([{ name: 'Nobody', tickets: 0 }]), /invalid_drawing_weight/);
});
