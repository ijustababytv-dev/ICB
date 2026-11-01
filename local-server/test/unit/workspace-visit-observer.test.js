'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../ui/js/local-api.js'), 'utf8');

/** Exercise the real ES5 observer without a DOM, personal browser, cloud request or credential storage. */
function fixture({ iframe = false, agent = 'Chrome', pathname = '/control.html' } = {}) {
    let account = {
        id: 'owner-one',
        timezone: 'America/Chicago',
        token: 'fixture-not-a-real-token'
    };
    const visits = [],
        timers = [];
    const window = {
        dispatchEvent() {},

        ICBVisits: { open: (id, url) => visits.push({ id, url }) }
    };
    window.top = iframe ? {} : window;
    /** Respond only to the observer's same-origin public auth status read. */
    function Request() {}

    Request.prototype.open = function (method, url) {
        assert.equal(method, 'GET');
        assert.equal(url, '/api/cloud/status');
    };

    Request.prototype.send = function () {
        this.status = 200;
        this.responseText = JSON.stringify({ signed_in: true, account });
        if (this.onload) this.onload();
    };

    Request.prototype.addEventListener = function () {};

    const document = { addEventListener() {}, createEvent: () => ({ initEvent() {} }) };

    vm.runInNewContext(source, {
        window,
        document,
        XMLHttpRequest: Request,
        location: { pathname, search: '', host: '127.0.0.1:8791' },
        navigator: { userAgent: agent },
        setInterval: (callback) => timers.push(callback),

        setTimeout: () => {},

        Date
    });
    return {
        visits,
        timers,
        window,
        switchOwner() {
            account = { ...account, id: 'owner-two' };
        }
    };
}

test('Repeated status polling does not change last-opened history; account switches remain scoped', () => {
    const f = fixture();
    assert.equal(f.visits.length, 1);
    f.timers[0]();
    f.timers[0]();
    assert.equal(f.visits.length, 1);
    assert.equal(Object.keys(f.window.ICBLocalAccount).sort().join(','), 'id,timezone');
    f.switchOwner();
    f.timers[0]();
    assert.equal(f.visits.length, 2);
    assert.equal(f.visits[1].id, 'owner-two');
});

test('Automated Meld/OBS layers, embedded previews and login never create recent-page visits', () => {
    for (const options of [
        { iframe: true },
        { agent: 'Meld/1.0' },
        { agent: 'obs-browser' },
        { pathname: '/cloud.html' }
    ]) {
        const f = fixture(options);
        for (const timer of f.timers) timer();
        assert.equal(f.visits.length, 0, JSON.stringify(options));
    }
});
