# ICB Clean

This is a clean-room rebuild of the IJUSTABABY Control Center. It is intentionally separate from the existing `ICB` and `C:\StreamLive` projects.

The canonical operating and recovery instructions are in [docs/ICB-CLEAN-RUNBOOK.md](docs/ICB-CLEAN-RUNBOOK.md). Treat that document and this folder as the only source of truth for ICB Clean.

**Working on this project with an AI assistant?** Start with [CLAUDE.md](CLAUDE.md) — it carries the standing decisions (tracker skin standard, architecture constraints, log-parsing rules) so they do not have to be reconstructed each session.

## Official Resource Tracker Skin Standard

All ICB resource tracker skins are **2048 × 768 px, aspect ratio 8:3**, with the live value box left **blank** in the artwork — ICB renders the number on top at runtime.

- Specification: [docs/ICB-TRACKER-SKIN-STANDARD.md](docs/ICB-TRACKER-SKIN-STANDARD.md)
- Source of truth: [config/tracker-skin-standard.json](config/tracker-skin-standard.json), served at `/api/tracker-skin-standard`
- Layout guide: [docs/tracker-skin-template.svg](docs/tracker-skin-template.svg)

## One workflow

Run `start-icb-clean.bat`, then use the private operator dashboard in Google Chrome:

```text
http://127.0.0.1:8790/control.html
```

This dashboard is for you, off stream. Do not add `control.html` as a Meld layer.

For a one-click health and tracker check, run `diagnose-icb-clean.bat`.

Before any future update, run `backup-icb-clean-state.bat` to make a timestamped copy of the clean state files.

Only the read-only display belongs in Meld Studio:

```text
http://127.0.0.1:8790/overlay.html
```

Port `8790` is deliberate during the clean rebuild. It prevents an accidental collision with an older tracker. Only after this build passes its checks should a future migration decision be made about port `8787`.

## What this first build owns

- One dependency-free Node server.
- One private command-center dashboard for Chrome.
- One read-only overlay for Meld Studio.
- Separate stream settings and live tracker state.
- Palia Assistant log reading for Amber Echo, Infected Essence, and Sweet Leaf.
- A one-time reconcile step when historical totals are no longer current.
- SSE updates at `/events`.
- Deliberate tracker corrections at `/api/live/{resource}/correct`.
- The canonical tracker skin standard, served at `/api/tracker-skin-standard`.
- A small, explicit command API for reader rescan, session mode, and overlay ping.

It does not start or kill unrelated programs, expose a public network port, use MCP, or silently treat legacy tracker totals as current. Those can be added only after this foundation is verified.

## Test

From PowerShell:

```powershell
npm.cmd run test:e2e
```

For a test log, set `ICB_CLEAN_PALIA_LOG_FILE` or `ICB_CLEAN_PALIA_LOG_DIR`. Normal use searches the standard Palia Assistant log directories.

## Project structure and tests

The server starts at `js/server/index.js`. HTML is in `html/`, scripts in `js/`, styles in `css/`, and local extracted images in `images/embedded/`. Existing URLs and batch launchers still work. See [the architecture map](docs/ARCHITECTURE.md).

Run `npm run test:unit` and `npm run test:e2e` after changes; `npm run test:browser` checks representative pages in an isolated headless browser. Every new or changed business rule needs unit tests. The E2E suite currently reports the pre-existing missing `assets/resources/poke_bowl.png` file.
