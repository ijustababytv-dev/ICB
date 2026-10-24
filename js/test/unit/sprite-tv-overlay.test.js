'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { defaults } = require('../../server/domain/sprite-tv');
const source = fs.readFileSync(path.resolve(__dirname, '../../client/sprite-tv.js'), 'utf8');

/** Drive real overlay code with deterministic timers and queued XHR responses, without a server. */
function overlay() {
    const elements = new Map();
    const timers = new Map();
    const requests = [];
    let sequence = 0;
    /** Supply just the DOM operations used by the TV, retaining visible state for assertions. */
    function element(id) {
        if (!elements.has(id))
            elements.set(id, {
                id,
                style: {},
                className: '',
                textContent: '',
                classList: { add() {}, remove() {} },

                cloneNode() {
                    return { ...this, style: { ...this.style } };
                },

                parentNode: {
                    replaceChild(next) {
                        elements.set(id, next);
                    }
                }
            });
        return elements.get(id);
    }

    /** Record a scheduled callback without waiting for wall-clock time. */
    function schedule(callback, ms, repeat) {
        const id = ++sequence;
        timers.set(id, { callback, ms, repeat });
        return id;
    }

    /** Keep each request pending so tests can simulate stale, empty and failed responses. */
    function Xhr() {}

    Xhr.prototype.open = function (method, url) {
        this.url = new URL(url).pathname;
    };

    Xhr.prototype.send = function () {
        requests.push(this);
    };

    vm.runInNewContext(source, {
        window: { location: { protocol: 'http:', host: '127.0.0.1:8791' } },
        document: { getElementById: element },
        XMLHttpRequest: Xhr,
        setTimeout: (fn, ms) => schedule(fn, ms, false),

        setInterval: (fn, ms) => schedule(fn, ms, true),

        clearTimeout: (id) => timers.delete(id),

        clearInterval: (id) => timers.delete(id)
    });
    /** Reply to one queued route and run its actual overlay response handler. */
    function respond(route, payload, status = 200) {
        const index = requests.findIndex((r) => r.url === route);
        assert.ok(index >= 0, 'expected request for ' + route);
        const request = requests.splice(index, 1)[0];
        Object.assign(request, { status, readyState: 4, responseText: JSON.stringify(payload) });
        request.onreadystatechange();
    }

    /** Deliver settings via the real polling callback, retaining a manual display as a fallback. */
    function payload(settings) {
        if (!requests.some((r) => r.url === '/api/sprite-tv'))
            [...timers.values()].find((timer) => timer.repeat).callback();
        respond('/api/sprite-tv', {
            ok: true,
            settings: { ...defaults(), ssDelay: 1, ...settings },
            display: { name: 'Manual', variant: 'Base', rarity: '', img: '/assets/manual.png' }
        });
    }

    /** Fire a one-shot timer exactly once, as a browser does. */
    function timeout(ms) {
        const entry = [...timers].find(([, timer]) => !timer.repeat && timer.ms === ms);
        assert.ok(entry, 'expected timeout ' + ms);
        timers.delete(entry[0]);
        entry[1].callback();
    }

    return { element, timers, requests, respond, payload, timeout };
}

const slides = {
    ok: true,
    sprites: [{ name: 'Slide', variant: 'Base', rarity: '', img: '/assets/slide.png' }]
};

test('an empty or failed slideshow can retry on the next poll', () => {
    for (const status of [200, 503]) {
        const tv = overlay();
        tv.payload({ slideshow: true });
        tv.timeout(1000);
        tv.respond('/api/sprite-tv/slideshow', { ok: true, sprites: [] }, status);
        tv.payload({ slideshow: true });
        tv.timeout(1000);
        assert.ok(tv.requests.some((r) => r.url.endsWith('/slideshow')));
    }
});

test('stopping a slideshow discards a late request and keeps the manual display', () => {
    const tv = overlay();
    tv.payload({ slideshow: true, ssShowInterrupt: false });
    tv.timeout(1000);
    tv.payload({ slideshow: false });
    tv.respond('/api/sprite-tv/slideshow', slides);
    assert.equal(tv.element('sprite-name').textContent, 'Manual');
    assert.equal(tv.element('ss-counter').style.display, 'none');
    assert.equal(tv.timers.size, 1, 'only the polling interval remains');
});

test('stopping during the interrupt cancels its delayed transition', () => {
    const tv = overlay();
    tv.payload({ slideshow: true, ssShowInterrupt: true });
    tv.timeout(1000);
    tv.respond('/api/sprite-tv/slideshow', slides);
    assert.ok([...tv.timers.values()].some((timer) => timer.ms === 3000));
    tv.payload({ slideshow: false });
    assert.equal(tv.timers.size, 1);
    assert.equal(tv.element('sprite-name').textContent, 'Manual');
});

test('changing slideshow pools cancels the old cycle and loads the new pool', () => {
    const tv = overlay();
    tv.payload({ slideshow: true, ssPool: 'all', ssShowInterrupt: false });
    tv.timeout(1000);
    tv.respond('/api/sprite-tv/slideshow', slides);
    assert.equal(tv.element('sprite-name').textContent, 'Slide');
    tv.payload({ slideshow: true, ssPool: 'uncaught', ssShowInterrupt: false });
    tv.timeout(1000);
    assert.ok(tv.requests.some((r) => r.url.endsWith('/slideshow')));
    assert.equal([...tv.timers.values()].filter((timer) => timer.repeat).length, 1);
});

test('Meld TV uses polling and avoids modern syntax and transport APIs', () => {
    assert.doesNotMatch(source, /\b(?:const|let)\s|=>|\b(?:fetch|EventSource)\s*\(/);
    assert.match(source, /setInterval\(poll, 2000\)/);
});
