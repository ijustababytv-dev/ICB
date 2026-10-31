# ICB project structure

Updated 2026-10-31. The local application remains one dependency-free Node server at `http://127.0.0.1:8790`. Existing page and API URLs remain unchanged.

| Location | Responsibility |
| --- | --- |
| `local-server/src/index.js` | Create the state directory and start ICB |
| `local-server/src/server.js` | HTTP listener, page routing, connections, startup and shutdown |
| `local-server/src/http/` | API dispatch, JSON bodies/responses, public-file routing |
| `local-server/src/routes/` | Route families formerly embedded in the main API function |
| `local-server/src/domain/` | Local parsing, normalized inputs, validation and visual helpers |
| `local-server/src/*.js` | Thin cache adapters, machine state and transient graphical handlers |
| `local-server/src/giveaway/` | Read-only giveaway cache/recovery adapters; signup rules are in cloud models |
| `local-server/src/views/` | Server-rendered resource, weekly, and ticker overlays |
| `local-server/src/background.js` | Explicit background-job scheduling; imports do not start timers |
| `ui/html/` | All dashboard and overlay HTML, including `ui/html/wk/` |
| `ui/js/` | Page startup scripts, with large features split into named subfolders |
| `ui/js/vendor/` | Existing local Matter.js and Meld Firehose distributions |
| `ui/css/` | Page styles |
| `ui/images/embedded/` | Images extracted from former inline data URLs; ordinary local files |
| `assets/` | Existing operator-managed artwork and audio; still excluded from Git |
| `terraform/` | RDS/network, private releases, service secret/IAM, logs/alarms, and gated Express Lambda/HTTP API; separate from the local application |
| `local-server/bridge/` | Palia log bridge; its existing cursor stays in `bridge/` |
| `tools/` | Repository source-policy, hooks, and formatter |
| `local-server/tools/` | Image sync/download and historical activity import |
| `local-server/desktop/js/` | Electron code; its package and lockfile stay in `local-server/desktop/` |
| `local-server/test/unit/` | Node built-in unit tests and structural guards |
| `local-server/test/e2e.js`, `local-server/test/helpers/` | HTTP, persistence, log-reader, and asset integration tests |
| `ui/test/browser.js` | Optional headless Chromium checks with a separate temporary browser profile |
| `local-server/config/`, ignored `data/` | Versioned public definitions and machine transport/recovery files; live feature state is in SQL |

## Adding or changing behavior

Cloud feature rules live in `cloud-server/src/features/models/`, with static
transaction-scoped factories and pure rules in `cloud-server/src/domain/`.
`features/commands.js` locks an owner, verifies authority/revision and retry receipt,
executes rules and commits typed state, summaries, audit and revisions together.
`features/projections/` maps settings separately from typed child/progress rows.
`features/feed.js` serves consistent, owner-bound paginated snapshots and changed
views. It finalizes elapsed deadlines using database time. Display events expire.

`local-server/src/cloud/` owns one two-second state feed, versioned RAM caches,
minimal command proxies and process-only sessions. Local URLs and SSE remain.
`local-server/src/inputs/` and `activity/` retain ordered owner-bound transport,
Palia byte cursors, compact chat counts/presence and recognized intents. No local
award/reset/timer/Steam business loop or feature JSON writer remains. Raw visual
chat stays bounded in local RAM. `assets/` handles ordinary local image files and
metadata references; deletion waits for an acknowledged cloud edit.

`cloud-server/src/worker/` is a normal Node handler, without Express/Web Adapter.
One minute Scheduler ticks claim at most two leased jobs, with one DB connection
and bounded provider I/O outside SQL transactions. Steam results are fenced by
lease, owner revision and exact Secrets Manager credential version. Idle giveaway
maintenance creates retained SQL recovery snapshots. Scheduler delivery failures
and accepted Lambda execution failures both reach a private SQS queue.

Database object sources remain in `database/tables/` and the other object folders;
checksum-pinned administrative install manifests live in `database/upgrades/`.
Their retained SQL bundles are versioned separately from the runtime package in
the private release bucket. Do not run DDL in a Lambda cold start or HTTP handler.
See [feature/field ownership](STEP2-FEATURE-MAP.md) and [operation/recovery](STEP2-OPERATIONS.md).

Read `AGENTS.md`, `RULES.md`, and `UPDATES.md`, then the historical handbook. `CLAUDE.md` points to those documents and contains no independent rules. Put business rules in small domain functions when practical, keep file/network effects in feature modules, and connect cross-feature behavior explicitly. Transaction-scoped signup coordination is connected after its three stores load; sprite/jar coordination lives in a route module. There are no circular imports, runtime source concatenation, or eval-based modules.

Add unit tests for every new or changed business rule, covering relevant boundaries and failure cases. Feature tests that need persistence must point `ICB_CLEAN_DATA_DIR` at a fresh temporary folder before importing the feature. Never import `local-server/src/index.js` in a unit test: that entry point starts the server.

Maintained JS/TS, HTML, and CSS have a 500-line / 40 KB ceiling, enforced by `tools/source-policy.js`, unit tests, a staged-source pre-commit hook, and GitHub Actions. Only two checksum-pinned vendor distributions are exempt. Split by responsibility rather than packing more statements onto each line. Preserve meaningful function comments and business-rule explanations.

