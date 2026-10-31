'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveStaticPath } = require('../../src/http/static');
const root = path.resolve(__dirname, '../../..');

for (const [url, file] of [
    ['/', 'ui/html/hub.html'],
    ['/control.html', 'ui/html/control.html'],
    ['/overlay.html', 'ui/html/overlay.html'],
    ['/wk/giveaway-listener.html', 'ui/html/wk/giveaway-listener.html'],
    ['/Aniimo%20Tracker.html', 'ui/html/Aniimo Tracker.html'],
    ['/matter.min.js', 'ui/js/vendor/matter.min.js'],
    ['/meld-firehose.js', 'ui/js/vendor/meld-firehose.js'],
    ['/js/client/control.js', 'ui/js/control.js'],
    ['/css/control.css', 'ui/css/control.css'],
    ['/assets/resources/a.png', 'assets/resources/a.png'],
    ['/images/embedded/a.png', 'ui/images/embedded/a.png']
])
    test(`public URL remains stable: ${url}`, () =>
        assert.equal(resolveStaticPath(url, root).file, path.join(root, file)));
for (const url of [
    '/data/steam.json',
    '/js/server/config.js',
    '/js/test/e2e.js',
    '/RULES.md',
    '/package.json',
    '/cloud-server/src/activity/app.js',
    '/local-server/src/config.js',
    '/terraform/terraform.tfstate'
]) {
    test(`private files are outside the static roots: ${url}`, () =>
        assert.equal(resolveStaticPath(url, root).status, 404));
}
for (const url of [
    '/assets/../data/steam.json',
    '/assets/%2e%2e/data/live.json',
    '/assets/..%5cdata/live.json',
    '/assets/%00.png',
    '/terraform/.env',
    '/assets/.env',
    'relative.png'
]) {
    test(`reject ambiguous or escaping paths: ${url}`, () =>
        assert.equal(resolveStaticPath(url, root).status, 403));
}
test('malformed URI encoding returns a client error', () =>
    assert.equal(resolveStaticPath('/assets/%ZZ.png', root).status, 400));
