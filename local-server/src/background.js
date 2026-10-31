'use strict';

/** Start feature timers only from the server entry point; return one shutdown operation. */
function startBackgroundJobs() {
    const feed = require('./cloud/state-feed');
    for (const path of [
        '/api/state',
        '/api/settings',
        '/api/live',
        '/api/resource-trackers',
        '/api/weekly',
        '/api/hub',
        '/api/giveaway/state',
        '/api/sprite-tv'
    ])
        feed.watch(path);
    const inputs = require('./cloud/inputs');
    /** Feed and input transport share one lifecycle; neither runs a local business rule. */
    async function refresh() {
        await feed.tick();
        inputs.startSession();
    }

    const timers = [
        setInterval(
            () =>
                refresh().catch(() =>
                    require('./activity/collector').noteProblem('cloud_unavailable')
                ),
            2000
        ),
        setInterval(() => {
            try {
                inputs.flushPresence();
            } catch (_) {
                require('./activity/collector').noteProblem('presence_checkpoint_failed');
            }
        }, 10000)
    ];
    refresh().catch(() => {});
    for (const timer of timers) timer.unref();
    const stopCollector = require('./activity/collector').start();
    const stopAssets = require('./assets/references').watchAssets();
    return function stopBackgroundJobs() {
        for (const timer of timers) clearInterval(timer);
        try {
            inputs.flushPresence();
        } catch (_) {
            require('./activity/collector').noteProblem('presence_checkpoint_failed');
        }
        stopCollector();
        stopAssets();
    };
}

module.exports = { startBackgroundJobs };
