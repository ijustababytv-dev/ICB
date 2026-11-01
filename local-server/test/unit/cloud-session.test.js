'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const session = require('../../src/cloud/session');
const { parseIntent } = require('../../src/domain/feature-intents');
const { intentSpec } = require('../../../cloud-server/src/features/intent-spec');
const { createContext } = require('../../../cloud-server/src/features/context');

test('one installation serializes cloud calls and account changes cancel queued and in-flight old responses', async (t) => {
    const session = require('../../src/cloud/session-controller').createSession({
        request: require('../../src/cloud/client').request,
        store: { read: () => null, write: () => {}, clear: () => {} }
    });
    let active = 0;
    let max = 0;
    let started = 0;
    t.mock.method(https, 'request', (url, _options, callback) => {
        const req = new EventEmitter();
        req.end = (payload) => {
            active++;
            max = Math.max(max, active);
            started++;
            const body = payload ? JSON.parse(payload) : {};
            setTimeout(() => {
                const res = new EventEmitter();
                res.statusCode = 200;
                callback(res);
                active--;
                res.emit(
                    'data',
                    Buffer.from(
                        JSON.stringify(
                            url.pathname === '/v1/login'
                                ? {
                                      token: 't'.repeat(43),
                                      account: { id: body.username, username: body.username },
                                      expires_at: new Date(Date.now() + 14 * 86400000).toISOString()
                                  }
                                : { ok: true, protocol_version: 2 }
                        )
                    )
                );
                res.emit('end');
            }, 15);
        };

        return req;
    });
    await session.login('https://fixture.invalid', 'first', 'fixture-password');
    max = 0;
    await Promise.all([session.call('/one'), session.call('/two'), session.call('/three')]);
    assert.equal(max, 1);
    const old = session.call('/old');
    const queued = session.call('/old-queued');
    const results = Promise.allSettled([old, queued]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const before = started;
    await session.login('https://fixture.invalid', 'second', 'fixture-password');
    const obsolete = await results;
    assert.ok(
        obsolete.every(
            (result) => result.status === 'rejected' && result.reason.message === 'account_changed'
        )
    );
    assert.equal(
        started - before,
        3,
        'The obsolete queued call never reached HTTPS; only revoke, login and protocol validation did.'
    );
    assert.equal((await session.call('/new', 'GET', undefined, 'second')).status, 200);
    await session.logout();
});

test('minimal intents preserve numbered boards, bracketed/accented names and book arrows without retaining unrelated chat', () => {
    const spec = intentSpec(createContext({}).initialize());
    assert.deepEqual(parseIntent('!show3', spec), { command: 'show3', arguments: [] });
    assert.deepEqual(parseIntent('!page >', spec), { command: 'page', arguments: ['next'] });
    assert.deepEqual(parseIntent('!book <', spec), { command: 'book', arguments: ['back'] });
    const signup = { commands: { tomato: 'name' }, name_signup: true };
    assert.deepEqual(parseIntent('!tomato [Baby Name]', signup), {
        command: 'tomato',
        arguments: ['[Baby Name]']
    });
    assert.deepEqual(parseIntent('!Élodie', signup), {
        command: 'signup_name',
        arguments: ['Élodie']
    });
    assert.equal(parseIntent('unrelated private chat', spec), null);
    assert.equal(parseIntent('!turn words that are not a join command', spec), null);
});

test('Steam secret preparation strips the key and forwards its confirmed revision to the settings command', async (t) => {
    t.mock.method(session, 'current', () => ({ account: { id: 'fixture-owner' } }));
    t.mock.method(session, 'call', async (route, method, body) => {
        assert.equal(route, '/v1/integrations/steam/secret');
        assert.equal(method, 'PUT');
        assert.equal(body.expected_revision, 42);
        return {
            status: 200,
            data: { ok: true, command_id: body.command_id, feature_revision: 43 }
        };
    });
    const prepared = await require('../../src/cloud/integrations').prepareIntegration(
        '/api/steam/settings',
        { apiKey: 'fixture-only-key', steamId: '123' },
        42
    );
    assert.deepEqual(prepared, { values: { steamId: '123' }, revision: 43 });
});
