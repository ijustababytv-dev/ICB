const { verifySkinStandard } = require('./helpers/skin-standard');
const { verifyWeekly } = require('./helpers/weekly');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
    port,
    temp,
    logFile,
    startServer,
    stopServer,
    waitForHealth,
    json,
    listenForSseEvent
} = require('./helpers/e2e-harness');
const { verifyFeatureRoutes } = require('./helpers/feature-smoke');

function value2(rt, id) {
    return rt.cards.find((c) => c.id === id).count;
}

async function main() {
    try {
        startServer();
        const health = await waitForHealth();
        assert.equal(health.service, 'ICB Clean Room');
        assert.equal(health.port, port);
        assert.equal(health.readerState, 'needs-reconciliation');
        await verifyFeatureRoutes(json, `http://127.0.0.1:${port}`);

        const page = await fetch(`http://127.0.0.1:${port}/control.html`);
        assert.equal(page.status, 200);
        const pageText = await page.text();
        assert.match(pageText, /ICB Command Center/);
        assert.match(pageText, /Run the system/);

        const overlayPage = await fetch(`http://127.0.0.1:${port}/overlay.html`);
        assert.equal(overlayPage.status, 200);
        assert.match(await overlayPage.text(), /ICB Clean Overlay/);

        // The dashboard's step-by-step guide relies on the server reporting how
        // many overlay clients are connected, so Meld hookup is verifiable.
        assert.equal(health.connectedClients.overlay, 0);
        const overlayFeed = await new Promise((resolve, reject) => {
            const request = http.get(`http://127.0.0.1:${port}/events?role=overlay`, (response) =>
                resolve({ request, response })
            );
            request.on('error', reject);
        });
        const overlayHealth = await json('/api/health');
        assert.equal(overlayHealth.payload.connectedClients.overlay, 1);
        overlayFeed.request.destroy();

        let result = await json('/api/state');
        assert.equal(result.payload.live.resources.essence, null);
        assert.equal(result.payload.live.reader.state, 'needs-reconciliation');
        assert.equal(result.payload.live.reconciliation.required, true);

        const snapshotListener = listenForSseEvent(
            'snapshot',
            (payload) => payload.live?.reader?.state === 'needs-reconciliation'
        );
        await snapshotListener.ready;
        const snapshot = await snapshotListener.event;
        assert.equal(snapshot.settings.stream.category, 'Palia');

        // ---------------------------------------------------------------
        // Official ICB Resource Tracker Skin Standard.
        // Adopted 2026-08-14 by Baby. These assertions exist so that a future
        // session cannot quietly change the standard without failing the build.
        // Changing these numbers requires an explicit instruction from Baby.
        // See docs/ICB-TRACKER-SKIN-STANDARD.md
        // ---------------------------------------------------------------
        await verifySkinStandard();

        result = await json('/api/diagnostics');
        assert.equal(result.payload.staleAfterSeconds, 600);
        assert.equal(result.payload.reader.state, 'needs-reconciliation');
        assert.match(result.payload.dataFiles.live, /live\.json$/);

        result = await json('/api/live/essence/correct', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 10 })
        });
        assert.equal(result.response.status, 409);

        const reconciliationEvent = listenForSseEvent(
            'live',
            (payload) =>
                payload.reconciliation?.required === false &&
                payload.resources?.amber === 20 &&
                payload.resources?.essence === 7 &&
                payload.resources?.sweetLeaf === 30
        );
        await reconciliationEvent.ready;
        result = await json('/api/live/reconcile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amber: 20, essence: 7, sweetLeaf: 30 })
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.payload.live.reconciliation.required, false);
        await reconciliationEvent.event;

        result = await json('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                countdown: { heading: 'CLEAN TEST' },
                stream: { title: 'Test stream' }
            })
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.payload.settings.countdown.heading, 'CLEAN TEST');

        const correctionListener = listenForSseEvent(
            'live',
            (payload) =>
                payload.reader?.lastEvent?.source === 'manual-correction' &&
                payload.resources?.essence === 10
        );
        await correctionListener.ready;
        result = await json('/api/live/essence/correct', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 10 })
        });
        assert.equal(result.payload.value, 10);
        await correctionListener.event;

        const actionListener = listenForSseEvent(
            'action',
            (payload) => payload.target === 'session.set-mode' && payload.status === 'completed'
        );
        await actionListener.ready;
        result = await json('/api/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'session.set-mode', payload: { mode: 'on-air' } })
        });
        assert.equal(result.response.status, 202);
        assert.equal(result.payload.action.status, 'completed');
        await actionListener.event;

        const logListener = listenForSseEvent(
            'live',
            (payload) =>
                payload.resources?.essence === 13 &&
                payload.resources?.amber === 22 &&
                payload.resources?.sweetLeaf === 31
        );
        await logListener.ready;
        fs.appendFileSync(
            logFile,
            'Inventory gained: itemtype_echo_essence x3, itemtype_currency_echo_amber x2, itemtype_forage_spice_sweetleaves x1\n',
            'utf8'
        );
        await logListener.event;
        result = await json('/api/live');
        assert.equal(result.payload.live.resources.essence, 13);
        assert.equal(result.payload.live.resources.amber, 22);
        assert.equal(result.payload.live.resources.sweetLeaf, 31);
        assert.equal(result.payload.live.reader.state, 'live');

        // Real Palia Assistant logs periodically re-emit the player's entire
        // current container as a "Primary gained:" line (verified against real
        // log captures, identical dumps hours apart). That must never be scored
        // as a delta, or totals balloon every time a resync fires.
        fs.appendFileSync(
            logFile,
            'Primary gained: itemtype_currency_echo_amber x50000, itemtype_echo_essence x50000, itemtype_forage_spice_sweetleaves x50000\n',
            'utf8'
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result = await json('/api/live');
        assert.equal(result.payload.live.resources.essence, 13);
        assert.equal(result.payload.live.resources.amber, 22);
        assert.equal(result.payload.live.resources.sweetLeaf, 31);

        // Items can carry an inline quality/rarity marker, e.g. "(1*)", between
        // the token and the "xN" quantity. That must still be parsed, not skipped.
        const starListener = listenForSseEvent(
            'live',
            (payload) => payload.resources?.sweetLeaf === 36
        );
        await starListener.ready;
        fs.appendFileSync(
            logFile,
            'Inventory gained: itemtype_forage_spice_sweetleaves (1*) x5\n',
            'utf8'
        );
        await starListener.event;
        result = await json('/api/live');
        assert.equal(result.payload.live.resources.sweetLeaf, 36);
        assert.equal(result.payload.live.resources.essence, 13);
        assert.equal(result.payload.live.resources.amber, 22);

        // Lockbox events are a real gain source distinct from Inventory events.
        const lockboxListener = listenForSseEvent(
            'live',
            (payload) => payload.resources?.amber === 26
        );
        await lockboxListener.ready;
        fs.appendFileSync(logFile, 'Lockbox gained: itemtype_currency_echo_amber x4\n', 'utf8');
        await lockboxListener.event;
        result = await json('/api/live');
        assert.equal(result.payload.live.resources.amber, 26);

        // Inventory lost events must subtract.
        const lostListener = listenForSseEvent(
            'live',
            (payload) => payload.resources?.essence === 11
        );
        await lostListener.ready;
        fs.appendFileSync(logFile, 'Inventory lost: itemtype_echo_essence x2\n', 'utf8');
        await lostListener.event;
        result = await json('/api/live');
        assert.equal(result.payload.live.resources.essence, 11);
        assert.equal(result.payload.live.reader.state, 'live');

        // ---------------------------------------------------------------
        // WEEKLY ACCOMPLISHMENTS
        // ---------------------------------------------------------------
        await verifyWeekly();

        // ---------------------------------------------------------------
        // RESOURCE TRACKERS — one card per resource, one Meld layer each.
        // ---------------------------------------------------------------
        let rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
        assert.ok(rt.cards.length, 'no resource tracker cards loaded');

        const artDir = path.join(__dirname, '..', '..', 'assets', 'resources');
        const tokenGoodness = (token) =>
            assert.match(token, /^itemtype_[a-z0-9_]+$/, `bad token: ${token}`);

        const boxGoodness = (box, label) => {
            assert.ok(box && box.width > 5 && box.height > 5, `no usable value box: ${label}`);
            assert.ok(
                box.left >= 0 &&
                    box.top >= 0 &&
                    box.left + box.width <= 100.5 &&
                    box.top + box.height <= 100.5,
                `value box falls outside the artwork on ${label}`
            );
        };

        const missingArtwork = [];
        for (const card of rt.cards) {
            // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) have no
            // top-level tokens/valueBox of their own - each slot carries its own,
            // checked the same way a normal card's single token/box would be.
            if (Array.isArray(card.slots)) {
                assert.ok(card.slots.length, `collection card has no slots: ${card.id}`);
                for (const slot of card.slots) {
                    assert.ok(
                        (slot.tokens || []).length || slot.tokenPrefix,
                        `slot has no token rule: ${card.id}/${slot.id}`
                    );
                    for (const token of slot.tokens || []) tokenGoodness(token);
                    if (slot.tokenPrefix)
                        assert.match(
                            slot.tokenPrefix,
                            /^itemtype_[a-z0-9]+(?:_[a-z0-9]+)*_$/,
                            `bad token family: ${card.id}/${slot.id}`
                        );
                    boxGoodness(slot.valueBox, `${card.id}/${slot.id}`);
                }
            } else {
                // Every token must look like a real token. They were all read out of
                // Baby's own logs; a guessed one is a card stuck at zero all stream.
                assert.ok((card.tokens || []).length, `resource card has no tokens: ${card.id}`);
                for (const token of card.tokens) tokenGoodness(token);
                boxGoodness(card.valueBox, card.id);
            }
            if (!fs.existsSync(path.join(artDir, card.image)))
                missingArtwork.push(`${card.id}: ${card.image}`);

            // Each card must answer on its own plain URL - no query string, because
            // that is the one thing the overlay that never rendered in Meld had.
            const page = await fetch(`http://127.0.0.1:${port}/${card.id}.html`);
            assert.equal(page.status, 200, `resource card page did not serve: /${card.id}.html`);
            const html = await page.text();
            assert.ok(
                html.includes(`/resource-art/${encodeURIComponent(card.image)}`),
                `${card.id}.html must ship its <img> in the HTML, not build it in JS`
            );
            assert.ok(
                !/=>|const |let |\?\?/.test(html.split('<script>')[1] || ''),
                `${card.id}.html script must stay ES5 — modern syntax breaks the Meld layer`
            );
            const art = await fetch(
                `http://127.0.0.1:${port}/resource-art/${encodeURIComponent(card.image)}`
            );
            assert.equal(
                art.status,
                fs.existsSync(path.join(artDir, card.image)) ? 200 : 404,
                `resource artwork response is incorrect: ${card.image}`
            );
        }

        // No two PLAIN cards may claim the same token, or one pickup would count
        // twice on the general dashboard - UNLESS both cards explicitly declare
        // `tokenOverlapOk: true`, meaning the overlap is a deliberate parallel
        // view (e.g. Sashimi and Fish Stew both watch "a star Eldershark was
        // lost" because Baby's Fish Stew recipe only uses Eldershark too - the
        // log can't say which recipe actually consumed it, so the two countdowns
        // are meant to move in lockstep, not two independent stocks). A
        // 'collection' card's slots are a similar deliberate PARALLEL view
        // (e.g. progress toward turning materials in for a specific project) and
        // are always allowed to react to the same real event as an ordinary
        // standalone card. Slots still can't collide with EACH OTHER.
        const tokenOwner = new Map();
        for (const card of rt.cards) {
            if (Array.isArray(card.slots)) {
                // Different collection cards deliberately show parallel progress. Within
                // one card a token must still have exactly one slot owner.
                const slotTokenOwner = new Map();
                for (const slot of card.slots) {
                    for (const token of slot.tokens || []) {
                        const owner = `${card.id}/${slot.id}`;
                        assert.ok(
                            !slotTokenOwner.has(token),
                            `${token} is claimed by both ${slotTokenOwner.get(token)} and ${owner}`
                        );
                        slotTokenOwner.set(token, owner);
                    }
                }
                continue;
            }
            for (const token of card.tokens) {
                const prevOwner = tokenOwner.get(token);
                if (prevOwner && (!card.tokenOverlapOk || !prevOwner.tokenOverlapOk)) {
                    assert.fail(
                        `${token} is claimed by both ${prevOwner.id} and ${card.id} without both declaring tokenOverlapOk`
                    );
                }
                tokenOwner.set(token, card);
            }
        }

        // Counting, with the traps that actually bite:
        fs.appendFileSync(logFile, 'Inventory gained: itemtype_mineral_ore_gold x7\n', 'utf8');
        // a quality marker must not be skipped
        fs.appendFileSync(
            logFile,
            'Inventory gained: itemtype_mineral_ore_palium (1*) x3\n',
            'utf8'
        );
        // the meat card sums several different animals
        fs.appendFileSync(logFile, 'Inventory gained: itemtype_product_meat_cearnuk x4\n', 'utf8');
        fs.appendFileSync(logFile, 'Inventory gained: itemtype_product_meat_rabbit x2\n', 'utf8');
        // losses subtract
        fs.appendFileSync(logFile, 'Inventory lost: itemtype_mineral_ore_gold x2\n', 'utf8');
        // a Primary resync must be ignored
        fs.appendFileSync(logFile, 'Inventory gained: itemtype_currency_gold x500\n', 'utf8');
        fs.appendFileSync(logFile, 'Primary gained: itemtype_mineral_ore_gold x999\n', 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 1800));
        rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
        const value = (id) => rt.cards.find((c) => c.id === id).count;

        assert.equal(
            value('gold-ore'),
            5,
            'gold ore should be 7 gained minus 2 lost — Primary dumps and itemtype_currency_gold must not count'
        );
        assert.equal(
            value('palium-ore'),
            3,
            'a (1*) quality marker must not stop the pickup counting'
        );
        assert.equal(value('meat'), 6, 'the meat card must add up every animal it lists');

        // Logging into Palia zeroes the session cards but never the lifetime ones,
        // and it must always be undoable - Baby logs in many times a day.
        fs.appendFileSync(logFile, '[INF] Game world changed to MAP_IntroMovie.\n', 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 1800));
        rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
        assert.equal(value2(rt, 'gold-ore'), 0, 'logging into Palia should zero the session cards');
        assert.equal(rt.canUndoReset, true, 'a login reset must be undoable');
        // A second login line moments later must not destroy the undo.
        fs.appendFileSync(logFile, '[INF] Game world changed to MAP_PreGame.\n', 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
        assert.equal(
            rt.canUndoReset,
            true,
            'a repeat login line within the debounce window wiped the undo'
        );
        rt = (
            await json('/api/resource-trackers/undo-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            })
        ).payload.resourceTrackers;
        assert.equal(value2(rt, 'gold-ore'), 5, 'undo must put the numbers back');
        assert.equal(value2(rt, 'meat'), 6);

        // Lifetime cards mirror the reconciled totals rather than keeping a rival
        // number, so they must refuse a direct edit.
        const refusedEdit = await json('/api/resource-trackers/amber-echo/adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 5 })
        });
        assert.equal(
            refusedEdit.response.status,
            400,
            'a lifetime card must not be editable behind the main total'
        );

        await stopServer();
        startServer();
        const restartedHealth = await waitForHealth();
        assert.equal(restartedHealth.version, '0.1.0-clean');
        result = await json('/api/state');
        assert.equal(result.payload.settings.countdown.heading, 'CLEAN TEST');
        assert.equal(result.payload.settings.stream.title, 'Test stream');
        assert.equal(result.payload.live.resources.essence, 11);
        assert.equal(result.payload.live.resources.amber, 26);
        assert.equal(result.payload.live.resources.sweetLeaf, 36);
        assert.equal(result.payload.live.session.mode, 'on-air');
        assert.equal(result.payload.live.reader.state, 'live');

        assert.deepEqual(
            missingArtwork,
            [],
            `Missing tracker artwork: ${missingArtwork.join(
                ', '
            )}. All remaining integration checks passed.`
        );

        console.log(
            `ICB Clean E2E passed: restart persistence, Primary-dump immunity, quality-marker parsing, tracker skin standard (2048x768, 8:3), ${rt.cards.length} resource trackers (real tokens, login reset with undo, multi-slot collection cards), and 21 weekly accomplishments (Monday 04:00 UTC week, events-vs-items counting).`
        );
    } finally {
        await stopServer();
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
