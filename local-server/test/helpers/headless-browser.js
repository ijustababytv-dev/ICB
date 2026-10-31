'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** Start an isolated, invisible Chrome process; never attach to the user's browser/profile. */
async function launchBrowser() {
    const executable =
        process.env.ICB_TEST_CHROME ||
        [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome'
        ].find((file) => fs.existsSync(file));
    if (!executable)
        throw new Error('Set ICB_TEST_CHROME to a Chromium executable for browser checks.');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-headless-'));
    const child = spawn(
        executable,
        [
            '--headless',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--remote-debugging-port=0',
            `--user-data-dir=${profile}`,
            'about:blank'
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
    );
    const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(
            () => reject(new Error('Headless Chrome did not start.')),
            15000
        );
        child.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.stderr.on('data', (chunk) => {
            output += chunk;
            const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
            if (match) {
                clearTimeout(timeout);
                resolve(match[1]);
            }
        });
    });
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let seq = 1;
    const pending = new Map(),
        listeners = new Set();
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const request = pending.get(message.id);
            if (!request) return;
            clearTimeout(request.timeout);
            pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result);
        } else for (const listener of listeners) listener(message);
    });

    /** Send one DevTools request with a bounded wait so failures cannot strand the test. */
    function send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = seq++;
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Browser request timed out: ${method}`));
            }, 15000);
            pending.set(id, { resolve, reject, timeout });
            socket.send(
                JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
            );
        });
    }

    /** Open a test-owned target with error collection and an isolated viewport. */
    async function newPage() {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const errors = [],
            failures = [];
        const listener = (event) => {
            if (event.sessionId !== sessionId) return;
            if (event.method === 'Runtime.exceptionThrown')
                errors.push(
                    event.params.exceptionDetails.exception?.description ||
                        event.params.exceptionDetails.text
                );
            if (event.method === 'Network.responseReceived' && event.params.response.status >= 400)
                failures.push(event.params.response.url);
        };

        listeners.add(listener);
        await send('Runtime.enable', {}, sessionId);
        await send('Page.enable', {}, sessionId);
        await send('Network.enable', {}, sessionId);
        await send(
            'Emulation.setDeviceMetricsOverride',
            { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
            sessionId
        );
        return {
            errors,
            failures,
            navigate: (url) => send('Page.navigate', { url }, sessionId),

            evaluate: async (expression) => {
                const result = await send(
                    'Runtime.evaluate',
                    { expression, returnByValue: true, awaitPromise: true },
                    sessionId
                );
                if (result.exceptionDetails)
                    throw new Error(
                        result.exceptionDetails.exception?.description ||
                            result.exceptionDetails.text
                    );
                return result.result.value;
            },

            screenshot: async (file) => {
                const result = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
                fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
            },

            close: async () => {
                listeners.delete(listener);
                await send('Target.closeTarget', { targetId });
            }
        };
    }

    /** Close only the test-owned browser and remove only its temporary profile. */
    async function close() {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        await send('Browser.close').catch(() => {});
        const timer = setTimeout(() => child.kill(), 3000);
        await exited;
        clearTimeout(timer);
        socket.close();
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }

    return { newPage, close };
}

module.exports = { launchBrowser };
