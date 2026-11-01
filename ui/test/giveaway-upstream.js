'use strict';
const assert = require('node:assert/strict');

/** Wait for real async collector/feed/overlay propagation without using live state or fixed timing. */
async function until(operation, label) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
        try {
            if (await operation()) return;
        } catch (error) {
            if (!/context|navigat/i.test(error.message)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Giveaway browser condition timed out: ' + label);
}

/** Verify upstream controls and read-only layers against this branch's authenticated cloud bridge. */
async function verifyGiveawayUpstream(browser, port, json) {
    const dashboard = await browser.newPage();
    const overlay = await browser.newPage();
    const board = await browser.newPage();
    /** Use confirmed feature revisions for isolated operator requests. */
    async function post(path, values) {
        await json('/api/giveaway/state');
        const result = await json(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values)
        });
        assert.equal(result.response.status, path === '/api/giveaway/event' ? 202 : 200, path);
        return result.payload;
    }

    /** Read confirmed cloud participation, rather than an optimistic DOM value. */
    async function state() {
        return (await json('/api/giveaway/state')).payload.giveaway;
    }

    try {
        const base = 'http://127.0.0.1:' + port;
        await dashboard.navigate(base + '/giveaway-control.html');
        await until(
            () =>
                dashboard.evaluate(
                    'typeof state !== "undefined" && !!state.checkIn && !!document.getElementById("dJarScale")'
                ),
            'dashboard ready'
        );
        assert.equal(
            await dashboard.evaluate('!!document.getElementById("workspace-sidebar")'),
            true
        );
        await dashboard.evaluate(
            "setSlider('dJarScale',1.25);setSlider('dCloudScale',1.5);setSlider('dUnicornScale',0.75);saveDisplay()"
        );
        await until(async () => (await state()).display.jarScale === 1.25, 'size settings saved');
        await overlay.navigate(base + '/unicorn-jar.html');
        await until(() => overlay.evaluate('!!window.ICBJar?.settings'), 'jar initialized');
        assert.deepEqual(await overlay.evaluate('window.ICBJar.settings'), {
            jarSide: 'right',
            unicornSize: 'medium',
            jarScale: 1.25,
            cloudScale: 1.5,
            unicornScale: 0.75
        });
        await post('/api/giveaway/manual', { username: 'MergeGuest', amount: 7 });
        await post('/api/giveaway/manual', { username: 'MergeAbsent', amount: 3 });
        assert.equal((await state()).pool.total, 0);
        await post('/api/giveaway/event', { type: 'chat', username: 'MergeGuest' });
        await until(
            async () => (await state()).pool.total === 7,
            'first chat activates saved tickets'
        );
        await until(
            () => overlay.evaluate('window.__jar.state().total===7'),
            'jar receives checked-in totals'
        );
        await board.navigate(base + '/giveaway-entrants.html');
        await until(
            () =>
                board.evaluate(
                    '!!document.body && document.body.textContent.includes("MergeGuest")'
                ),
            'entrants board updated'
        );
        assert.equal(
            await board.evaluate('document.body.textContent.includes("MergeAbsent")'),
            false
        );
        await post('/api/giveaway/jar/empty', {});
        assert.equal((await state()).pool.total, 0);
        await post('/api/giveaway/event', { type: 'chat', username: 'MergeGuest' });
        await until(
            async () => (await state()).pool.total === 7,
            'same-window re-entry after reset'
        );
        await until(
            () => dashboard.evaluate('!document.getElementById("checkInRequired").disabled'),
            'checkbox ready'
        );
        await dashboard.evaluate('setCheckIn(false)');
        await until(
            async () => (await state()).pool.required === false,
            'checkbox persists policy'
        );
        assert.equal((await state()).pool.total, 10);
        assert.deepEqual(dashboard.errors, []);
        assert.deepEqual(overlay.errors, []);
        assert.deepEqual(board.errors, []);
        await post('/api/giveaway/checkin', { required: true });
        await post('/api/giveaway/reset', {});
        await post('/api/giveaway/display/reset', {});
        console.log(
            'Merged giveaway browser checks passed: size controls, jar rendering, checked-in board, same-window re-entry and cloud policy.'
        );
    } finally {
        await dashboard.close();
        await overlay.close();
        await board.close();
    }
}

module.exports = { verifyGiveawayUpstream, until };
