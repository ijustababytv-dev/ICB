'use strict';

const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Bound request size and decode JSON before any feature mutates its state. */
function readBody(req, limit = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                body = '';
                reject(new Error('Request body is too large.'));
                return;
            }
            body += chunk;
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
