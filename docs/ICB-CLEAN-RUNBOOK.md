# ICB Clean Runbook

## Purpose

ICB Clean is the one local server for the Chrome command center, Palia Assistant tracker state, and the read-only Meld overlay. Its project folder is:

```text
C:\Users\aleis\OneDrive\Documents\GitHub\ICB
```

It is intentionally separate from the legacy `C:\Users\mrsch\Documents\ChatGPT\ICB` project and `C:\StreamLive`. Do not start, edit, or troubleshoot those older projects as part of normal ICB Clean use.

## Source and tests (2026-10-22)

Start with the existing batch launchers or `npm start` (`js/server/index.js`). See [the architecture map](ARCHITECTURE.md) for the new folders. All page and API URLs remain the same. Run `npm run test:unit` and `npm run test:e2e`; browser changes also use `npm run test:browser`, which launches only a separate headless test profile.

The existing `assets/resources/poke_bowl.png` file is missing in this checkout. The E2E suite reports that missing artwork after completing its remaining checks. Restoring the original file resolves that asset prerequisite.

Image transfer commands are documented in [Cloudinary image sync](CLOUDINARY.md). Double-click `sync-cloudinary-images.bat` to upload local originals, or `download-cloudinary-images.bat` to download Cloudinary versions into `assets/`. Downloads skip identical files and back up replaced local originals. Neither command changes tracker counts or restarts the server.

## Optional cloud database infrastructure

`terraform/` defines a small AWS RDS PostgreSQL database and its dedicated public
network. See [the Terraform instructions](../terraform/README.md) for deployment,
TLS connections, credential handling, cost controls, and deliberate removal.
Applying infrastructure does not migrate ICB data or connect the local application.
The local server and log reader continue to run normally; no restart is needed
to edit or validate Terraform. Internet-wide TCP 5432 access is intentional in
this configuration and can be narrowed with `allowed_ipv4_cidrs`.

## Historical status (verified 2026-08-14)

- The Chrome dashboard now leads the whole workflow through a live "Run the system" panel (see "What to start"). It was rendered and driven through all five states in a real browser during verification, not just unit-tested.

- The full automated suite (`npm.cmd run test:e2e`) passes, including new regression coverage described below.
- The real Palia Assistant log files on this machine were inspected directly (not just the synthetic test fixture) to confirm the tracker's log-parsing logic matches actual log output. This caught and fixed a real bug: the reader was scoring periodic full-inventory `Primary gained:` resyncs as real gains, which would have inflated totals over a play session. See "Which log lines count" below.
- A second real-data bug was fixed: item lines with an inline quality marker (e.g. `itemtype_forage_spice_sweetleaves (1*) x2`) were silently skipped by the quantity-matching pattern. They are now parsed correctly.
- The build is still intentionally in **needs reconciliation** mode. Nothing in this pass touched `data/live.json`'s resource totals or asked for your three current in-game totals — that one-time entry happens only when you're ready, through the Chrome reconciliation panel, per the existing rule in this runbook.
- Server/dashboard/overlay logic did not need structural changes — the one-Node-server, Chrome-dashboard, Meld-overlay architecture and the settings/live state separation were already sound and are unchanged.

## Canonical URLs

| Use | URL |
| --- | --- |
| Private operator dashboard in Chrome | `http://127.0.0.1:8790/control.html` |
| Read-only Meld Browser layer | `http://127.0.0.1:8790/overlay.html` |
| Health check | `http://127.0.0.1:8790/api/health` |
| Diagnostics | `http://127.0.0.1:8790/api/diagnostics` |

Port `8790` belongs to ICB Clean. Do not switch it to `8787` while legacy projects still exist; that port has historically been owned by older trackers.

## What to start

**Short version: run `start-icb-clean.bat`, then do whatever the dashboard's "Run the system" panel tells you.** You do not need to memorise this runbook to operate ICB day to day — the dashboard is the operating surface.

The launcher starts ICB Clean and opens Chrome. It does not start or stop Palia, Palia Assistant, StreamLive, or any legacy server.

### The "Run the system" panel

The top card of `control.html` is a live, self-updating checklist. It reads the server's real state and highlights exactly one step as **DO THIS NOW**, with instructions for that step only. Steps flip to **DONE** on their own as each part of the system comes online — nothing is manually ticked off, so the panel cannot drift out of sync with reality.

