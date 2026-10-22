'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const { json, port, logFile } = require('./e2e-harness');
/** Verify weekly behavior against the isolated test server. */
async function verifyWeekly() {
    function wkv2(wk, id) {
        return wk.items.find((i) => i.id === id).count;
    }

    let wk = (await json('/api/weekly')).payload.weekly;
    assert.ok(wk.items.length, 'no weekly accomplishments loaded');

    // Palia's week rolls over Monday 04:00 UTC. Anchored to UTC so daylight
    // saving cannot drift it by an hour twice a year.
    const wkStart = new Date(wk.weekStart);
    assert.equal(wkStart.getUTCDay(), 1, 'the weekly window must start on a Monday (UTC)');
    assert.equal(
        wkStart.getUTCHours(),
        4,
        "the weekly window must start at 04:00 UTC — Palia's own reset"
    );
    assert.equal(
        new Date(wk.nextResetAt) - wkStart,
        7 * 24 * 3600 * 1000,
        'the week must be exactly 7 days long'
    );

    for (const item of wk.items) {
        assert.ok(item.label, `weekly item has no label: ${item.id}`);
        if (item.type === 'manual') {
            // A manual item must say WHY, so a later session cannot "helpfully"
            // automate something the log genuinely cannot see.
            assert.ok(
                item.whyManual,
                `manual weekly item must explain why it cannot be automatic: ${item.id}`
            );
        } else {
            assert.ok(Number(item.target) > 0, `automatic weekly item needs a target: ${item.id}`);
            assert.ok(
                item.tokenPattern || (item.tokens || []).length,
                `automatic weekly item needs tokens: ${item.id}`
            );
            assert.ok(
                ['items', 'events'].includes(item.mode),
                `automatic weekly item needs mode items|events: ${item.id}`
            );
        }
    }
    // Every "with Friends" item must be manual. The log never names another
    // player - this was checked across every log file and found zero times.
    for (const item of wk.items.filter((i) => /friend/i.test(i.label))) {
        assert.equal(
            item.type,
            'manual',
            `${item.id} must stay manual — the log cannot see other players`
        );
    }

    const wkPage = await fetch(`http://127.0.0.1:${port}/weekly.html`);
    assert.equal(wkPage.status, 200);
    // Every layout variant must have its own plain path, because a Meld URL is
    // never allowed a query string.
    const wkWide = await fetch(`http://127.0.0.1:${port}/weekly-wide.html`);
    assert.equal(
        wkWide.status,
        200,
        '/weekly-wide.html must serve, so the two-column layout needs no query string'
    );
    const wideHtml = await wkWide.text();
    assert.match(wideHtml, /column-count:2/, '/weekly-wide.html must actually be two columns');
    assert.match(wideHtml, /#wrap\{[^}]*width:900px/, '/weekly-wide.html must default to 900 wide');
    const wkHtml = await wkPage.text();
    assert.ok(
        !/=>|const |let |\?\?/.test(wkHtml.split('<script>')[1] || ''),
        'weekly.html script must stay ES5'
    );
    for (const item of wk.items) {
        assert.ok(
            wkHtml.includes(item.label),
            `weekly.html must render "${item.label}" in the HTML itself`
        );
    }

    // Counting rules, each against a line shaped like a real one.
    const wkLines = [
        'Inventory gained: itemtype_wood_ashwood x17',
        'Inventory gained: itemtype_wood_magicwood x4',
        // Deliberately uses tokens NO resource card claims (hide, silver, stone),
        // so this block and the resource-tracker block share a log file without
        // contaminating each other's expected numbers.
        'Inventory gained: itemtype_material_hide x1',
        'Inventory gained: itemtype_mineral_ore_silver x3, itemtype_mineral_rock_stone x2',
        'Inventory gained: itemtype_crop_apple (1*) x5',
        'Inventory gained: itemtype_c_dessert_celebrationcake (1*) x1',
        'Inventory lost: itemtype_fertilizer_harvestbooster x2',
        // Full-inventory resync (Palia Assistant re-emitting the whole bag).
        // Must never be scored as a delta - counting these inflates totals.
        'Primary gained: itemtype_material_hide x999'
    ];
    fs.appendFileSync(logFile, `${wkLines.join('\n')}\n`, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 1800));
    wk = (await json('/api/weekly')).payload.weekly;
    const wkv = (id) => wk.items.find((i) => i.id === id).count;

    // One felled tree is ONE line carrying 17 wood - counting quantities here
    // would score 21 trees from two chops.
    assert.equal(wkv('trees-10'), 2, 'trees must count LOG LINES, not wood');
    assert.equal(wkv('magic-trees-10'), 1, 'magical trees must count lines carrying magicwood');
    assert.equal(
        wkv('hunt-30'),
        1,
        'creatures must count lines carrying a hide; the Primary x999 resync must not count'
    );
    assert.equal(wkv('mine-20'), 1, 'nodes must count lines, not ore');
    assert.equal(wkv('mine-silver-gold-10'), 3, 'silver/gold must sum the ore itself');
    assert.equal(wkv('crops-30'), 5, 'crops must sum quantities');
    assert.equal(wkv('crops-star-10'), 5, 'star crops must count only (1*) pickups');
    assert.equal(wkv('cook-star-3'), 1, 'star meals must count only (1*) dishes');
    assert.equal(
        wkv('fertilizer-30'),
        2,
        'fertilizer must count items LOST, since using it removes it'
    );

    // Ticking by hand must work on automatic items too - Baby is the authority.
    // Uses a different item from the undo-reset check below so the two never
    // interfere.
    wk = (
        await json('/api/weekly/trees-10/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
    ).payload.weekly;
    assert.equal(
        wk.items.find((i) => i.id === 'trees-10').done,
        true,
        'ticking an automatic item by hand must complete it'
    );
    wk = (
        await json('/api/weekly/trees-10/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
    ).payload.weekly;
    assert.equal(
        wk.items.find((i) => i.id === 'trees-10').done,
        false,
        'ticking again must untick it'
    );

    // The weekly wipe must be undoable, same as every other reset in ICB.
    await json('/api/weekly/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    });
    wk = (await json('/api/weekly')).payload.weekly;
    assert.equal(wkv2(wk, 'crops-30'), 0, 'reset must zero the list');
    assert.equal(wk.canUndoReset, true, 'a weekly reset must be undoable');
    wk = (
        await json('/api/weekly/undo-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
    ).payload.weekly;
    assert.equal(wkv2(wk, 'crops-30'), 5, 'undo must put the weekly ticks back');
}

module.exports = { verifyWeekly };
