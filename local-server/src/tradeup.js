'use strict';
const feed = require('./cloud/state-feed');
const { serveArt } = require('./assets/public-files');

/** The local wheel only relays confirmed game state. */
function tradeupPublicState() {
    return (
        feed.watch('/api/tradeup/state') || {
            ok: false,
            board: [],
            revealed: null,
            spinSeq: 0,
            log: []
        }
    );
}

/** Wheel picture files keep their established local URLs. */
function serveTradeupArt(res, pathname) {
    return serveArt(res, pathname, '/tradeup-art/', 'tradeup');
}

module.exports = { tradeupPublicState, serveTradeupArt };
