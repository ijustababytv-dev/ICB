# ICB project structure

Updated 2026-10-22. The application is still one dependency-free Node server at `http://127.0.0.1:8790`. Existing page and API URLs remain unchanged.

| Location | Responsibility |
| --- | --- |
| `js/server/index.js` | Create the state directory and start ICB |
| `js/server/server.js` | HTTP listener, page routing, connections, startup and shutdown |
| `js/server/http/` | API dispatch, JSON bodies/responses, public-file routing |
| `js/server/routes/` | Route families formerly embedded in the main API function |
| `js/server/domain/` | Testable counting, reset, parsing, validation, and time rules |
| `js/server/*.js` | Feature state, persistence, and feature-specific handlers |
| `js/server/giveaway/`, `js/server/signups/` | Related feature modules |
| `js/server/views/` | Server-rendered resource, weekly, and ticker overlays |
| `js/server/background.js` | Explicit background-job scheduling; imports do not start timers |
| `html/` | All dashboard and overlay HTML, including `html/wk/` |
| `js/client/` | Browser scripts; unicorn-jar code is split by responsibility |
| `js/vendor/` | Existing local Matter.js and Meld Firehose distributions |
| `css/` | Page styles |
| `images/embedded/` | Images extracted from former inline data URLs; ordinary local files |
| `assets/` | Existing operator-managed artwork and audio; still excluded from Git |
| `js/bridge/` | Palia log bridge; its existing cursor stays in `bridge/` |
| `desktop-widgets/js/` | Electron code; its package and lockfile stay in `desktop-widgets/` |
| `js/test/unit/` | Node built-in unit tests and structural guards |
| `js/test/e2e.js`, `js/test/helpers/` | HTTP, persistence, log-reader, and asset integration tests |
| `js/test/browser.js` | Optional headless Chromium checks with a separate temporary browser profile |
| `config/`, `data/` | Definitions and live progress, respectively; keep them separate |

## Adding or changing behavior

Read the handbook, `CLAUDE.md`, and `RULES.md` first. Put business rules in small domain functions when practical, keep file/network effects in feature modules, and connect cross-feature behavior explicitly. Signup coordination is connected after its three stores load; sprite/jar coordination lives in a route module. There are no circular imports, runtime source concatenation, or eval-based modules.

Add unit tests for every new or changed business rule, covering relevant boundaries and failure cases. Feature tests that need persistence must point `ICB_CLEAN_DATA_DIR` at a fresh temporary folder before importing the feature. Never import `js/server/index.js` in a unit test: that entry point starts the server.

Maintained JS, HTML, and CSS have a 500-line / 40 KB ceiling, enforced by `structure.test.js`. Split by responsibility rather than packing more statements onto each line. Existing vendor distributions are exempt. Preserve meaningful function comments and business-rule explanations.

## Images and URLs

All previously embedded base64 image assets are files in `images/embedded/`; repeated images share the same file. Browser scripts refer to `/images/embedded/<file>`. Existing artwork URLs under `/assets/` and `/resource-art/` still work. Image upload request encoding is transport, not an embedded asset.

Keep image hosting local until Baby supplies her cloud decision. Do not add a storage service, account, SDK, or upload workflow preemptively. The extracted images are versioned because they were previously part of tracked source; operator-managed `assets/` remains ignored.

The public server maps `/control.html` to `html/control.html`, `/` to `html/hub.html`, and the old `/matter.min.js` and `/meld-firehose.js` URLs to `js/vendor/`. Server source, test source, and `data/` are not public static roots. Never put the private dashboard in Meld.

## Running and checking

Use the existing batch launchers or `npm start`. No second production server and no port change are needed. Code changes take effect after the next normal ICB restart. A source refactor must not restart an active stream without authorization.

- `npm run test:unit`: isolated business rules, source syntax, file layout, size limits, local references, and import cycles.
- `npm run test:e2e`: temporary port 8791, temporary state, synthetic log, restart persistence, all feature GET routes, and browser assets. It never uses live tracker state.
- `npm run test:browser`: nine representative pages in a separate headless Chromium process. Set `ICB_TEST_CHROME` if Chromium is not in a standard location. Set `ICB_TEST_SCREENSHOTS` to a local output directory to retain screenshots.
- `npm test`: unit tests followed by end-to-end tests.

Known existing asset issue at restructuring: `config/resource-trackers.json` references `assets/resources/poke_bowl.png`, which is absent in this checkout. End-to-end tests finish the remaining checks and then fail with the missing-art list. Restore the original artwork to that path; do not fabricate a replacement or suppress the assertion.
