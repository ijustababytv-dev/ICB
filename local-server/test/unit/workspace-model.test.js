'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../../ui/js/navigation');

/** Load pure browser rules without a DOM, server, personal browser or real storage. */
function context(files) {
    const values = new Map();
    const fixture = {
        window: { dispatchEvent() {} },

        location: { origin: 'http://127.0.0.1:8791' },
        document: { createEvent: () => ({ initEvent() {} }) },

        URL,
        Date,
        localStorage: {
            getItem: (key) => values.get(key) || null,

            setItem: (key, value) => values.set(key, value)
        }
    };
    for (const file of files)
        vm.runInNewContext(fs.readFileSync(path.join(root, file + '.js'), 'utf8'), fixture);
    return { ...fixture, values };
}

test('Tight fuzzy search handles prefixes, accents, adjacent typos and multiple words without loose unrelated results', () => {
    const c = context(['catalog-tools', 'catalog-overlays', 'catalog-trackers', 'model']);
    const model = c.window.ICBNavModel,
        pages = model.catalog();
    for (const query of ['poke bowl', 'pkoe bowl', 'Poké bowl', 'pokebowl']) {
        const matches = model.search(pages, query);
        assert.ok(
            matches.some((page) => page.url === '/sashimi-signin-control.html'),
            query
        );
        assert.ok(
            matches.some((page) => page.url === '/sashimi-signin.html'),
            query
        );
        assert.ok(
            matches.some((page) => page.url === '/poke-bowl.html'),
            query
        );
        assert.ok(
            matches.every((page) => /Poke Bowl/.test(page.label)),
            query
        );
    }
    assert.equal(model.search(pages, 'poke dashboard').length, 1);
    assert.equal(model.search(pages, 'steam api key')[0].url, '/steam-control.html');
    assert.equal(model.search(pages, 'history')[0].url, '/recent-pages.html');
    assert.equal(model.search(pages, 'directory')[0].url, '/all-pages.html');
    assert.equal(model.search(pages, 'plushie wheel')[0].url, '/tradeup-control.html');
    assert.equal(model.search(pages, 'zzqx blueberry spaceship').length, 0);
    assert.equal(model.search(pages, 'poke spaceship').length, 0);
    assert.equal(model.search(pages, 'p').length, 0);
    assert.ok(model.search(pages, 'po').length > 1);
    const sorted = model.alphabetical(pages);
    for (let i = 1; i < sorted.length; i++)
        assert.ok(
            model.normalize(sorted[i - 1].label).localeCompare(model.normalize(sorted[i].label)) <=
                0
        );
    assert.equal(
        model.categories.map((category) => category.label).join('|'),
        'Stream tools|Community & games|Overlays & widgets|Decor & effects|Activity reports|Connections'
    );
    assert.equal(model.safeURL('javascript:alert(1)'), null);
    assert.equal(model.safeURL('https://user:password@example.com'), null);
    assert.equal(model.safeURL('/hub.html'), '/');
});

test('Recent history is owner-scoped, query-free, bounded and sorted by each page’s last opening', () => {
    const c = context(['visits']),
        visits = c.window.ICBVisits,
        now = Date.now();
    visits.open('owner-one', '/control.html?private=never-stored#details', now - 3000);
    visits.open('owner-one', '/poke-bowl.html', now - 2000);
    visits.open('owner-one', '/control.html', now - 1000);
    assert.equal(visits.read('owner-one').length, 2);
    assert.equal(visits.read('owner-one')[0].url, '/control.html');
    assert.equal(visits.read('owner-two').length, 0);
    visits.open('owner-two', '/steam-control.html', now - 500);
    assert.equal(visits.read('owner-one').length, 2);
    const raw = c.values.get(visits.key('owner-one'));
    assert.ok(!raw.includes('private') && !raw.includes('#details'));
    assert.equal(Object.keys(JSON.parse(raw)[0]).sort().join(','), 'openedAt,url');
    for (const url of [
        '/',
        '/hub.html',
        '/cloud.html',
        '/all-pages.html',
        '/recent-pages.html',
        '//evil.html',
        '/api/state',
        '/bad\\name.html'
    ])
        assert.equal(visits.open('owner-one', url), false, url);
    assert.equal(
        visits.clean(
            [
                { url: '/one.html', openedAt: Infinity },
                { url: '/two.html', openedAt: now + 120000 },
                { url: '/three.html', openedAt: 0 }
            ],
            now
        ).length,
        0
    );
    c.values.set(visits.key('owner-one'), '{broken');
    assert.doesNotThrow(() => visits.read('owner-one'));
    c.localStorage.setItem = () => {
        throw new Error('quota full');
    };

    assert.equal(visits.open('quota-owner', '/control.html', now), true);
    assert.equal(
        visits.read('quota-owner').length,
        1,
        'Working reads do not conceal an unsaved quota-fallback visit'
    );
    c.localStorage.getItem = () => {
        throw new Error('blocked');
    };

    c.localStorage.setItem = () => {
        throw new Error('full');
    };

    assert.equal(visits.open('owner-three', '/control.html', now), true);
    assert.equal(visits.read('owner-three').length, 1);
});

test('Account-created links cannot shadow built-ins or inject unsafe URL protocols', () => {
    const c = context(['catalog-tools', 'catalog-overlays', 'catalog-trackers', 'model']);
    const model = c.window.ICBNavModel;
    const pages = model.catalog([
        { url: '/control.html', label: 'Untrusted replacement', category: 'connections' },
        { url: 'javascript:alert(1)', label: 'Invalid link', category: 'connections' },
        { url: '/decor/custom.html', label: '<img src=x> — Decor Overlay', category: 'decor' },
        { url: '', label: 'Missing URL', category: 'connections' },
        null
    ]);
    assert.equal(
        pages.find((page) => page.url === '/control.html').label,
        'Tracker Command Center'
    );
    assert.ok(!pages.some((page) => page.url.startsWith('javascript:')));
    assert.equal(
        pages.find((page) => page.url === '/decor/custom.html').label,
        '<img src=x> — Decor Overlay'
    );
    assert.equal(new Set(pages.map((page) => page.url)).size, pages.length);
});
