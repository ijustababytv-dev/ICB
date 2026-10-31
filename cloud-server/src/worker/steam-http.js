'use strict';
const https = require('node:https');

/** Bound provider calls by the invocation deadline; query credentials never enter logs or errors. */
function steamTransport(deadline, transport = https) {
    return (path) =>
        new Promise((resolve, reject) => {
            if (
                !/^\/(?:ISteamUser|ISteamUserStats)\/[A-Za-z]+\/v[12]\//.test(path) ||
                Date.now() + 1500 > deadline
            )
                return reject(new Error('Steam request budget exhausted.'));
            const request = transport.get(
                'https://api.steampowered.com' + path,
                {
                    timeout: Math.min(2500, deadline - Date.now() - 700),
                    headers: { 'User-Agent': 'ICB' }
                },
                (response) => {
                    const chunks = [];
                    let size = 0;
                    response.on('data', (chunk) => {
                        size += chunk.length;
                        if (size > 2000000) request.destroy(new Error('Steam response too large.'));
                        else chunks.push(chunk);
                    });
                    response.on('end', () => {
                        try {
                            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                            if (response.statusCode >= 400 && !value.playerstats) throw new Error();
                            resolve(value);
                        } catch (_) {
                            reject(
                                new Error('Steam request failed; check key and public profile.')
                            );
                        }
                    });
                    response.on('error', () => reject(new Error('Steam connection failed.')));
                }
            );
            request.on('timeout', () => request.destroy(new Error('Steam request timed out.')));
            request.on('error', () => reject(new Error('Steam connection failed.')));
        });
}

module.exports = { steamTransport };
