# ICB project structure

Updated 2026-10-24. The application is still one dependency-free Node server at `http://127.0.0.1:8790`. Existing page and API URLs remain unchanged.

| Location | Responsibility |
| --- | --- |
| `local-server/src/index.js` | Create the state directory and start ICB |
| `local-server/src/server.js` | HTTP listener, page routing, connections, startup and shutdown |
| `local-server/src/http/` | API dispatch, JSON bodies/responses, public-file routing |
| `local-server/src/routes/` | Route families formerly embedded in the main API function |
| `local-server/src/domain/` | Testable counting, reset, parsing, validation, and time rules |
| `local-server/src/*.js` | Feature state, persistence, and feature-specific handlers |
| `local-server/src/giveaway/`, `local-server/src/signups/` | Related feature modules |
| `local-server/src/views/` | Server-rendered resource, weekly, and ticker overlays |
| `local-server/src/background.js` | Explicit background-job scheduling; imports do not start timers |
| `html/` | All dashboard and overlay HTML, including `html/wk/` |
| `ui/js/` | Page startup scripts, with large features split into named subfolders |
| `ui/js/vendor/` | Existing local Matter.js and Meld Firehose distributions |
| `css/` | Page styles |
| `ui/images/embedded/` | Images extracted from former inline data URLs; ordinary local files |
| `assets/` | Existing operator-managed artwork and audio; still excluded from Git |
| `terraform/` | RDS/network, private releases, service secret/IAM, logs/alarms, and gated Express Lambda/HTTP API; separate from the local application |
| `local-server/bridge/` | Palia log bridge; its existing cursor stays in `bridge/` |
| `tools/` | Standalone image sync and JavaScript formatting commands; never started by the server |
| `local-server/desktop/js/` | Electron code; its package and lockfile stay in `local-server/desktop/` |
| `local-server/test/unit/` | Node built-in unit tests and structural guards |
| `local-server/test/e2e.js`, `local-server/test/helpers/` | HTTP, persistence, log-reader, and asset integration tests |
| `ui/test/browser.js` | Optional headless Chromium checks with a separate temporary browser profile |
| `local-server/config/`, `data/` | Definitions and live progress, respectively; keep them separate |

## Adding or changing behavior

Read `AGENTS.md`, `RULES.md`, and `UPDATES.md`, then the historical handbook. `CLAUDE.md` points to those documents and contains no independent rules. Put business rules in small domain functions when practical, keep file/network effects in feature modules, and connect cross-feature behavior explicitly. Signup coordination is connected after its three stores load; sprite/jar coordination lives in a route module. There are no circular imports, runtime source concatenation, or eval-based modules.

Add unit tests for every new or changed business rule, covering relevant boundaries and failure cases. Feature tests that need persistence must point `ICB_CLEAN_DATA_DIR` at a fresh temporary folder before importing the feature. Never import `local-server/src/index.js` in a unit test: that entry point starts the server.

Maintained JS/TS, HTML, and CSS have a 500-line / 40 KB ceiling, enforced by `tools/source-policy.js`, unit tests, a staged-source pre-commit hook, and GitHub Actions. Only two checksum-pinned vendor distributions are exempt. Split by responsibility rather than packing more statements onto each line. Preserve meaningful function comments and business-rule explanations.

Never restore root `server.js`, including a forwarding stub. It was accidentally restored in October and diverged from the active modular server. Its Sprite TV and Poke Bowl attendance changes now live in `local-server/src/sprite-tv.js`, the signup modules, and tested domain functions. Sprite TV pages use separate HTML, CSS, and browser scripts. The duplicate root sprite jar page was retired; the existing modular jar retains its fuller behavior. The main server remains composition and lifecycle wiring only.

Browser feature files load before their page's startup script. Aniimo editing, dashboard panels, reports, signup controls, jar physics, drawing, and animation each have focused files. Private overlay state is passed to feature factories through explicit accessors so replacement state remains visible. Server API and chat modules use the same explicit context pattern; static options live separately from mutable state.

JavaScript uses four-space indentation and a blank line between function definitions, including their documentation comments. `.editorconfig` and `.prettierrc.json` record the layout; `.gitattributes` keeps script line endings consistent across checkouts. The formatter uses pinned Prettier and Acorn tools through npm's external cache, adds function spacing, and rejects changes to the parsed program. It also formats local JavaScript utilities under `assets/`, while leaving vendor distributions and ignored-file tracking unchanged.

## Images and URLs

All previously embedded base64 image assets are files in `ui/images/embedded/`; repeated images share the same file. Browser scripts refer to `/ui/images/embedded/<file>`. Existing artwork URLs under `/assets/` and `/resource-art/` still work. Image upload request encoding is transport, not an embedded asset.

Baby selected Cloudinary on 2026-10-22. `npm run images:plan` compares local originals with Cloudinary; `npm run images:sync` uploads only new or changed files and records their URLs. See `docs/CLOUDINARY.md`. Overlays continue using local image files. The extracted images are versioned because they were previously part of tracked source; operator-managed `assets/` remains ignored.

The public server maps `/control.html` to `html/control.html`, `/` to `html/hub.html`, and the old `/matter.min.js` and `/meld-firehose.js` URLs to `ui/js/vendor/`. Server source, test source, and `data/` are not public static roots. Never put the private dashboard in Meld.

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

Known existing asset issue at restructuring: `local-server/config/resource-trackers.json` references `assets/resources/poke_bowl.png`, which is absent in this checkout. End-to-end tests finish the remaining checks and then fail with the missing-art list. Restore the original artwork to that path; do not fabricate a replacement or suppress the assertion.
