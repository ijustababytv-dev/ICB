'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Exercise every extracted feature through the same temporary server as the E2E scenarios. */
async function verifyFeatureRoutes(json, origin) {
    const routes = [
        'tradeup/state',
        'tradeup/config',
        'decor/state',
        'hub',
        'hub/startup-urls',
        'connection-check',
        'walkers/state',
        'walkers/admin',
        'poll',
        'poll/admin',
        'teams',
        'teams/admin',
        'eventtime',
        'party',
        'party/admin',
        'steam',
        'steam/admin',
        'newsticker',
        'newsticker/admin',
        'sashimi',
        'sashimi/admin',
        'beanburger-signup',
        'beanburger-signup/admin',
        'flowtree-signup',
        'flowtree-signup/admin',
        'desktop',
        'aniimo',
        'aniimo/admin',
        'sprites',
        'sprites/admin',
        'sprites/jar',
        'sprite-tv',
        'sprite-tv/slideshow',
        'avatars',
        'avatars/admin',
        'countdowns',
        'paliaclock',
        'hunt',
        'hunt/admin',
        'randomizer',
        'activity/nights',
        'activity/night',
        'giveaway/state',
        'giveaway/backups'
    ];
    for (const route of routes) {
        const result = await json('/api/' + route);
        assert.equal(result.response.status, 200, `${route}: ${result.payload.error || 'failed'}`);
    }
    // Exercise cross-feature chat dispatch and replacement state after the module split.
    for (const text of [
        '!hide poke',
        '!show poke',
        '!hide burger',
        '!show burger',
        '!hide flow',
        '!show flow',
        '!hide cake',
        '!show cake'
    ]) {
        const result = await json('/api/activity/raw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'chat', data: { sender: 'ICBTestGuest', raw: text } })
        });
        assert.equal(result.response.status, 200);
        const board = {
            poke: 'sashimi',
            burger: 'beanburger-signup',
            flow: 'flowtree-signup',
            cake: 'party'
        }[text.split(' ')[1]];
        const state = (await json('/api/' + board)).payload;
        assert.equal(
            state.chatHidden,
            text.startsWith('!hide'),
            `${text}: cross-feature visibility changed`
        );
    }
    const root = path.resolve(__dirname, '../../..');
    /** Walk the moved HTML tree, preserving subdirectory URLs such as /wk/. */
    function pages(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const file = path.join(dir, entry.name);
            return entry.isDirectory() ? pages(file) : file.endsWith('.html') ? [file] : [];
        });
    }

    const checked = new Set();
    for (const file of pages(path.join(root, 'html'))) {
        const url =
            '/' +
            path
                .relative(path.join(root, 'html'), file)
                .split(path.sep)
                .map(encodeURIComponent)
                .join('/');
        const response = await fetch(origin + url);
        assert.equal(response.status, 200, url);
        const html = await response.text();
        for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
            const reference = match[1];
            if (!/^(\/|\.\.\/)(js|css|images)\//.test(reference)) continue;
            const target = new URL(reference, origin + url).href;
            if (checked.has(target)) continue;
            checked.add(target);
            const asset = await fetch(target);
            assert.equal(asset.status, 200, target);
            assert.ok((await asset.arrayBuffer()).byteLength, target);
        }
    }
    for (const url of ['/matter.min.js', '/meld-firehose.js'])
        assert.equal((await fetch(origin + url)).status, 200, url);
    for (const url of ['/data/live.json', '/js/server/config.js'])
        assert.equal((await fetch(origin + url)).status, 404, url);
    console.log(
        `Feature smoke checks passed: ${routes.length} API routes and ${checked.size} browser assets.`
    );
}

module.exports = { verifyFeatureRoutes };
