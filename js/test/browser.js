'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('./helpers/headless-browser');
const { verifySpriteTvPage, verifySignupPage } = require('./helpers/feature-browser');
const {
    port,
    temp,
    startServer,
    stopServer,
    waitForHealth,
    json
} = require('./helpers/e2e-harness');

/** Validate moved scripts in a headless browser using temporary ICB state only. */
async function main() {
    let browser;
    try {
        startServer();
        await waitForHealth();
        browser = await launchBrowser();
        const pages = [
            'hub',
            'control',
            'giveaway-control',
            'giveaway-entrants',
            'unicorn-jar',
            'sprite-jar',
            'sprite-tv-control',
            'sprite-tv',
            'sashimi-signin-control',
            'sashimi-signin',
            'party-control',
            'beanburger-signup-control',
            'flowtree-signup-control',
            'aniimo-control',
            'Aniimo Tracker',
            'giveaway-report',
            'hunt-control',
            'sprites-control',
            'tradeup-board',
            'walkers'
        ];
        for (const name of pages) {
            const page = await browser.newPage();
            await page.navigate(`http://127.0.0.1:${port}/${encodeURIComponent(name)}.html`);
            await page.evaluate('new Promise(function(resolve) { setTimeout(resolve, 1800); })');
            assert.deepEqual(page.errors, [], `${name}: JavaScript errors`);
            const codeFailures = page.failures.filter((url) => /\/(js|css|images)\//.test(url));
            assert.deepEqual(
                codeFailures,
                [],
                `${name}: missing code, styles, or extracted images`
            );
            if (name === 'unicorn-jar') {
                const state = await page.evaluate(
                    '({ engine: !!window.ICBJar.engine, width: window.ICBJar.canvas.width, imageLoaded: window.ICBJar.UNI.complete && window.ICBJar.UNI.naturalWidth > 0 })'
                );
                assert.equal(state.engine, true);
                assert.equal(state.width, 1280);
                assert.equal(state.imageLoaded, true);
                const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
                await json('/api/giveaway/manual', {
                    ...options,
                    body: JSON.stringify({ username: 'BrowserTestGuest', amount: 5 })
                });
                await page.evaluate(
                    'new Promise(function(resolve) { setTimeout(resolve, 1300); })'
                );
                assert.equal(await page.evaluate('window.__jar.state().total'), 5);
                await json('/api/giveaway/draw-test', { ...options, body: '{}' });
                await page.evaluate(
                    'new Promise(function(resolve) { setTimeout(resolve, 1300); })'
                );
                assert.equal(await page.evaluate('window.__jar.state().isTest'), true);
                assert.deepEqual(
                    page.errors,
                    [],
                    'unicorn-jar: count updates and drawing animation'
                );
            }
            if (name === 'aniimo-control') {
                const editor = await page.evaluate(`(function () {
                    var entry = S.roster[0];
                    editA(entry.id);
                    var name = $('mName').value;
                    closeM();
                    openForm(entry.id, entry.variants[0]);
                    var visible = $('fmodal').className;
                    closeForm();
                    return { name: name, expected: entry.name, visible: visible };
                })()`);
                assert.equal(editor.name, editor.expected);
                assert.equal(editor.visible, 'modal on');
            }
            if (name === 'walkers') {
                const result = await json('/api/walkers/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'BrowserWalker', text: 'Test animation' })
                });
                assert.equal(result.response.status, 200);
                await page.evaluate(
                    'new Promise(function(resolve) { setTimeout(resolve, 1800); })'
                );
                assert.ok(
                    await page.evaluate(
                        "document.getElementById('stage').textContent.includes('BrowserWalker')"
                    )
                );
            }
            assert.deepEqual(page.errors, [], `${name}: interaction and animation errors`);
            if (name === 'sprite-tv' || name === 'sprite-tv-control')
                await verifySpriteTvPage(page, json, name === 'sprite-tv');
            if (name === 'sashimi-signin' || name === 'sashimi-signin-control')
                await verifySignupPage(page, json, name === 'sashimi-signin');
            assert.deepEqual(page.errors, [], `${name}: migrated feature interactions`);
            if (
                process.env.ICB_TEST_SCREENSHOTS &&
                [
                    'control',
                    'giveaway-control',
                    'unicorn-jar',
                    'sprite-tv-control',
                    'sprite-tv',
                    'sashimi-signin-control'
                ].includes(name)
            ) {
                fs.mkdirSync(process.env.ICB_TEST_SCREENSHOTS, { recursive: true });
                await page.screenshot(path.join(process.env.ICB_TEST_SCREENSHOTS, name + '.png'));
            }
            await page.close();
        }
        console.log(
            `Headless browser checks passed: ${pages.length} dashboards/overlays; no user desktop or browser session used.`
        );
    } finally {
        if (browser) await browser.close();
        await stopServer();
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
