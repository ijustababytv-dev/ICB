const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const port = 8791;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-clean-test-'));
const logFile = path.join(temp, 'app-test.log');
fs.writeFileSync(logFile, 'old history is ignored\n', 'utf8');
const staleTime = new Date(Date.now() - (11 * 60 * 1000));
fs.utimesSync(logFile, staleTime, staleTime);
fs.writeFileSync(path.join(temp, 'live.json'), `${JSON.stringify({
  schemaVersion: 1,
  resources: { amber: null, essence: null, sweetLeaf: null },
  session: { mode: 'offline' },
  reader: { state: 'needs-reconciliation', file: null, fileModifiedAt: null, lastEvent: null, lastUpdateAt: null },
  reconciliation: { required: true, reason: 'test fixture', historicalBaseline: { amber: 1, essence: 2, sweetLeaf: 3 }, reconciledAt: null },
  updatedAt: null,
}, null, 2)}\n`, 'utf8');

let child;
let stderr = '';

function startServer() {
  stderr = '';
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, ICB_CLEAN_PORT: String(port), ICB_CLEAN_DATA_DIR: temp, ICB_CLEAN_PALIA_LOG_FILE: logFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
}

function stopServer() {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response.json();
    } catch (_error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start. ${stderr}`);
}

async function json(pathname, options) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  return { response, payload: await response.json() };
}

function listenForSseEvent(eventName, predicate = () => true) {
  let resolveReady;
  let rejectReady;
  let resolveEvent;
  let rejectEvent;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const event = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
  let response;
  let buffer = '';
  const request = http.get(`http://127.0.0.1:${port}/events`, nextResponse => {
    response = nextResponse;
    response.setEncoding('utf8');
    resolveReady();
    response.on('data', chunk => {
      buffer += chunk;
      let separator;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const lines = block.split('\n');
        const receivedEvent = lines.find(line => line.startsWith('event: '))?.slice(7);
        const data = lines.find(line => line.startsWith('data: '))?.slice(6);
        if (receivedEvent !== eventName || !data) continue;
        try {
          const payload = JSON.parse(data);
          if (!predicate(payload)) continue;
          cleanup();
          resolveEvent(payload);
        } catch (error) {
          cleanup();
          rejectEvent(error);
        }
      }
    });
  });
  const timer = setTimeout(() => {
    cleanup();
    rejectEvent(new Error(`Timed out waiting for SSE event: ${eventName}`));
  }, 8000);
  request.on('error', error => {
    cleanup();
    rejectReady(error);
    rejectEvent(error);
  });
  function cleanup() {
    clearTimeout(timer);
    request.destroy();
    response?.destroy();
  }
  return { ready, event };
}

function wkv2(wk, id) { return wk.items.find(i => i.id === id).count; }
function value2(rt, id) { return rt.cards.find(c => c.id === id).count; }