| Step | Turns DONE when |
| --- | --- |
| 1. Start the ICB Clean server | `/api/health` responds |
| 2. Enter your three current in-game totals (one time) | `reconciliation.required` is false |
| 3. Start Palia Assistant, then Palia | Reader state is `live` (new log activity seen) |
| 4. Add the overlay to Meld Studio | An `overlay.html` client is actually connected to `/events` |
| 5. Go on-air | Session mode is `on-air` |

Step 4 is worth calling out: the dashboard detects a genuine Meld Browser-layer connection rather than asking you to confirm it. SSE clients identify themselves with `?role=control` or `?role=overlay`, and `/api/health` and `/api/diagnostics` both report `connectedClients`. If step 4 will not turn green, Meld is not really pointed at `overlay.html` on port `8790`.

Meld receives only `overlay.html`; never add `control.html` as a Browser layer.

## State ownership

| File | Owns | Never use it for |
| --- | --- | --- |
| `data/settings.json` | Countdown and stream metadata | Amber, Essence, or Sweet Leaf totals |
| `data/live.json` | Live tracker totals, reader status, session mode | General stream settings |
| `data/actions.jsonl` | Recent command history | Authoritative tracker totals |

Normal `PUT /api/settings` saves cannot change live tracker totals. A resource total changes only from a parsed Palia Assistant log event or a deliberate `PUT /api/live/{resource}/correct` correction.

## Palia tracker behavior

ICB Clean watches the newest non-backup `app-*.log` in either:

```text
%LOCALAPPDATA%\PaliaAssistant\logs
%LOCALAPPDATA%\PaliaAssistant\current\logs
```

It tracks these exact Palia Assistant item IDs:

| Resource | Item ID |
| --- | --- |
| Amber Echo | `itemtype_currency_echo_amber` |
| Infected Essence | `itemtype_echo_essence` |
| Sweet Leaf | `itemtype_forage_spice_sweetleaves` |

When ICB Clean first sees a log, it starts reading at the end. This deliberately prevents old history from being counted again. The reader reports **offline** when the newest log has not changed for ten minutes; it switches to **live** when Palia Assistant writes new activity.

### Which log lines count (fixed 2026-08-14)

Real Palia Assistant logs were inspected directly (`app-*.log`, both current and historical) to verify this against actual data instead of assumptions. The log contains several distinct event families:

| Line prefix | Meaning | Counted as a tracker delta? |
| --- | --- | --- |
| `Inventory gained:` / `Inventory lost:` | A real, incremental single-event pickup or consumption | Yes |
| `Lockbox gained:` / `Lockbox lost:` | A real gain/loss from a lockbox/mail source | Yes |
| `Primary gained:` / `Primary lost:` | Palia Assistant periodically re-emits the player's **entire current container** as if it were freshly "gained" (confirmed by diffing two such dumps roughly three hours apart in a real log — item-for-item identical) | **No — deliberately ignored** |
| `Crafted recipe ...` | Recipe id and a before/after count, no item token | Not applicable (no token to match) |

The original clean build scored every line containing the words "gained"/"lost" near a tracked token, which meant a `Primary gained:` resync would have been counted as a real gain every time Palia Assistant re-emits it — silently inflating Amber Echo, Infected Essence, and Sweet Leaf totals over a play session. The reader now only scores lines whose prefix is `Inventory` or `Lockbox`; `Primary` lines are read (to keep the file offset correct) but never change a total. This is covered by an automated regression test (see Verification below) that replays a real-shaped `Primary gained:` dump and asserts totals do not move.

Item lines can also carry an inline quality/rarity marker between the item token and its quantity, e.g. `itemtype_forage_spice_sweetleaves (1*) x2` — confirmed present in real Sweet Leaf pickups. The token-matching pattern now consumes that marker so starred pickups are counted instead of silently skipped.

### Historical snapshot and one-time reconciliation

The last known totals from the legacy ICB are preserved as historical evidence only:

| Resource | Baseline |
| --- | ---: |
| Amber Echo | 10,122 |
| Infected Essence | 1,505 |
| Sweet Leaf | 408 |

The source snapshot is `data/legacy-palia-snapshot-20260814.json`. Palia was played after Palia Assistant stopped, so ICB Clean starts in **needs reconciliation** mode and does not display or count from these old values.

After the server and dashboard are confirmed working, enter the three current in-game totals one time in the Chrome reconciliation panel. ICB Clean saves those values, starts at the end of the current log, and then tracks only new events. Individual corrections remain disabled until this one-time step is complete.

