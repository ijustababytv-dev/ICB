'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../../src/cloud/state-feed');
const resources = require('../../src/resources');
const definitions = require('../../config/resource-trackers.json');

// Business rule: after an art swap the number sits on this computer's measured box with
// this computer's colour, while the count and visibility stay whatever the cloud says.
test('a card the cloud already knows takes its number box and colour from local config', (t) => {
    const local = definitions.cards.find((card) => card.id === 'essence');
    const oldCloud = {
        id: 'essence',
        image: 'OLD.png',
        valueBox: { left: 1, top: 2, width: 3, height: 4 },
        mode: 'lifetime',
        count: 42,
        visible: false
    };
    t.mock.method(feed, 'watch', () => ({ resourceTrackers: { cards: [oldCloud] } }));
    const card = resources.findResourceCard('essence');
    assert.deepEqual(card.valueBox, local.valueBox);
    assert.equal(card.image, local.image);
    assert.equal(card.valueColor, local.valueColor);
    assert.equal(card.count, 42);
    assert.equal(card.visible, false);
    assert.equal(card.mode, 'lifetime');
    assert.equal(resources.resourceTrackersView().cards[0].valueBox.left, local.valueBox.left);
    assert.equal(oldCloud.valueBox.left, 1);
});