Never restore root `server.js`, including a forwarding stub. It was accidentally restored in October and diverged from the active modular server. Its Sprite TV and Poke Bowl attendance changes now live in `cloud-server/src/features/models/sprite-tv.js`, the cloud signup modules, and tested domain functions. Sprite TV pages use separate HTML, CSS, and browser scripts. The duplicate root sprite jar page was retired; the existing modular jar retains its fuller behavior. The main server remains composition and lifecycle wiring only.

Browser feature files load before their page's startup script. Aniimo editing, dashboard panels, reports, signup controls, jar physics, drawing, and animation each have focused files. Private overlay state is passed to feature factories through explicit accessors so replacement state remains visible. Server API and chat modules use the same explicit context pattern; static options live separately from mutable state.

JavaScript uses four-space indentation and a blank line between function definitions, including their documentation comments. `.editorconfig` and `.prettierrc.json` record the layout; `.gitattributes` keeps script line endings consistent across checkouts. The formatter uses pinned Prettier and Acorn tools through npm's external cache, adds function spacing, and rejects changes to the parsed program. It also formats local JavaScript utilities under `assets/`, while leaving vendor distributions and ignored-file tracking unchanged.

## Images and URLs

All previously embedded base64 image assets are files in `ui/images/embedded/`; repeated images share the same file. Browser scripts keep the public URL `/images/embedded/<file>`. Existing artwork URLs under `/assets/` and `/resource-art/` still work. Image upload request encoding is transport, not an embedded asset.

Baby selected Cloudinary on 2026-10-22. `npm run images:plan` compares local originals with Cloudinary; `npm run images:sync` uploads only new or changed files and records their URLs. See `docs/CLOUDINARY.md`. Overlays continue using local image files. The extracted images are versioned because they were previously part of tracked source; operator-managed `assets/` remains ignored.

The public server maps `/control.html` to `ui/html/control.html`, `/` to `ui/html/hub.html`, and the old `/matter.min.js` and `/meld-firehose.js` URLs to `ui/js/vendor/`. Server source, test source, and `data/` are not public static roots. Never put the private dashboard in Meld.

## Running and checking

`npm run images:download` retrieves ICB images into `assets/`, verifies their contents, skips identical files, and backs up replacements. Files from `images/` and `docs/` are copied under the reserved `assets/cloudinary/` folder; upload inventory excludes those copies to avoid duplicate IDs. `npm run images:download:plan` previews without writing files.

Use the existing batch launchers or `npm start`. No second production server and no port change are needed. Code changes take effect after the next normal ICB restart. A source refactor must not restart an active stream without authorization.

- `npm run test:unit`: isolated business rules, source syntax, file layout, size limits, local references, and import cycles.
- `npm run test:e2e`: temporary port 8791, temporary state, synthetic log, restart persistence, all feature GET routes, and browser assets. It never uses live tracker state.
- `npm run test:browser`: representative pages in a separate headless Chromium process, including Aniimo editing, walker animation, giveaway drawing, Sprite TV, and signup attendance. Set `ICB_TEST_CHROME` if Chromium is not in a standard location. Set `ICB_TEST_SCREENSHOTS` to a local output directory to retain screenshots.
- `npm run setup:hooks`: install the repository pre-commit guard for this checkout; also runs during `npm install`. It checks the complete staged snapshot and refuses oversized or misplaced source, changed vendor exemptions, embedded image assets, and root server restoration.
- `npm run check:structure`: run the same policy against the working tree. GitHub Actions runs this, unit tests, and formatting checks on pushes and pull requests. Local E2E/browser checks still need the operator's ignored artwork. Branch protection is a repository-owner setting, not installed by this command.
- `npm run format:js`: format all maintained JavaScript, including function spacing; no application dependencies are added.
- `npm run format:check`: verify formatting and preserve parsed behavior without writing files.
- `npm test`: unit tests followed by end-to-end tests.

Known existing artwork issue (the complete nine-file list is in STEP2-VALIDATION.md): `local-server/config/resource-trackers.json` references `assets/resources/poke_bowl.png`, which is absent in this checkout. End-to-end tests finish the remaining checks and then fail with the missing-art list. Restore the original artwork to that path; do not fabricate a replacement or suppress the assertion.


## Cloud and local boundaries

`cloud-server/src/activity/` owns authentication, minimal reporting ingestion,
summary SQL and report DTOs. `features/` owns all migrated feature mutations.
Historical reports and their quality flags are preserved; historical imports never
run live award rules. Legacy recovery PUTs and client-decided award deltas are
fenced for cloud-owned features. Deduplication receipts are retained.

The independent cloud package contains Express 5, pg, pg-format and the scoped
Secrets Manager SDK. The local runtime uses built-in Node modules only. Browser
code sees local DTOs/revisions and a short-lived local CSRF capability, never cloud
bearer tokens, SQL credentials, provider keys or filesystem access.

`database/` owns per-object definitions, limited-role grants, the `icb` namespace,
immutable upgrade history, source catalog, CA certificates and recovery commands.
The runtime role cannot create objects or change account passwords. Integration
credentials live in separate owner-scoped secrets, not the database secret.

Existing daily report URLs remain summary adapters. `/api/feature-reports/` adds
bounded, authorized JSON/CSV for commands, awards, draws, signups, turns, resources
and archives. Unavailable data is explicit rather than invented zero totals.
