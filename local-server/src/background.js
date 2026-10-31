'use strict';

/** Start feature timers only from the server entry point; return one shutdown operation. */
function startBackgroundJobs() {
    const timers = [
        setInterval(require('./giveaway/state').flushChat, 10000),
        setInterval(require('./activity/state-sync').flush, 10000),
        setInterval(require('./giveaway/state').awardChatWindow, 10 * 60 * 1000),
        setInterval(require('./steam').pollSteamIfDue, 5000),
        setInterval(require('./poll').expirePoll, 1000),
        setInterval(require('./palia-clock').checkAlarms, 5000),
        setInterval(require('./countdowns').cdTick, 1000),
        setInterval(require('./hunt').huntTick, 1000),
        setInterval(require('./sprites').sprImportCheck, 3000)
    ];
    for (const timer of timers) timer.unref();
    const stopCollector = require('./activity/collector').start();
    return function stopBackgroundJobs() {
        for (const timer of timers) clearInterval(timer);
        require('./giveaway/state').flushChat();
        require('./activity/state-sync').flush();
        stopCollector();
    };
}

module.exports = { startBackgroundJobs };
