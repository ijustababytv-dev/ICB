'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveStaticPath } = require('../../server/http/static');
const root = path.resolve(__dirname, '../../..');

for (const [url, file] of [
  ['/', 'html/hub.html'], ['/control.html', 'html/control.html'], ['/overlay.html', 'html/overlay.html'],
  ['/wk/giveaway-listener.html', 'html/wk/giveaway-listener.html'],
  ['/Aniimo%20Tracker.html', 'html/Aniimo Tracker.html'],
  ['/matter.min.js', 'js/vendor/matter.min.js'], ['/meld-firehose.js', 'js/vendor/meld-firehose.js'],
  ['/js/client/control.js', 'js/client/control.js'], ['/css/control.css', 'css/control.css'],
  ['/assets/resources/a.png', 'assets/resources/a.png'], ['/images/embedded/a.png', 'images/embedded/a.png'],
]) test(`public URL remains stable: ${url}`, () => assert.equal(resolveStaticPath(url, root).file, path.join(root, file)));
for (const url of ['/data/steam.json', '/js/server/config.js', '/js/test/e2e.js', '/RULES.md', '/package.json']) {
  test(`private files are outside the static roots: ${url}`, () => assert.equal(resolveStaticPath(url, root).status, 404));
}
for (const url of ['/assets/../data/steam.json', '/assets/%2e%2e/data/live.json', '/assets/..%5cdata/live.json', '/assets/%00.png', 'relative.png']) {
  test(`reject ambiguous or escaping paths: ${url}`, () => assert.equal(resolveStaticPath(url, root).status, 403));
}
test('malformed URI encoding returns a client error', () => assert.equal(resolveStaticPath('/assets/%ZZ.png', root).status, 400));
