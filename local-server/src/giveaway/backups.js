'use strict';

/** Diagnostics display cloud backup metadata; this computer creates no feature backups. */
function listGiveawayBackups() {
    return require('../cloud/state-feed').watch('/api/giveaway/backups')?.backups || [];
}

module.exports = { listGiveawayBackups };
