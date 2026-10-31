# ICB Clean

ICB (IJUSTABABY Control Bridge) is a local control center for Palia resource tracking, stream tools, and read-only Meld Studio overlays. This checkout is the active project; `C:\StreamLive` and older ICB folders are legacy.

This README is the overview and quick start. Operating and recovery procedures are in [the runbook](docs/ICB-CLEAN-RUNBOOK.md).

**Before contributing, including with an AI assistant:** read [AGENTS.md](AGENTS.md) for project decisions, [RULES.md](RULES.md) for engineering rules, and [UPDATES.md](UPDATES.md) for recent changes. [CLAUDE.md](CLAUDE.md) only points to those files and this README. Re-read them when another contributor changes them.

## Official Resource Tracker Skin Standard

All ICB resource tracker skins are **2048 × 768 px, aspect ratio 8:3**, with the live value box left **blank** in the artwork — ICB renders the number on top at runtime.

- Specification: [docs/ICB-TRACKER-SKIN-STANDARD.md](docs/ICB-TRACKER-SKIN-STANDARD.md)
- Source of truth: [local-server/config/tracker-skin-standard.json](local-server/config/tracker-skin-standard.json), served at `/api/tracker-skin-standard`
- Layout guide: [docs/tracker-skin-template.svg](docs/tracker-skin-template.svg)

## Start and operate ICB

Run `start-icb-clean.bat` (or `npm start`). The hub is at `http://127.0.0.1:8790/`; the private tracker dashboard in Google Chrome is:

```text
http://127.0.0.1:8790/control.html
```

This dashboard is for you, off stream. Do not add `control.html` as a Meld layer.

For a one-click health and tracker check, run `diagnose-icb-clean.bat`.

Before any future update, run `backup-icb-clean-state.bat` to make a timestamped copy of the clean state files.

Meld Studio gets read-only overlay pages, such as the main overlay:

```text
http://127.0.0.1:8790/overlay.html
```

Dedicated layers such as `/weekly.html`, `/ticker.html`, resource cards, and `/sprite-tv.html` also belong in Meld. Copy the appropriate layer URL from its control page.

Use **one production server on port 8790**. Do not migrate to port 8787 or start a competing server. Source edits take effect at the next normal restart; do not restart an active stream as part of an edit.

## What the application provides

- One dependency-free Node server.
- Private operator dashboards and a hub for the stream tools.
- Read-only overlay pages for Meld Studio.
- Separate stream settings and live tracker state.
- Palia Assistant log reading, resource cards, and weekly accomplishments.
- Reconciliation and deliberate corrections when tracked totals need updating.
- Tools including giveaways, signups and attendance, countdowns, sprite collection displays, and Sprite TV.
- Local image files with explicit Cloudinary upload and download commands.

Existing integration endpoints include:

- SSE updates at `/events`.
- Deliberate tracker corrections at `/api/live/{resource}/correct`.
- The canonical tracker skin standard, served at `/api/tracker-skin-standard`.
- A small, explicit command API for reader rescan, session mode, and overlay ping.

Settings and live progress stay separate. Historical snapshots are never automatically treated as current totals.

## Contributor setup and checks

Use Node.js and npm; the application has no runtime package dependencies. From PowerShell in this folder, install the local commit guard once per checkout:

```powershell
npm.cmd run setup:hooks
```

After changes, including documentation:

```powershell
npm.cmd run check:structure
npm.cmd run format:check
npm.cmd run test:unit
npm.cmd run test:e2e
```

Run `npm.cmd run format:js` to apply JavaScript formatting and `npm.cmd run test:browser` after browser changes. Every new or changed business rule requires unit tests. E2E and browser tests use port 8791 and temporary state; browser checks use a separate headless profile.

The E2E suite currently reports the existing missing `assets/resources/poke_bowl.png`. Restore the original artwork; do not suppress the check.

For a test log, set `ICB_CLEAN_PALIA_LOG_FILE` or `ICB_CLEAN_PALIA_LOG_DIR` in the isolated test environment. Normal use searches the standard Palia Assistant log directories.

## Source layout and images

The server starts at `local-server/src/index.js`. HTML is in `html/`, scripts in `js/`, styles in `css/`, and local extracted images in `ui/images/embedded/`. Operator artwork remains in the ignored `assets/` folder. Existing URLs and batch launchers still work. See [the architecture map](docs/ARCHITECTURE.md).

The pre-commit hook and source-policy checks enforce the file limits and layout defined in `RULES.md`. Never restore root `server.js`; add features in focused modules.

Overlays read local images. Cloudinary sync is explicit: `npm run images:plan` previews uploads and `npm run images:sync` uploads new or changed originals. `npm run images:download:plan` previews downloads and `npm run images:download` restores into `assets/`, skipping identical files and backing up replacements. See [the Cloudinary guide](docs/CLOUDINARY.md) for credential setup and file mappings.

## Documentation map

| Document | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Standing project decisions and contributor instructions |
| [RULES.md](RULES.md) | Mandatory code, test, formatting, documentation, and delivery rules |
| [UPDATES.md](UPDATES.md) | Completed work from the last seven days |
| [Runbook](docs/ICB-CLEAN-RUNBOOK.md) | Operation, diagnostics, backup, and recovery |
| [Architecture](docs/ARCHITECTURE.md) | Module responsibilities and development commands |
| [Master handbook](docs/ICB-MASTER-HANDBOOK.md) | Historical methods, failures, and tracker recipes; check current rules before acting |
| [Skin standard](docs/ICB-TRACKER-SKIN-STANDARD.md) | Artwork dimensions, blank value boxes, and per-skin measurements |
| [Cloudinary guide](docs/CLOUDINARY.md) | Image upload/download setup and behavior |