## API contract

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service identity, version, port, uptime, reader state, connected client counts |
| `GET` | `/api/diagnostics` | Data file paths, current reader file/state, watch locations, stale threshold, connected client counts |
| `GET` | `/api/tracker-skin-standard` | Canonical tracker skin geometry (2048 × 768, 8:3) so components inherit rather than hardcode it |
| `GET` | `/api/state` | Combined settings, live state, and recent actions |
| `GET` / `PUT` | `/api/settings` | Normal stream and countdown settings only |
| `GET` | `/api/live` | Live resource and reader state |
| `PUT` | `/api/live/reconcile` | One-time current totals: `{ "amber": 0, "essence": 0, "sweetLeaf": 0 }` |
| `GET` | `/api/live/{amber|essence|sweetLeaf}` | One resource value |
| `PUT` | `/api/live/{resource}/correct` | Deliberate manual correction: `{ "value": 123 }` |
| `GET` / `POST` | `/api/actions` | Recent actions and safe command requests |
| `GET` | `/events` | Server-Sent Events: `snapshot`, `settings`, `live`, `action`. Optional `?role=control` / `?role=overlay` identifies the client so the dashboard can confirm Meld is connected |

Current safe action targets are `reader.rescan`, `session.set-mode`, and `overlay.ping`. No action starts, kills, or controls unrelated Windows programs.

## Verification

### Safe automated check

Run this from the ICB Clean folder:

```powershell
npm.cmd run test:e2e
```

The test uses a temporary port (`8791`), temporary data directory, and synthetic Palia Assistant log. It does not touch the live `data` folder or your real Palia log. It verifies:

- Startup and health identity
- State separation
- Stale-log/offline status
- Settings save
- Manual correction
- SSE snapshot, live update, and action update
- Amber, Essence, and Sweet Leaf log deltas from `Inventory gained:`/`Inventory lost:` lines
- `Lockbox gained:` as a real gain source
- A real-shaped `Primary gained:` full-container resync is read but does **not** change any total
- A quality/rarity marker (`(1*)`) between the item token and quantity is still parsed
- Both pages serve, and the dashboard carries the "Run the system" panel
- Overlay-connection detection (`connectedClients.overlay` goes 0 → 1 when an overlay client attaches)
- Persistence through a server restart

### Real one-time tracker acceptance check

Do this only when ready to validate real gameplay:

1. Start ICB Clean and confirm Chrome shows **current totals needed**.
2. Enter the three real in-game totals once in the reconciliation panel.
3. Open `/api/diagnostics` and confirm the expected Palia Assistant log path.
4. Start Palia Assistant, then Palia.
5. Collect one known Amber, Essence, or Sweet Leaf item.
6. Confirm exactly one matching increment in Chrome and the overlay.
7. If it does not update, stop and inspect `/api/diagnostics`; do not start a legacy tracker or reset totals.

## Troubleshooting and recovery

### Dashboard cannot connect

Run `start-icb-clean.bat`, then open `/api/health`. It must identify itself as `ICB Clean Room` on port `8790`.

For the same check without opening a browser, run `diagnose-icb-clean.bat`. It reports the server identity, reader state, reconciliation requirement, and watched log path.

### Reader says offline

Offline is expected if Palia Assistant is closed or the newest log has not changed for ten minutes. Start Palia Assistant and Palia, then generate one known item event. Use `/api/diagnostics` to confirm the watched file.

### Counts look wrong

If reconciliation has not been completed, enter all three current in-game totals in the Chrome reconciliation panel. After that, confirm the in-game number and use the matching dashboard correction. Do not copy a legacy JSON file over `data/live.json`.

### Before changing server files

1. Run `npm.cmd run test:e2e`.
2. Run `backup-icb-clean-state.bat`. It creates a timestamped backup under `backups\` containing `data/settings.json`, `data/live.json`, `data/actions.jsonl`, and the historical snapshot.
3. Confirm `/api/health` says port `8790` and `ICB Clean Room`.
4. Change one thing at a time, then rerun the test.

### Do not do these things

- Do not run `C:\StreamLive\tracker.py` alongside ICB Clean.
- Do not point Meld at `control.html`.
- Do not use `file://` URLs for Chrome or Meld.
- Do not use browser storage as tracker state.
- Do not kill an unknown process on port `8787`.

## Official Resource Tracker Skin Standard

