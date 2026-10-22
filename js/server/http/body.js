'use strict';

const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Bound request size and decode JSON before any feature mutates its state. */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY_BYTES) reject(new Error('Request body is too large.'));
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (_error) {
                reject(new Error('Request body must be valid JSON.'));
            }
        });
        req.on('error', reject);
    });
}

Object.assign(exports, { readBody });
