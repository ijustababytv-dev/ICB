'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Home adds safe saved decor links and clears them after logout or connection loss', async () => {
    let focus;
    let ok = true;
    let offline = false;
    const links = [];
    const status = {};
    const container = {
        replaceChildren() {
            links.length = 0;
        },

        appendChild(link) {
            links.push(link);
        }
    };
    const context = {
        window: {
            addEventListener(type, callback) {
                assert.equal(type, 'focus');
                focus = callback;
            }
        },
        document: {
            getElementById(id) {
                return id === 'decorPages' ? container : status;
            },

            createElement(tag) {
                assert.equal(tag, 'a');
                return {};
            }
        },
        async fetch(url) {
            assert.equal(url, '/api/decor/state');
            if (offline) throw new Error('offline');
            return {
                ok,
                json: async () => ({
                    ok,
                    effects: [
                        { id: 'ghosts', name: '<img src=x onerror=alert(1)>' },
                        { id: '../escape', name: 'Unsafe path' },
                        { id: 'leaves' },
                        { id: 'all' }
                    ]
                })
            };
        }
    };
    vm.runInNewContext(
        fs.readFileSync(path.resolve(__dirname, '../../../ui/js/hub/directory.js'), 'utf8'),
        context
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(links.length, 1);
    assert.equal(links[0].href, '/decor/ghosts.html');
    assert.equal(links[0].textContent, '<img src=x onerror=alert(1)> — Decor Overlay');
    assert.equal(links[0].innerHTML, undefined);
    ok = false;
    await focus();
    assert.equal(links.length, 0);
    assert.match(status.textContent, /Sign in/);
    ok = true;
    await focus();
    assert.equal(links.length, 1);
    offline = true;
    await focus();
    assert.equal(links.length, 0);
    assert.match(status.textContent, /unavailable/);
});