**Master resolution 2048 × 768 px, aspect ratio 8:3.** Adopted 2026-08-14. Required for every ICB resource tracker skin unless Baby explicitly overrides it.

| Field | Value |
| --- | --- |
| Master resolution | 2048 × 768 px |
| Aspect ratio | 8:3 |
| Purpose | Stackable stream resource tracker skins |
| Live value | Dynamically rendered by ICB; **NOT** baked into artwork |
| Value box position | Directly underneath the resource title |
| Default status | Required for future standard resource trackers unless Baby explicitly overrides it |

The full specification lives in **[docs/ICB-TRACKER-SKIN-STANDARD.md](ICB-TRACKER-SKIN-STANDARD.md)**. The machine-readable source of truth is **`config/tracker-skin-standard.json`**, served live at `GET /api/tracker-skin-standard` and summarised in `/api/diagnostics`. `js/test/e2e.js` asserts the standard, so it cannot be changed silently.

Two rules worth repeating here because they are the easy ones to get wrong:

- **The value box is blank in the artwork.** Never bake `1234`, `10,122`, `x1234` or any placeholder count into a skin. ICB draws the live number on top of that blank area at runtime.
- **2048 × 768 is the master size, not the display size.** The overlay may scale skins down proportionally; the 8:3 ratio must be preserved. Never stretch, crop, or letterbox to a different ratio.

**Master template geometry is confirmed** (2026-08-14, from Baby's Tracker Card Master Template). This guides new artwork; runtime boxes are measured per skin as described below. Coordinates are master pixels, origin top-left:

| Zone | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Safe area | 64 | 64 | 1920 | 640 |
| Title zone | 128 | 96 | 1792 | 260 |
| Value box zone | 448 | 392 | 1152 | 280 |

Corner radius 64. Both zones centred on x = 1024. Keep key text and artwork inside the safe area.

**Value boxes are per-skin.** The zone table above is design guidance for new artwork. Each real card declares its own value box in `skins.cards[].valueBox` in the config, measured from the artwork and verified visually; ICB renders the live value into whichever card is showing. Cards do not need matching box positions — that was attempted and abandoned because image generation cannot hit pixel targets. Still mandatory per card: canvas exactly 2048 × 768, blank value box, PNG with transparent corners.

Use the current skin configuration and `config/resource-trackers.json` for card mappings and local artwork paths. Do not depend on an old desktop folder or a historical card count.

A layout guide at true master size is provided at `docs/tracker-skin-template.svg` — open it in a browser or art tool as a reference. It is a guide, not a skin.

## Future resource trackers

Do not add generic trackers from the Chrome dashboard. Each new in-game resource is a deliberate build request so it can have its own artwork and stream treatment.

New trackers automatically inherit the skin standard above — there is no need to ask Baby for the size again.

For every new tracker, record and verify:

1. The exact Palia Assistant `itemtype_...` token from a real log line. Never guess a token from an item name.
2. The current in-game starting total.
3. The custom artwork (2048 × 768, 8:3, blank value box) and intended Meld overlay dimensions.
4. The server definition, API output, SSE update, persistence behavior, and automated test.
5. The Browser-layer URL and any cache-busting version used by Meld.

Gold Ore, Palium, and Celebration Cakes are implemented. Inspect the current resource configuration before planning another tracker.

Whoever builds the tracker package updates this runbook as part of that work. The Chrome dashboard remains the private control surface; Meld remains a read-only visual consumer.

## Future integrations

Any MCP, Streamer.bot, Discord, or scene-control integration must be a separate adapter and must not become another competing state server.

## Contributor setup and source policy

Read `AGENTS.md`, `RULES.md`, and `UPDATES.md`; re-read them after another contributor makes changes. `CLAUDE.md` contains pointers only. The handbook is a historical method record.

Run `npm run setup:hooks` for a fresh checkout (`npm install` also does this). Never recreate root `server.js`: `npm start` and the launchers use `js/server/index.js`. New features belong in focused modules, and maintained source must stay within 500 lines and 40 KB per file. The hook checks staged contents; GitHub Actions independently checks committed source.

After any changes, run `npm run check:structure`, `npm run format:check`, `npm run test:unit`, and `npm run test:e2e`; run `npm run test:browser` after browser changes. Tests use temporary state and port 8791. Do not restart the live server or control the user's desktop for verification. Record failures honestly, update `UPDATES.md`, then commit and push the coherent project work.
