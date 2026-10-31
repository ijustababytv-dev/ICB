'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const { claim, permits } = require('../../src/activity/listener-lease');

test('Meld listener sends chat once and minimal support without a raw archive catch-all', () => {
    const requests = [];
    const handlers = {};
    const context = {
        Math,
        Date,
        JSON,
        location: {
            hostname: '127.0.0.1',
            port: '8790',
            href: 'http://127.0.0.1:8790/giveaway-listener.html'
        },
        document: {
            getElementById: () => ({}),

            createElement: () => ({}),

            getElementsByTagName: () => [{ appendChild: () => {} }]
        },
        setInterval: () => 1,

        setTimeout: () => 1,

        Firehose: function () {
            this.socketOpen = true;
            this.on = (type, callback) => {
                handlers[type] = callback;
            };
        },

        XMLHttpRequest: function () {
            this.open = (_method, url) => {
                this.url = url;
            };

            this.setRequestHeader = () => {};

            this.send = (body) => {
                requests.push({ url: this.url, body: JSON.parse(body) });
            };
        }
    };
    const source = fs.readFileSync(path.join(root, 'ui/js/giveaway-listener.js'), 'utf8');
    vm.runInNewContext(source, context);
    handlers.chat({
        id: 'message1',
        sender: { displayname: 'Guest', UPID: '123;TWITCH' },
        raw: 'distinctive-private-phrase',
        donations: [{ type: 'TWITCH_BITS', amount: 60, count: 2 }]
    });
    handlers.sub({
        subscriber: { displayname: 'Guest' },
        months_purchased: 2,
        months_cumulative: 60
    });
    handlers.gifts({
        anonymous: true,
        count: 3,
        recipients: [{ displayname: 'private-recipient' }]
    });
    const before = requests.length;
    handlers['*']({ type: 'viewer_list', event: { viewers: ['private-viewer'] } });
    assert.equal(requests.length, before);
    assert.equal(requests.filter((entry) => entry.url === '/api/activity/chat').length, 1);
    assert.equal(
        requests.some((entry) => entry.url === '/api/giveaway/event'),
        false
    );
    const support = requests.filter((entry) => entry.url === '/api/activity/support');
    assert.equal(support.find((entry) => entry.body.type === 'bits').body.amount, 120);
    assert.equal(support.find((entry) => entry.body.type === 'sub').body.months, 2);
    assert.equal(support.find((entry) => entry.body.type === 'gifts').body.anonymous, true);
    assert.doesNotMatch(
        JSON.stringify(support),
        /distinctive-private-phrase|private-recipient|months_cumulative/
    );
    assert.doesNotMatch(
        source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ''),
        /=>|\blet\b|\bconst\b|`/
    );
});

test('duplicate updated listeners remain idle until the short local lease expires', () => {
    assert.equal(claim('listener-first', 1000), true);
    assert.equal(claim('listener-second', 1001), false);
    assert.equal(permits('listener-first', 1002), true);
    assert.equal(permits('listener-second', 1002), false);
    assert.equal(claim('listener-second', 17000), true);
});

test('weekly listener shares the tested relay and retains SDK-construction retry behavior', () => {
    const html = fs.readFileSync(path.join(root, 'ui/html/wk/giveaway-listener.html'), 'utf8');
    assert.match(html, /\/js\/client\/giveaway-listener\.js/);
    const timers = [];
    const context = {
        Math,
        Date,
        JSON,
        location: {
            hostname: '127.0.0.1',
            port: '8790',
            href: 'http://127.0.0.1:8790/wk/giveaway-listener.html'
        },
        document: {
            getElementById: () => ({}),

            createElement: () => ({}),

            getElementsByTagName: () => [{ appendChild: () => {} }]
        },
        setInterval: () => 1,

        setTimeout: (_fn, ms) => {
            timers.push(ms);
        },

        Firehose: function () {
            throw Error('private provider details');
        },

        XMLHttpRequest: function () {
            this.open = () => {};

            this.setRequestHeader = () => {};

            this.send = () => {};
        }
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(root, 'ui/js/giveaway-listener.js'), 'utf8'),
        context
    );
    assert.ok(timers.includes(5000));
});

test('report CSV contains only summary fields and neutralizes spreadsheet formulas', () => {
    const context = { window: {} };
    vm.runInNewContext(
        fs.readFileSync(path.join(root, 'ui/js/giveaway-report/render.js'), 'utf8'),
        context
    );
    const csv = context.window.ICBReport.csv({
        date: '2026-10-31',
        timezone: 'America/Chicago',
        viewers: [{ display_name: '=1+1', platform: 'twitch', messages: '4' }],
        currencies: []
    });
    assert.match(csv, /'=1\+1/);
    assert.doesNotMatch(csv, /transcript|chat_text|raw/);
    assert.match(csv, /messages/);
    const html = context.window.ICBReport.render({
        date: '2026-10-31',
        timezone: 'America/Chicago',
        sync: { pending: 0 },
        totals: { messages: '4', partial: true },
        viewers: [{ display_name: '<script>private</script>', platform: 'twitch', messages: '4' }],
        currencies: []
    });
    assert.match(html, /Partial historical import/);
    assert.doesNotMatch(html, /<script>/);
});
