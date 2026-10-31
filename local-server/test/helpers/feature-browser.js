'use strict';
const assert = require('node:assert/strict');

/** Let the real overlay polling interval deliver state without touching a personal browser. */
async function settle(page, ms = 2300) {
    await page.evaluate(`new Promise(function(resolve) { setTimeout(resolve, ${ms}); })`);
}

/** Submit mutations only through the isolated test server passed by the harness. */
async function post(json, route, body) {
    const result = await json(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    assert.equal(result.response.status, 200);
    return result.payload;
}

/** Check picker controls, polling, slideshow startup and stopping during an interrupt. */
async function verifySpriteTvPage(page, json, overlay) {
    if (!overlay) {
        const picked = await page.evaluate(`(function () {
            var button = document.querySelector('.sp-btn');
            button.click();
            return button.dataset.id;
        })()`);
        await settle(page, 350);
        assert.equal((await json('/api/sprite-tv')).payload.settings.pinnedId, picked);
        await page.evaluate("document.getElementById('chkVisible').click()");
        await settle(page, 350);
        assert.equal((await json('/api/sprite-tv')).payload.settings.visible, false);
        await page.evaluate("document.getElementById('chkVisible').click()");
        await settle(page, 350);
        assert.equal((await json('/api/sprite-tv')).payload.settings.visible, true);
        assert.equal(
            await page.evaluate(
                "typeof document.getElementById('meldUrl').nextElementSibling.onclick"
            ),
            'function'
        );
        return;
    }
    const state = (await json('/api/sprite-tv')).payload;
    assert.equal(
        await page.evaluate("document.getElementById('sprite-name').textContent"),
        state.display.name
    );
    await post(json, '/api/sprite-tv', {
        set: { slideshow: true, ssPool: 'all', ssDelay: 1, ssInterval: 2, ssShowInterrupt: false }
    });
    await settle(page, 3600);
    assert.match(
        await page.evaluate("document.getElementById('ss-counter').textContent"),
        /\d+ \/ \d+/
    );
    await post(json, '/api/sprite-tv', { set: { slideshow: false } });
    await settle(page);
    assert.equal(
        await page.evaluate("document.getElementById('ss-counter').style.display"),
        'none'
    );
    assert.equal(
        await page.evaluate("document.getElementById('sprite-name').textContent"),
        state.display.name
    );
    await post(json, '/api/sprite-tv', { set: { slideshow: true, ssShowInterrupt: true } });
    await settle(page, 3100);
    await post(json, '/api/sprite-tv', { set: { slideshow: false } });
    await settle(page, 4200);
    assert.equal(
        await page.evaluate("document.getElementById('ss-counter').style.display"),
        'none'
    );
    assert.equal(
        await page.evaluate("document.getElementById('sprite-name').textContent"),
        state.display.name
    );
}

/** Check dashboard attendance buttons and their read-only overlay presentation. */
async function verifySignupPage(page, json, overlay) {
    if (!overlay) {
        await post(json, '/api/sashimi', {
            newEvent: 'Browser Attendance',
            roles: [],
            add: ['Browser Guest']
        });
        await settle(page);
        await page.evaluate('document.querySelector(\'button[title="Check in"]\').click()');
        await settle(page, 500);
        assert.equal((await json('/api/sashimi')).payload.checkedIn, 1);
        assert.match(
            await page.evaluate("document.getElementById('checkedCnt').textContent"),
            /1 \/ 1 here/
        );
        return;
    }
    assert.ok(await page.evaluate("document.body.textContent.includes('Browser Guest')"));
    assert.ok(await page.evaluate("document.body.textContent.includes('✅')"));
}

module.exports = { verifySpriteTvPage, verifySignupPage };
