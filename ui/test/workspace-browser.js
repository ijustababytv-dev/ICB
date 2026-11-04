'use strict';
const fs = require('node:fs');
const { launchBrowser } = require('../../local-server/test/helpers/headless-browser');
const {
    startServer,
    waitForHealth,
    stopServer,
    port,
    json,
    temp
} = require('../../local-server/test/helpers/e2e-harness');

/** Run just the navigation workflow with disposable state/profile for focused layout verification. */
async function main() {
    let browser;
    try {
        startServer();
        await waitForHealth();
        browser = await launchBrowser();
        await require('./workspace').verifyWorkspace(browser, port, json);
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
