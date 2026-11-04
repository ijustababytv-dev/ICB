'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const session = require('../../src/cloud/session');
const feed = require('../../src/cloud/state-feed');

test('many overlay reads share one cloud request and paginated snapshots publish atomically', async (t) => {
    const owner = randomUUID();
    t.mock.method(session, 'current', () => ({ account: { id: owner } }));
    let finish;
    let calls = 0;
    t.mock.method(session, 'call', async (_path, _method, body) => {
        calls++;
        if (calls === 1) {
            assert.equal(body.paths.length, 2);
            await new Promise((resolve) => {
                finish = resolve;
            });
            return {
                status: 200,
                data: {
                    ok: true,
                    revision: 3,
                    page: 0,
                    complete: false,
                    snapshot_token: randomUUID(),
                    server_time: new Date().toISOString(),
                    authorities: { todos: { mode: 'cloud', revision: 3 } },
                    documents: { 'todos.json': { daily: [] } },
                    views: { '/api/todos': { todos: { daily: [] } } }
                }
            };
        }
        assert.equal(feed.document('todos.json'), null);
        return {
            status: 200,
            data: {
                ok: true,
                revision: 3,
                page: 1,
                complete: true,
                documents: { 'turnline.json': { people: [] } },
                views: { '/api/turnline': { people: [] } }
            }
        };
    });
    for (let i = 0; i < 30; i++) feed.watch(i % 2 ? '/api/todos' : '/api/turnline');
    const first = feed.tick(true);
    const others = Array.from({ length: 20 }, () => feed.tick(true));
    assert.equal(calls, 1);
    assert.equal(feed.document('todos.json'), null);
    finish();
    await Promise.all([first, ...others]);
    assert.equal(calls, 2);
    assert.deepEqual(feed.document('turnline.json'), { people: [] });
    assert.equal(feed.status().revision, 3);
});

test('logout and account switches discard obsolete in-flight cloud results', async (t) => {
    let owner = randomUUID();
    t.mock.method(session, 'current', () => (owner ? { account: { id: owner } } : null));
    let finish;
    t.mock.method(
        session,
        'call',
        () =>
            new Promise((resolve) => {
                finish = resolve;
            })
    );
    const request = feed.tick(true);
    owner = randomUUID();
    feed.status();
    finish({
        status: 200,
        data: {
            revision: 999,
            complete: true,
            documents: { 'todos.json': { daily: ['other owner'] } },
            views: {},
            authorities: {},
            server_time: new Date().toISOString()
        }
    });
    await request;
    assert.equal(feed.document('todos.json'), null);
    assert.equal(feed.status().revision, 0);
    owner = null;
    assert.equal(feed.status().code, 'login_required');
});

test('failed feeds keep confirmed snapshots and obsolete reads cannot undo a committed mutation', async (t) => {
    const owner = randomUUID();
    t.mock.method(session, 'current', () => ({ account: { id: owner } }));
    feed.status();
    const attempt = feed.generation();
    feed.publish(
        {
            revision: 10,
            documents: { 'todos.json': { daily: ['confirmed'] } },
            views: {},
            authorities: {},
            server_time: new Date().toISOString()
        },
        owner,
        attempt
    );
    assert.equal(
        feed.publish({ revision: 9, documents: { 'todos.json': { daily: [] } } }, owner, attempt),
        false
    );
    t.mock.method(session, 'call', async () => {
        throw new Error('cloud_connection_failed');
    });
    await feed.tick(true);
    assert.deepEqual(feed.document('todos.json'), { daily: ['confirmed'] });
    assert.equal(feed.status().code, 'cloud_connection_failed');
});
