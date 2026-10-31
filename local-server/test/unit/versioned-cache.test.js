'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeSnapshot } = require('../../src/cloud/versioned-cache');

test('a command cannot skip an in-flight feed or lose other features while newer state stays confirmed', () => {
    const initial = { revision: 5, documents: {}, views: {}, authorities: {} };
    const command = mergeSnapshot(
        initial,
        {
            revision: 7,
            authorities: { todos: { revision: 7 } },
            documents: { 'todos.json': { daily: ['new'] } },
            views: { '/api/todos': { daily: ['new'] } }
        },
        true
    );
    assert.equal(command.revision, 5);
    const feed = mergeSnapshot(
        command,
        {
            revision: 6,
            authorities: { todos: { revision: 5 }, turnline: { revision: 6 } },
            documents: { 'todos.json': { daily: [] }, 'turnline.json': { people: ['other'] } },
            views: { '/api/todos': { daily: [] }, '/api/turnline': { people: ['other'] } }
        },
        false
    );
    assert.equal(feed.revision, 6);
    assert.deepEqual(feed.documents['todos.json'].daily, ['new']);
    assert.deepEqual(feed.documents['turnline.json'].people, ['other']);
    assert.deepEqual(feed.views['/api/todos'].daily, ['new']);
    assert.equal(feed.view_revisions['/api/todos'], 7);
});
