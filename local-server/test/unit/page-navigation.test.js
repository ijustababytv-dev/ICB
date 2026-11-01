'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const htmlRoot = path.join(root, 'ui/html');
const operatorExtras = [
    'hub',
    'control',
    'giveaway-report',
    'Aniimo Tracker',
    'all-pages',
    'recent-pages'
];

/** Read the same public catalog used by sidebar, search and directory. */
function catalog() {
    const context = { window: {} };
    for (const name of ['tools', 'overlays', 'trackers'])
        vm.runInNewContext(
            fs.readFileSync(path.join(root, 'ui/js/navigation/catalog-' + name + '.js'), 'utf8'),
            context
        );
    return context.window.ICBPageCatalog;
}

/** Inventory real static pages, including nested listener aliases. */
function pages(folder = htmlRoot) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? pages(file) : file.endsWith('.html') ? [file] : [];
    });
}

test('Shared catalog contains every static page and every configured resource card exactly once', () => {
    const home = fs.readFileSync(path.join(htmlRoot, 'hub.html'), 'utf8');
    const entries = catalog();
    const destinations = new Set(entries.map((entry) => entry.url));
    assert.equal(destinations.size, entries.length);
    const sections = new Set([
        'stream',
        'community',
        'overlays',
        'decor',
        'reports',
        'connections'
    ]);
    for (const entry of entries)
        assert.ok(
            ['/', '/all-pages.html'].includes(entry.url) || sections.has(entry.category),
            entry.url + ': every destination must have a sidebar section'
        );
    const legacyHub = fs.readFileSync(
        path.join(root, 'cloud-server/src/features/models/hub.js'),
        'utf8'
    );
    for (const match of legacyHub.matchAll(/url: '([^']+)'/g))
        assert.ok(
            destinations.has(match[1]),
            match[1] + ': former Home tile remains in navigation'
        );
    destinations.add('/hub.html'); // The canonical Home destination is /.
    for (const file of pages()) {
        const url = '/' + path.relative(htmlRoot, file).replace(/\\/g, '/');
        assert.ok(destinations.has(url), `${url} must be discoverable from Home`);
    }
    const cards = require('../../config/resource-trackers.json').cards;
    for (const card of cards) assert.ok(destinations.has('/' + card.id + '.html'), card.id);
    for (const url of ['/weekly.html', '/weekly-wide.html', '/ticker.html', '/decor/all.html'])
        assert.ok(destinations.has(url), url);
    assert.ok(home.indexOf('id="ws-recent-panels"') < home.indexOf('id="rz"'));
    assert.doesNotMatch(
        home,
        /class="page-directory"|id="dashboardPages"|Pinned tools|Browse all pages|ws-settings|id="grid"|id="cName"/
    );
    assert.match(home, /href="\/recent-pages.html">View all Recent Pages/);
    for (const [url, label] of [
        ['sashimi-signin-control', 'Poke Bowl — Sign-up Dashboard'],
        ['sashimi-signin', 'Poke Bowl — Sign-up Overlay'],
        ['poke-bowl', 'Poke Bowl — Cooking Tracker'],
        ['beanburger-signup-control', 'Bean Burger — Sign-up Dashboard'],
        ['beanburger-signup', 'Bean Burger — Sign-up Overlay'],
        ['bean-burger', 'Bean Burger — Cooking Tracker']
    ])
        assert.equal(entries.find((entry) => entry.url === '/' + url + '.html').label, label);
    for (const card of cards) {
        assert.match(
            entries.find((entry) => entry.url === '/' + card.id + '.html').label,
            / — .+Tracker$/,
            card.id + ': tracker purpose'
        );
    }
    const login = fs.readFileSync(path.join(htmlRoot, 'cloud.html'), 'utf8');
    assert.match(
        login,
        /<form id="login" method="post" action="\/api\/cloud\/login">/,
        'A script-loading failure must never put passwords into a native GET URL'
    );
});

test('Operator pages share workspace navigation while login, overlays and the compact widget stay independent', () => {
    for (const file of pages()) {
        const content = fs.readFileSync(file, 'utf8');
        const name = path.basename(file, '.html');
        const operator = name.endsWith('-control') || operatorExtras.includes(name);
        const links = [...content.matchAll(/<nav class="icb-page-nav"[\s\S]*?<\/nav>/g)];
        assert.equal(links.length, name === 'aniimo-quick' ? 2 : 0, name);
        assert.equal(content.includes('data-workspace="true"'), operator, name);
        if (operator) {
            assert.match(content, /id="workspace-sidebar"/);
            assert.match(content, /id="workspace-topbar"/);
            assert.match(content, /navigation\/shell.js/);
        } else {
            assert.ok(!content.includes('/css/workspace.css'), name + ': no workspace chrome');
        }
        if (name === 'aniimo-quick') continue;
        if (!operator) {
            assert.ok(
                !content.includes('/css/page-navigation.css'),
                name + ': overlay CSS isolation'
            );
            continue;
        }
    }
});
