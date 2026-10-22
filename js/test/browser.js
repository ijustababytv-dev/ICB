'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('./helpers/headless-browser');
const { port, temp, startServer, stopServer, waitForHealth, json } = require('./helpers/e2e-harness');

/** Validate moved scripts in a headless browser using temporary ICB state only. */
async function main() {
  let browser;
  try {
    startServer(); await waitForHealth(); browser = await launchBrowser();
    for (const name of ['hub', 'control', 'giveaway-control', 'giveaway-entrants', 'unicorn-jar', 'sprite-jar', 'party-control', 'beanburger-signup-control', 'flowtree-signup-control']) {
      const page = await browser.newPage();
      await page.navigate(`http://127.0.0.1:${port}/${name}.html`);
      await page.evaluate('new Promise(function(resolve) { setTimeout(resolve, 1800); })');
      assert.deepEqual(page.errors, [], `${name}: JavaScript errors`);
      const codeFailures = page.failures.filter(url => /\/(js|css|images)\//.test(url));
      assert.deepEqual(codeFailures, [], `${name}: missing code, styles, or extracted images`);
      if (name === 'unicorn-jar') {
        const state = await page.evaluate('({ engine: !!window.ICBJar.engine, width: window.ICBJar.canvas.width, imageLoaded: window.ICBJar.UNI.complete && window.ICBJar.UNI.naturalWidth > 0 })');
        assert.equal(state.engine, true); assert.equal(state.width, 1280); assert.equal(state.imageLoaded, true);
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        await json('/api/giveaway/manual', { ...options, body: JSON.stringify({ username: 'BrowserTestGuest', amount: 5 }) });
        await page.evaluate('new Promise(function(resolve) { setTimeout(resolve, 1300); })');
        assert.equal(await page.evaluate('window.__jar.state().total'), 5);
        await json('/api/giveaway/draw-test', { ...options, body: '{}' });
        await page.evaluate('new Promise(function(resolve) { setTimeout(resolve, 1300); })');
        assert.equal(await page.evaluate('window.__jar.state().isTest'), true);
        assert.deepEqual(page.errors, [], 'unicorn-jar: count updates and drawing animation');
      }
      if (process.env.ICB_TEST_SCREENSHOTS && ['control', 'giveaway-control', 'unicorn-jar'].includes(name)) {
        fs.mkdirSync(process.env.ICB_TEST_SCREENSHOTS, { recursive: true });
        await page.screenshot(path.join(process.env.ICB_TEST_SCREENSHOTS, name + '.png'));
      }
      await page.close();
    }
    console.log('Headless browser checks passed: 9 dashboards/overlays; no user desktop or browser session used.');
  } finally {
    if (browser) await browser.close();
    await stopServer();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
