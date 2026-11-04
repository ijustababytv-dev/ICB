'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../../local-server/test/helpers/headless-browser');
const {
    port,
    temp,
    startServer,
    stopServer,
    waitForHealth
} = require('../../local-server/test/helpers/e2e-harness');
const base = 'http://127.0.0.1:' + port;

/** Wait on observable browser behavior, not a live server, personal browser or AWS account. */
async function wait(page, expression) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        try {
            if (await page.evaluate('Boolean(' + expression + ')')) return;
        } catch (error) {
            if (!/context|navigat/i.test(error.message)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Auth browser condition timed out: ' + expression);
}

/** Test the actual login boundary, encrypted restart restoration and logout with disposable Windows state. */
async function main() {
    let browser;
    try {
        startServer({ auth: true });
        await waitForHealth({ allowSignedOut: true });
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.navigate(base + '/control.html');
        await wait(
            page,
            "location.pathname==='/cloud.html' && !!document.getElementById('signin') && !document.getElementById('signin').disabled"
        );
        assert.match(await page.evaluate('location.search'), /next=/);
        for (const route of ['/api/state', '/events', '/assets/private.png'])
            assert.equal((await fetch(base + route)).status, 401, route);
        await page.evaluate(`(function() {
            document.getElementById('username').value='FIXTURE';
            document.getElementById('password').value='wrong-fixture-password';
            document.getElementById('login').requestSubmit();
        })()`);
        await wait(page, "document.getElementById('result').dataset.error==='true'");
        assert.equal(await page.evaluate("document.getElementById('password').value"), '');
        assert.equal((await fetch(base + '/api/state')).status, 401);
        await page.evaluate(`(function() {
            document.getElementById('password').value='FixturePassword123!';
            document.getElementById('login').requestSubmit();
        })()`);
        await wait(
            page,
            "location.pathname==='/control.html' && !!document.querySelector('#workspace-sidebar')"
        );
        const status = await (await fetch(base + '/api/cloud/status')).json();
        assert.equal(status.signed_in, true);
        assert.equal(status.remembered, true);
        const expiry = status.expires_at;
        const saved = path.join(temp, '.cloud-session.dpapi');
        assert.equal(fs.existsSync(saved), true);
        assert.ok(!fs.readFileSync(saved).includes(Buffer.from('t'.repeat(43))));
        assert.ok(!fs.readFileSync(saved).includes(Buffer.from('FixturePassword123!')));
        await stopServer();
        startServer({ auth: true });
        await waitForHealth({ allowSignedOut: true });
        await page.navigate(base + '/cloud.html?startup=1');
        await wait(
            page,
            "location.pathname==='/hub.html' || (location.pathname==='/' && !!document.getElementById('ws-recent-panels'))"
        );
        const restored = await (await fetch(base + '/api/cloud/status')).json();
        assert.equal(restored.signed_in, true);
        assert.equal(restored.expires_at, expiry, 'Restart must not renew the 14-day deadline');
        const overlay = await browser.newPage();
        await overlay.navigate(base + '/ocean-fish.html');
        await wait(overlay, "location.pathname==='/ocean-fish.html' && !!document.body");
        const account = await browser.newPage();
        await account.navigate(base + '/cloud.html');
        await wait(
            account,
            "!!document.getElementById('logout') && !document.getElementById('logout').hidden"
        );
        await account.evaluate("document.getElementById('logout').click()");
        await wait(
            page,
            "location.pathname==='/cloud.html' && !!document.getElementById('password')"
        );
        await wait(
            overlay,
            "location.pathname==='/cloud.html' && !!document.getElementById('password')"
        );
        assert.equal(fs.existsSync(saved), false);
        assert.equal((await fetch(base + '/events')).status, 401);
        await stopServer();
        startServer({ auth: true });
        await waitForHealth({ allowSignedOut: true });
        assert.equal((await (await fetch(base + '/api/cloud/status')).json()).signed_in, false);
        console.log(
            'Auth browser checks passed: gated controls/APIs/overlays, wrong-password rejection, DPAPI restart restore, fixed expiry and cross-tab logout.'
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