async function main() {
  try {
    startServer();
    const health = await waitForHealth();
    assert.equal(health.service, 'ICB Clean Room');
    assert.equal(health.port, port);
    assert.equal(health.readerState, 'needs-reconciliation');

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
      const request = http.get(`http://127.0.0.1:${port}/events?role=overlay`, response => resolve({ request, response }));
      request.on('error', reject);
    });
    const overlayHealth = await json('/api/health');
    assert.equal(overlayHealth.payload.connectedClients.overlay, 1);
    overlayFeed.request.destroy();

    let result = await json('/api/state');
    assert.equal(result.payload.live.resources.essence, null);
    assert.equal(result.payload.live.reader.state, 'needs-reconciliation');
    assert.equal(result.payload.live.reconciliation.required, true);

    const snapshotListener = listenForSseEvent('snapshot', payload => payload.live?.reader?.state === 'needs-reconciliation');
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
    result = await json('/api/tracker-skin-standard');
    assert.equal(result.response.status, 200);
    const skin = result.payload.trackerSkinStandard;
    assert.equal(skin.master.width, 2048, 'Tracker skin master width must be 2048.');
    assert.equal(skin.master.height, 768, 'Tracker skin master height must be 768.');
    assert.equal(skin.master.aspectRatio, '8:3', 'Tracker skin aspect ratio must be 8:3.');
    assert.ok(Math.abs((skin.master.width / skin.master.height) - (8 / 3)) < 1e-9, 'Master dimensions must actually be 8:3.');
    assert.equal(skin.scaling.preserveAspectRatio, true, 'Skins must always scale proportionally.');
    // The live value is drawn by ICB at runtime; a number baked into the
    // artwork can never update and would contradict the live tracker.
    assert.equal(skin.structure.valueBox.bakedIntoArtwork, false, 'The tracker value must never be baked into skin artwork.');
    assert.equal(skin.structure.valueBox.mustBeBlankInArtwork, true, 'The value box must be blank in skin artwork.');
    assert.match(skin.structure.valueBox.position, /underneath the resource title/i);
    assert.equal(skin.structure.resourceTitle.required, true);

    // Confirmed card geometry, from Baby's Tracker Card Master Template
    // (Measurements & Scales), 2026-08-14. Every tracker skin must match this
    // exactly so one resource card can swap for another with no repositioning.
    assert.equal(skin.referenceZones.status, 'confirmed', 'Card geometry is confirmed, not provisional.');
    assert.equal(skin.card.cornerRadius, 64, 'Card corner radius must be 64.');
    assert.deepEqual(
      { x: skin.referenceZones.safeArea.x, y: skin.referenceZones.safeArea.y, width: skin.referenceZones.safeArea.width, height: skin.referenceZones.safeArea.height },
      { x: 64, y: 64, width: 1920, height: 640 }, 'Safe area must be 64,64 1920x640.');
    assert.deepEqual(
      { x: skin.referenceZones.titleZone.x, y: skin.referenceZones.titleZone.y, width: skin.referenceZones.titleZone.width, height: skin.referenceZones.titleZone.height },
      { x: 128, y: 96, width: 1792, height: 260 }, 'Title zone must be 128,96 1792x260.');
    assert.deepEqual(
      { x: skin.referenceZones.valueBoxZone.x, y: skin.referenceZones.valueBoxZone.y, width: skin.referenceZones.valueBoxZone.width, height: skin.referenceZones.valueBoxZone.height },
      { x: 448, y: 392, width: 1152, height: 280 }, 'Value box zone must be 448,392 1152x280.');
    assert.equal(skin.structure.valueBox.mustNotBeMovedOrResized, true);

    // Internal consistency: the stated zones must actually agree with each
    // other and sit inside the canvas. Catches a hand-edit that moves one
    // number without updating the rest.
    const zone = (z) => ({ ...z, right: z.x + z.width, bottom: z.y + z.height, centerX: z.x + z.width / 2 });
    const safeArea = zone(skin.referenceZones.safeArea);
    const titleZone = zone(skin.referenceZones.titleZone);
    const valueBoxZone = zone(skin.referenceZones.valueBoxZone);
    for (const [name, z] of [['title', titleZone], ['valueBox', valueBoxZone]]) {
      assert.ok(z.x >= safeArea.x && z.right <= safeArea.right, `${name} zone must sit inside the safe area horizontally.`);
      assert.ok(z.y >= safeArea.y && z.bottom <= safeArea.bottom, `${name} zone must sit inside the safe area vertically.`);
      assert.equal(z.centerX, skin.master.width / 2, `${name} zone must be horizontally centred on x=1024.`);
    }
    assert.ok(valueBoxZone.y > titleZone.bottom, 'The value box must sit below the title, not overlap it.');
    assert.equal(valueBoxZone.y - titleZone.bottom, skin.derivedSpacing.titleBottomToValueBoxTop, 'derivedSpacing must match the actual zone coordinates.');
    assert.equal(skin.master.height - valueBoxZone.bottom, skin.derivedSpacing.valueBoxBottomToCanvasBottom);
    assert.equal(valueBoxZone.x, skin.derivedSpacing.valueBoxSideMargins.left);
    assert.equal(skin.master.width - valueBoxZone.right, skin.derivedSpacing.valueBoxSideMargins.right);

    // Per-skin registry. Each card declares its own value box, measured from
    // the real artwork, because image generation cannot hit pixel targets
    // reliably. ICB renders the live value into whichever card is showing.
    const skins = skin.skins;
    assert.equal(skins.model, 'per-skin-value-box');
    assert.equal(skin.structure.valueBox.perSkin, true);
    assert.ok(Array.isArray(skins.cards) && skins.cards.length >= 16, 'Skin registry must list every card.');
    const slugs = new Set();
    const mappedResources = new Map();
    for (const card of skins.cards) {
      assert.ok(card.slug && !slugs.has(card.slug), `Skin slug must be present and unique: ${card.slug}`);
      slugs.add(card.slug);
      assert.ok(card.file && card.displayName, `Skin ${card.slug} needs a file and display name.`);
      assert.equal(card.canvas.width, skin.master.width, `Skin ${card.slug} must use the master canvas width.`);
      assert.equal(card.canvas.height, skin.master.height, `Skin ${card.slug} must use the master canvas height.`);
      const vb = card.valueBox;
      assert.ok(vb && vb.width > 0 && vb.height > 0, `Skin ${card.slug} needs a real value box.`);
      assert.ok(vb.x >= 0 && vb.y >= 0, `Skin ${card.slug} value box must sit on the canvas.`);
      assert.ok(vb.x + vb.width <= card.canvas.width, `Skin ${card.slug} value box overflows the canvas width.`);
      assert.ok(vb.y + vb.height <= card.canvas.height, `Skin ${card.slug} value box overflows the canvas height.`);
      assert.equal(card.hasAlpha, true, `Skin ${card.slug} must have transparency for Meld.`);
      if (card.resource) {
        assert.ok(!mappedResources.has(card.resource), `Resource ${card.resource} is mapped to two skins.`);
        mappedResources.set(card.resource, card.slug);
      }
    }
    // Every resource the server actually tracks must have a skin to render into.
    for (const resource of ['amber', 'essence', 'sweetLeaf']) {
      assert.ok(mappedResources.has(resource), `Tracked resource ${resource} has no skin mapped.`);
    }

    result = await json('/api/diagnostics');
    assert.equal(result.payload.trackerSkinStandard.width, 2048);
    assert.equal(result.payload.trackerSkinStandard.height, 768);
    assert.equal(result.payload.trackerSkinStandard.aspectRatio, '8:3');
    assert.equal(result.payload.trackerSkinStandard.valueBoxBakedIntoArtwork, false);

    result = await json('/api/diagnostics');
    assert.equal(result.payload.staleAfterSeconds, 600);
    assert.equal(result.payload.reader.state, 'needs-reconciliation');
    assert.match(result.payload.dataFiles.live, /live\.json$/);

    result = await json('/api/live/essence/correct', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 10 }) });
    assert.equal(result.response.status, 409);

    const reconciliationEvent = listenForSseEvent('live', payload => payload.reconciliation?.required === false && payload.resources?.amber === 20 && payload.resources?.essence === 7 && payload.resources?.sweetLeaf === 30);
    await reconciliationEvent.ready;
    result = await json('/api/live/reconcile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amber: 20, essence: 7, sweetLeaf: 30 }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.live.reconciliation.required, false);
    await reconciliationEvent.event;

    result = await json('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countdown: { heading: 'CLEAN TEST' }, stream: { title: 'Test stream' } }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.settings.countdown.heading, 'CLEAN TEST');

    const correctionListener = listenForSseEvent('live', payload => payload.reader?.lastEvent?.source === 'manual-correction' && payload.resources?.essence === 10);
    await correctionListener.ready;
    result = await json('/api/live/essence/correct', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 10 }) });
    assert.equal(result.payload.value, 10);
    await correctionListener.event;

    const actionListener = listenForSseEvent('action', payload => payload.target === 'session.set-mode' && payload.status === 'completed');
    await actionListener.ready;
    result = await json('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'session.set-mode', payload: { mode: 'on-air' } }) });
    assert.equal(result.response.status, 202);
    assert.equal(result.payload.action.status, 'completed');
    await actionListener.event;

    const logListener = listenForSseEvent('live', payload => payload.resources?.essence === 13 && payload.resources?.amber === 22 && payload.resources?.sweetLeaf === 31);
    await logListener.ready;
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_echo_essence x3, itemtype_currency_echo_amber x2, itemtype_forage_spice_sweetleaves x1\n', 'utf8');
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
    fs.appendFileSync(logFile, 'Primary gained: itemtype_currency_echo_amber x50000, itemtype_echo_essence x50000, itemtype_forage_spice_sweetleaves x50000\n', 'utf8');
    await new Promise(resolve => setTimeout(resolve, 1500));
    result = await json('/api/live');
    assert.equal(result.payload.live.resources.essence, 13);
    assert.equal(result.payload.live.resources.amber, 22);
    assert.equal(result.payload.live.resources.sweetLeaf, 31);

    // Items can carry an inline quality/rarity marker, e.g. "(1*)", between
    // the token and the "xN" quantity. That must still be parsed, not skipped.
    const starListener = listenForSseEvent('live', payload => payload.resources?.sweetLeaf === 36);
    await starListener.ready;
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_forage_spice_sweetleaves (1*) x5\n', 'utf8');
    await starListener.event;
    result = await json('/api/live');
    assert.equal(result.payload.live.resources.sweetLeaf, 36);
    assert.equal(result.payload.live.resources.essence, 13);
    assert.equal(result.payload.live.resources.amber, 22);

    // Lockbox events are a real gain source distinct from Inventory events.
    const lockboxListener = listenForSseEvent('live', payload => payload.resources?.amber === 26);
    await lockboxListener.ready;
    fs.appendFileSync(logFile, 'Lockbox gained: itemtype_currency_echo_amber x4\n', 'utf8');
    await lockboxListener.event;
    result = await json('/api/live');
    assert.equal(result.payload.live.resources.amber, 26);

    // Inventory lost events must subtract.
    const lostListener = listenForSseEvent('live', payload => payload.resources?.essence === 11);
    await lostListener.ready;
    fs.appendFileSync(logFile, 'Inventory lost: itemtype_echo_essence x2\n', 'utf8');
    await lostListener.event;
    result = await json('/api/live');
    assert.equal(result.payload.live.resources.essence, 11);
    assert.equal(result.payload.live.reader.state, 'live');

    // ---------------------------------------------------------------
    // WEEKLY ACCOMPLISHMENTS
    // ---------------------------------------------------------------
    let wk = (await json('/api/weekly')).payload.weekly;
    assert.ok(wk.items.length, 'no weekly accomplishments loaded');

    // Palia's week rolls over Monday 04:00 UTC. Anchored to UTC so daylight
    // saving cannot drift it by an hour twice a year.
    const wkStart = new Date(wk.weekStart);
    assert.equal(wkStart.getUTCDay(), 1, 'the weekly window must start on a Monday (UTC)');
    assert.equal(wkStart.getUTCHours(), 4, "the weekly window must start at 04:00 UTC — Palia's own reset");
    assert.equal(new Date(wk.nextResetAt) - wkStart, 7 * 24 * 3600 * 1000, 'the week must be exactly 7 days long');

    for (const item of wk.items) {
      assert.ok(item.label, `weekly item has no label: ${item.id}`);
      if (item.type === 'manual') {
        // A manual item must say WHY, so a later session cannot "helpfully"
        // automate something the log genuinely cannot see.
        assert.ok(item.whyManual, `manual weekly item must explain why it cannot be automatic: ${item.id}`);
      } else {
        assert.ok(Number(item.target) > 0, `automatic weekly item needs a target: ${item.id}`);
        assert.ok(item.tokenPattern || (item.tokens || []).length, `automatic weekly item needs tokens: ${item.id}`);
        assert.ok(['items', 'events'].includes(item.mode), `automatic weekly item needs mode items|events: ${item.id}`);
      }
    }
    // Every "with Friends" item must be manual. The log never names another
    // player - this was checked across every log file and found zero times.
    for (const item of wk.items.filter(i => /friend/i.test(i.label))) {
      assert.equal(item.type, 'manual', `${item.id} must stay manual — the log cannot see other players`);
    }

    const wkPage = await fetch(`http://127.0.0.1:${port}/weekly.html`);
    assert.equal(wkPage.status, 200);
    // Every layout variant must have its own plain path, because a Meld URL is
    // never allowed a query string.
    const wkWide = await fetch(`http://127.0.0.1:${port}/weekly-wide.html`);
    assert.equal(wkWide.status, 200, '/weekly-wide.html must serve, so the two-column layout needs no query string');
    const wideHtml = await wkWide.text();
    assert.match(wideHtml, /column-count:2/, '/weekly-wide.html must actually be two columns');
    assert.match(wideHtml, /#wrap\{[^}]*width:900px/, '/weekly-wide.html must default to 900 wide');
    const wkHtml = await wkPage.text();
    assert.ok(!/=>|const |let |\?\?/.test(wkHtml.split('<script>')[1] || ''), 'weekly.html script must stay ES5');
    for (const item of wk.items) {
      assert.ok(wkHtml.includes(item.label), `weekly.html must render "${item.label}" in the HTML itself`);
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
      'Primary gained: itemtype_material_hide x999',
    ];
    fs.appendFileSync(logFile, `${wkLines.join('\n')}\n`, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 1800));
    wk = (await json('/api/weekly')).payload.weekly;
    const wkv = id => wk.items.find(i => i.id === id).count;
    // One felled tree is ONE line carrying 17 wood - counting quantities here
    // would score 21 trees from two chops.
    assert.equal(wkv('trees-10'), 2, 'trees must count LOG LINES, not wood');
    assert.equal(wkv('magic-trees-10'), 1, 'magical trees must count lines carrying magicwood');
    assert.equal(wkv('hunt-30'), 1, 'creatures must count lines carrying a hide; the Primary x999 resync must not count');
    assert.equal(wkv('mine-20'), 1, 'nodes must count lines, not ore');
    assert.equal(wkv('mine-silver-gold-10'), 3, 'silver/gold must sum the ore itself');
    assert.equal(wkv('crops-30'), 5, 'crops must sum quantities');
    assert.equal(wkv('crops-star-10'), 5, 'star crops must count only (1*) pickups');
    assert.equal(wkv('cook-star-3'), 1, 'star meals must count only (1*) dishes');
    assert.equal(wkv('fertilizer-30'), 2, 'fertilizer must count items LOST, since using it removes it');

    // Ticking by hand must work on automatic items too - Baby is the authority.
    // Uses a different item from the undo-reset check below so the two never
    // interfere.
    wk = (await json('/api/weekly/trees-10/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).payload.weekly;
    assert.equal(wk.items.find(i => i.id === 'trees-10').done, true, 'ticking an automatic item by hand must complete it');
    wk = (await json('/api/weekly/trees-10/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).payload.weekly;
    assert.equal(wk.items.find(i => i.id === 'trees-10').done, false, 'ticking again must untick it');

    // The weekly wipe must be undoable, same as every other reset in ICB.
    await json('/api/weekly/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    wk = (await json('/api/weekly')).payload.weekly;
    assert.equal(wkv2(wk, 'crops-30'), 0, 'reset must zero the list');
    assert.equal(wk.canUndoReset, true, 'a weekly reset must be undoable');
    wk = (await json('/api/weekly/undo-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).payload.weekly;
    assert.equal(wkv2(wk, 'crops-30'), 5, 'undo must put the weekly ticks back');

    // ---------------------------------------------------------------
    // RESOURCE TRACKERS — one card per resource, one Meld layer each.
    // ---------------------------------------------------------------
    let rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
    assert.ok(rt.cards.length, 'no resource tracker cards loaded');

    const artDir = path.join(__dirname, '..', 'assets', 'resources');
    const tokenGoodness = token => assert.match(token, /^itemtype_[a-z0-9_]+$/, `bad token: ${token}`);
    const boxGoodness = (box, label) => {
      assert.ok(box && box.width > 5 && box.height > 5, `no usable value box: ${label}`);
      assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= 100.5 && box.top + box.height <= 100.5,
        `value box falls outside the artwork on ${label}`);
    };
    for (const card of rt.cards) {
      // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) have no
      // top-level tokens/valueBox of their own - each slot carries its own,
      // checked the same way a normal card's single token/box would be.
      if (Array.isArray(card.slots)) {
        assert.ok(card.slots.length, `collection card has no slots: ${card.id}`);
        for (const slot of card.slots) {
          assert.ok((slot.tokens || []).length, `slot has no tokens: ${card.id}/${slot.id}`);
          for (const token of slot.tokens) tokenGoodness(token);
          boxGoodness(slot.valueBox, `${card.id}/${slot.id}`);
        }
      } else {
        // Every token must look like a real token. They were all read out of
        // Baby's own logs; a guessed one is a card stuck at zero all stream.
        assert.ok((card.tokens || []).length, `resource card has no tokens: ${card.id}`);
        for (const token of card.tokens) tokenGoodness(token);
        boxGoodness(card.valueBox, card.id);
      }
      assert.ok(fs.existsSync(path.join(artDir, card.image)), `missing artwork for ${card.id}: ${card.image}`);

      // Each card must answer on its own plain URL - no query string, because
      // that is the one thing the overlay that never rendered in Meld had.
      const page = await fetch(`http://127.0.0.1:${port}/${card.id}.html`);
      assert.equal(page.status, 200, `resource card page did not serve: /${card.id}.html`);
      const html = await page.text();
      assert.ok(html.includes(`/resource-art/${encodeURIComponent(card.image)}`),
        `${card.id}.html must ship its <img> in the HTML, not build it in JS`);
      assert.ok(!/=>|const |let |\?\?/.test(html.split('<script>')[1] || ''),
        `${card.id}.html script must stay ES5 — modern syntax breaks the Meld layer`);
      const art = await fetch(`http://127.0.0.1:${port}/resource-art/${encodeURIComponent(card.image)}`);
      assert.equal(art.status, 200, `resource artwork did not serve: ${card.image}`);
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
    const slotTokenOwner = new Map();
    for (const card of rt.cards) {
      if (Array.isArray(card.slots)) {
        for (const slot of card.slots) {
          for (const token of slot.tokens || []) {
            const owner = `${card.id}/${slot.id}`;
            assert.ok(!slotTokenOwner.has(token), `${token} is claimed by both ${slotTokenOwner.get(token)} and ${owner}`);
            slotTokenOwner.set(token, owner);
          }
        }
        continue;
      }
      for (const token of card.tokens) {
        const prevOwner = tokenOwner.get(token);
        if (prevOwner && (!card.tokenOverlapOk || !prevOwner.tokenOverlapOk)) {
          assert.fail(`${token} is claimed by both ${prevOwner.id} and ${card.id} without both declaring tokenOverlapOk`);
        }
        tokenOwner.set(token, card);
      }
    }

    // Counting, with the traps that actually bite:
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_mineral_ore_gold x7\n', 'utf8');
    // a quality marker must not be skipped
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_mineral_ore_palium (1*) x3\n', 'utf8');
    // the meat card sums several different animals
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_product_meat_cearnuk x4\n', 'utf8');
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_product_meat_rabbit x2\n', 'utf8');
    // losses subtract
    fs.appendFileSync(logFile, 'Inventory lost: itemtype_mineral_ore_gold x2\n', 'utf8');
    // a Primary resync must be ignored
    fs.appendFileSync(logFile, 'Inventory gained: itemtype_currency_gold x500\n', 'utf8');
    fs.appendFileSync(logFile, 'Primary gained: itemtype_mineral_ore_gold x999\n', 'utf8');
    await new Promise(resolve => setTimeout(resolve, 1800));
    rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
    const value = id => rt.cards.find(c => c.id === id).count;
    assert.equal(value('gold-ore'), 5, 'gold ore should be 7 gained minus 2 lost — Primary dumps and itemtype_currency_gold must not count');
    assert.equal(value('palium-ore'), 3, 'a (1*) quality marker must not stop the pickup counting');
    assert.equal(value('meat'), 6, 'the meat card must add up every animal it lists');

    // Logging into Palia zeroes the session cards but never the lifetime ones,
    // and it must always be undoable - Baby logs in many times a day.
    fs.appendFileSync(logFile, '[INF] Game world changed to MAP_IntroMovie.\n', 'utf8');
    await new Promise(resolve => setTimeout(resolve, 1800));
    rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
    assert.equal(value2(rt, 'gold-ore'), 0, 'logging into Palia should zero the session cards');
    assert.equal(rt.canUndoReset, true, 'a login reset must be undoable');
    // A second login line moments later must not destroy the undo.
    fs.appendFileSync(logFile, '[INF] Game world changed to MAP_PreGame.\n', 'utf8');
    await new Promise(resolve => setTimeout(resolve, 1500));
    rt = (await json('/api/resource-trackers')).payload.resourceTrackers;
    assert.equal(rt.canUndoReset, true, 'a repeat login line within the debounce window wiped the undo');
    rt = (await json('/api/resource-trackers/undo-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).payload.resourceTrackers;
    assert.equal(value2(rt, 'gold-ore'), 5, 'undo must put the numbers back');
    assert.equal(value2(rt, 'meat'), 6);

    // Lifetime cards mirror the reconciled totals rather than keeping a rival
    // number, so they must refuse a direct edit.
    const refusedEdit = await json('/api/resource-trackers/amber-echo/adjust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: 5 }) });
    assert.equal(refusedEdit.response.status, 400, 'a lifetime card must not be editable behind the main total');

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

    console.log(`ICB Clean E2E passed: restart persistence, Primary-dump immunity, quality-marker parsing, tracker skin standard (2048x768, 8:3), ${rt.cards.length} resource trackers (real tokens, login reset with undo, multi-slot collection cards), and 21 weekly accomplishments (Monday 04:00 UTC week, events-vs-items counting).`);
  } finally {
    await stopServer();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
