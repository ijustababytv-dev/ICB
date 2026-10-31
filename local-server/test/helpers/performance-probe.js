'use strict';
// Explicit test-only preload. Production entry points never import this instrumentation.
const fs = require('node:fs');
const https = require('node:https');
let writes = 0;
let written = 0;
let uploaded = 0;
let downloaded = 0;
const intervals = new Set();
const calls = {};
const originalInterval = global.setInterval;
const originalClear = global.clearInterval;
global.setInterval = function (...args) {
    const timer = originalInterval(...args);
    intervals.add(timer);
    return timer;
};

global.clearInterval = function (timer) {
    intervals.delete(timer);
    return originalClear(timer);
};

for (const name of ['writeFileSync', 'appendFileSync']) {
    const original = fs[name];
    fs[name] = function (file, value, ...rest) {
        writes++;
        written += typeof value === 'string' ? Buffer.byteLength(value) : value?.length || 0;
        return original.call(this, file, value, ...rest);
    };
}
const originalRequest = https.request;
https.request = function (url, ...args) {
    const pathname = url instanceof URL ? url.pathname : 'other';
    const key = pathname.includes('/v1/features/state')
        ? 'shared_feed'
        : pathname.includes('/commands')
        ? 'feature_command'
        : pathname.includes('/v1/activity/')
        ? 'report_upload'
        : 'other';
    calls[key] = (calls[key] || 0) + 1;
    const callback = args.at(-1);
    if (typeof callback === 'function')
        args[args.length - 1] = (res) => {
            res.on('data', (bytes) => {
                downloaded += bytes.length;
            });
            callback(res);
        };

    const req = originalRequest.call(this, url, ...args);
    const end = req.end;
    req.end = function (payload, ...rest) {
        uploaded += typeof payload === 'string' ? Buffer.byteLength(payload) : payload?.length || 0;
        return end.call(this, payload, ...rest);
    };

    return req;
};

let start;
process.on('message', (message) => {
    if (message === 'measure-start') {
        writes = 0;
        written = 0;
        uploaded = 0;
        downloaded = 0;
        for (const key of Object.keys(calls)) delete calls[key];
        start = { cpu: process.cpuUsage(), at: Date.now() };
        process.send({ started: true });
    }
    if (message === 'measure-stop' && start) {
        const cpu = process.cpuUsage(start.cpu);
        process.send({
            milliseconds: Date.now() - start.at,
            cpu_ms: (cpu.user + cpu.system) / 1000,
            rss_mb: process.memoryUsage().rss / 1048576,
            heap_mb: process.memoryUsage().heapUsed / 1048576,
            synchronous_writes: writes,
            written_bytes: written,
            intervals: intervals.size,
            cloud_requests: calls,
            upload_bytes: uploaded,
            download_bytes: downloaded
        });
    }
});
