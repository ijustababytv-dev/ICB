'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Inventory operator pages, including the new directory/history and independent compact widget. */
function operatorPages() {
    return fs
        .readdirSync(path.resolve(__dirname, '../html'))
        .filter(
            (name) =>
                name.endsWith('-control.html') ||
                [
                    'hub.html',
                    'cloud.html',
                    'control.html',
                    'giveaway-report.html',
                    'Aniimo Tracker.html',
                    'aniimo-quick.html',
                    'all-pages.html',
                    'recent-pages.html'
                ].includes(name)
        )
        .map((name) => name.slice(0, -5));
}

/** Confirm shared navigation stays off login/Meld layers and every dashboard gets searchable sections. */
async function verifyNavigation(page, name) {
    const workspace = !['cloud', 'aniimo-quick'].includes(name) && operatorPages().includes(name);
    const state = await page.evaluate(`({
        bars:document.querySelectorAll('.icb-page-nav').length,
        sidebars:document.querySelectorAll('#workspace-sidebar').length,
        search:!!document.getElementById('ws-page-search'),
        sections:Array.from(document.querySelectorAll('.ws-category summary span:last-child')).map(function(node){return node.textContent;})
    })`);
    assert.equal(state.bars, name === 'aniimo-quick' ? 2 : 0, name + ': old navigation scope');
    assert.equal(state.sidebars, workspace ? 1 : 0, name + ': sidebar scope');
    assert.equal(state.search, workspace, name + ': page search scope');
    if (workspace)
        assert.deepEqual(state.sections, [
            'Stream tools',
            'Community & games',
            'Overlays & widgets',
            'Decor & effects',
            'Activity reports',
            'Connections'
        ]);
    if (['hub', 'cloud', 'aniimo-quick', 'all-pages', 'recent-pages'].includes(name)) {
        for (const width of [390, 1280]) {
            await page.setViewport(width, 900);
            assert.equal(
                await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),
                true,
                name + ': horizontal overflow at ' + width
            );
        }
    }
    if (name === 'cloud') {
        const form = await page.evaluate(`({
            password:document.getElementById('password').type,
            autocomplete:document.getElementById('password').autocomplete,
            label:document.querySelector('label[for="password"]').textContent,
            result:document.getElementById('result').getAttribute('role'),
            panel:getComputedStyle(document.querySelector('.account-page .card')).backgroundColor,
            cards:document.querySelectorAll('.account-page .card').length,
            diagnostics:!!document.querySelector('#cloudStatus, #statusTitle'),
            width:document.querySelector('.account-page').getBoundingClientRect().width
        })`);
        assert.equal(form.password, 'password');
        assert.equal(form.autocomplete, 'current-password');
        assert.equal(form.label, 'Password');
        assert.equal(form.result, 'status');
        assert.equal(form.panel, 'rgb(29, 22, 40)');
        assert.equal(form.cards, 1, 'Login contains only its form card');
        assert.equal(form.diagnostics, false, 'No account/sync information panel');
        assert.ok(form.width <= 520, 'Single centered sign-in column');
    }
}

module.exports = { operatorPages, verifyNavigation };
