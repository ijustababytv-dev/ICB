'use strict';
const https = require('node:https');

/** Make bounded HTTPS requests from Node only; browsers never receive cloud bearer tokens. */
function request(base, route, method = 'GET', body, token) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(base);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
                throw new Error();
            if (!route.startsWith('/') || route.startsWith('//') || route.includes('#'))
                throw new Error();
            const target = new URL(route, 'https://route.invalid');
            url.pathname = url.pathname.replace(/\/$/, '') + target.pathname;
            url.search = target.search;
        } catch (_error) {
            return reject(new Error('invalid_cloud_url'));
        }
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = https.request(
            url,
            {
                method,
                timeout: 10000,
                headers: {
                    Accept: 'application/json',
                    ...(payload
                        ? {
                              'Content-Type': 'application/json',
                              'Content-Length': Buffer.byteLength(payload)
                          }
                        : {}),
                    ...(token ? { Authorization: 'Bearer ' + token } : {})
                }
            },
            (res) => {
                const chunks = [];
                let size = 0;
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > 4 * 1024 * 1024) req.destroy(new Error('cloud_response_too_large'));
                    else chunks.push(chunk);
                });
                res.on('end', () => {
                    try {
                        resolve({
                            status: res.statusCode,
                            data: JSON.parse(Buffer.concat(chunks).toString('utf8'))
                        });
                    } catch (_error) {
                        reject(new Error('invalid_cloud_response'));
                    }
                });
                res.on('error', () => reject(new Error('cloud_connection_failed')));
            }
        );
        req.on('timeout', () => req.destroy(new Error('cloud_timeout')));
        req.on('error', () => reject(new Error('cloud_connection_failed')));
        req.end(payload);
    });
}

module.exports = { request };
