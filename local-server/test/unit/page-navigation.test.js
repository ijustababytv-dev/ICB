'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const htmlRoot = path.join(root, 'ui/html');
const operatorExtras = [
    'hub',
    'cloud',
    'control',
    'giveaway-report',
    'Aniimo Tracker',
    'aniimo-quick'
];

/** Inventory real static pages, including nested listener aliases. */
function pages(folder = htmlRoot) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? pages(file) : file.endsWith('.html') ? [file] : [];
    });
}

test('Home links to every static page and every configured resource card before login', () => {
    const home = fs.readFileSync(path.join(htmlRoot, 'hub.html'), 'utf8');
    const destinations = new Set([...home.matchAll(/href="([^"]+)"/g)].map((match) => match[1]));
    destinations.add('/hub.html'); // The canonical Home destination is /.
    for (const file of pages()) {
        const url = '/' + path.relative(htmlRoot, file).replace(/\\/g, '/');
        assert.ok(destinations.has(url), `${url} must be discoverable from Home`);
    }
    const cards = require('../../config/resource-trackers.json').cards;
    for (const card of cards) assert.ok(destinations.has('/' + card.id + '.html'), card.id);
    for (const url of ['/weekly.html', '/weekly-wide.html', '/ticker.html', '/decor/all.html'])
        assert.ok(destinations.has(url), url);
    assert.ok(home.indexOf('id="dashboardPages"') < home.indexOf('id="rz"'));
    assert.match(home, /href="\/cloud.html" class="page-signin"/);
});

test('All operator pages have static top and bottom arrow links; overlays stay clean', () => {
    for (const file of pages()) {
        const content = fs.readFileSync(file, 'utf8');
        const name = path.basename(file, '.html');
        const operator = name.endsWith('-control') || operatorExtras.includes(name);
        const links = [...content.matchAll(/<nav class="icb-page-nav"[\s\S]*?<\/nav>/g)];
        assert.equal(links.length, operator ? 2 : 0, name);
        if (!operator) {
            assert.ok(
                !content.includes('/css/page-navigation.css'),
                name + ': overlay CSS isolation'
            );
            continue;
        }
        assert.match(content, /href="\/css\/page-navigation.css"/);
        assert.match(content, /<body[^>]*>\s*<nav class="icb-page-nav"/, name + ': top navigation');
        for (const link of links) {
            assert.match(link[0], /class="icb-home-link" href="\/"/);
            assert.match(link[0], /&larr;/);
            assert.match(link[0], /href="\/cloud.html"/);
        }
        assert.match(links[1][0], /Page navigation \(bottom\)/);
        assert.ok(content.indexOf(links[1][0]) > content.lastIndexOf('</main>'));
    }
});
