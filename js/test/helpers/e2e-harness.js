const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const port = 8791;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-clean-test-'));
const logFile = path.join(temp, 'app-test.log');
fs.writeFileSync(logFile, 'old history is ignored\n', 'utf8');
const staleTime = new Date(Date.now() - 11 * 60 * 1000);
fs.utimesSync(logFile, staleTime, staleTime);
fs.writeFileSync(
    path.join(temp, 'live.json'),
    `${JSON.stringify(
        {
            schemaVersion: 1,
            resources: { amber: null, essence: null, sweetLeaf: null },
            session: { mode: 'offline' },
            reader: {
                state: 'needs-reconciliation',
                file: null,
                fileModifiedAt: null,
                lastEvent: null,
                lastUpdateAt: null
            },
            reconciliation: {
                required: true,
                reason: 'test fixture',
                historicalBaseline: { amber: 1, essence: 2, sweetLeaf: 3 },
                reconciledAt: null
            },
            updatedAt: null
        },
        null,
        2
    )}\n`,
    'utf8'
);

let child;
let stderr = '';

function startServer() {
    stderr = '';
    child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'index.js')], {
        env: {
            ...process.env,
            ICB_CLEAN_PORT: String(port),
            ICB_CLEAN_DATA_DIR: temp,
            ICB_CLEAN_PALIA_LOG_FILE: logFile
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (!child || child.exitCode !== null) return resolve();
        const timer = setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
            resolve();
        }, 3000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill();
    });
}

async function waitForHealth() {
    for (let i = 0; i < 50; i += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (response.ok) return response.json();
        } catch (_error) {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start. ${stderr}`);
}

async function json(pathname, options) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
    return { response, payload: await response.json() };
}

function listenForSseEvent(eventName, predicate = () => true) {
    let resolveReady;
    let rejectReady;
    let resolveEvent;
    let rejectEvent;
    const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const event = new Promise((resolve, reject) => {
        resolveEvent = resolve;
        rejectEvent = reject;
    });
    let response;
    let buffer = '';
    const request = http.get(`http://127.0.0.1:${port}/events`, (nextResponse) => {
        response = nextResponse;
        response.setEncoding('utf8');
        resolveReady();
        response.on('data', (chunk) => {
            buffer += chunk;
            let separator;
            while ((separator = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, separator);
                buffer = buffer.slice(separator + 2);
                const lines = block.split('\n');
                const receivedEvent = lines.find((line) => line.startsWith('event: '))?.slice(7);
                const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
                if (receivedEvent !== eventName || !data) continue;
                try {
                    const payload = JSON.parse(data);
                    if (!predicate(payload)) continue;
                    cleanup();
                    resolveEvent(payload);
                } catch (error) {
                    cleanup();
                    rejectEvent(error);
                }
            }
        });
    });
    const timer = setTimeout(() => {
        cleanup();
        rejectEvent(new Error(`Timed out waiting for SSE event: ${eventName}`));
    }, 8000);
    request.on('error', (error) => {
        cleanup();
        rejectReady(error);
        rejectEvent(error);
    });
    function cleanup() {
        clearTimeout(timer);
        request.destroy();
        response?.destroy();
    }

    return { ready, event };
}

module.exports = {
    port,
    temp,
    logFile,
    startServer,
    stopServer,
    waitForHealth,
    json,
    listenForSseEvent
};
