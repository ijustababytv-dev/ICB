# Updates

## New Features

- 2026-11-01: Implemented required Cloud sign-in for all pages, overlays, artwork and feature APIs, with Windows-protected fixed 14-day remembered sessions. Deployed the cloud session update; local activation requires a normal authorized restart.

- 2026-10-31: Added top/bottom arrow Home and Cloud sign-in links to all 34 operator pages, plus a Home directory of all dashboards, overlays, resource cards and connection tools. Stream overlays stay clean.
- 2026-10-31: Added AWS.md with Steam key replacement steps, infrastructure basics, credential locations and administration/recovery references.
- 2026-10-31: Deployed Step 2 cloud feature execution: Express/Lambda owns saved settings, signups/attendance, Turn Line, giveaways, polls/teams/hunts, trackers/weekly progress, timers, collections and Steam. Imported and compared all 32 owner features; preserved the existing account/password and 34 historical reporting days.
- 2026-10-31: Added the leased ARM64 scheduled worker, separate owner integration secrets, private failure queue, delivery/execution alarms and a console-visible $30 account budget. Existing AWS resources keep the baby-icb- prefix.
- 2026-10-31: Completed Step 1 login, minimal count/support ingestion, independent SQL reports/CSV, owner isolation and durable transport. Raw chat wording is no longer archived.

- 2026-10-30: Added Terraform for a micro AWS PostgreSQL database, public VPC/subnets, internet-accessible PostgreSQL firewall, password authentication, mandatory TLS, backups, and deployment instructions. Infrastructure has not been applied.
- 2026-10-29: Vampire Crab Dishes tracker card (`/crab-dishes.html`): Crab Gumbo, Spicy Crab Fried Rice and Crab Pot Pie as three countdown boxes on one art card (replaces the three separate cards). Each box takes 1 off per cook line of its dish. Collection cards can now have countdown boxes, with a per-box 'Set & restock' on the Tracker Command Center.
- 2026-10-29: Vampire Crab Pot Pie tracker card (`/crab-pot-pie.html`): counts down from 100, 1 per cook line of `itemtype_c_crabpotpie` (token from her; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-29: Spicy Vampire Crab Fried Rice tracker card (`/crab-fried-rice.html`): counts down from 100, 1 per cook line of `itemtype_c_crabfriedrice` (token from her; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-29: Vampire Crab Gumbo tracker card (`/crab-gumbo.html`): counts down from 100, 1 per cook line of `itemtype_c_crabgumbo` (token from her; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-29: Turn Line (tile on ICB Home): viewers type `!turn` to join a line to take turns starting the same dish. The person whose turn it is shows green, finished people turn red, the rest wait in white. One Done button moves to the next person (plus Undo, Skip to back, reorder, remove, New round). `!leave` takes a viewer off. The 10 starts each are shown on screen but not counted. Its own see-through Meld layer: `/turn-line.html`; dashboard `/turn-line-control.html`. Overlay is ES5 and polls every two seconds.
- 2026-10-29: Stripeshell Snail tracker card (`/stripeshell-snail.html`): counts up every Stripeshell Snail caught (`itemtype_bug_snailr`); storage withdrawals don't count. Never resets on its own.
- 2026-10-29: King Crab tracker card (`/king-crab.html`): counts up every King Crab caught (`itemtype_bug_az3_crab_king`); storage withdrawals don't count. Never resets on its own.
- 2026-10-29: Vampire Crab tracker card (`/vampire-crab.html`): counts up every Vampire Crab caught (`itemtype_bug_crabr`, confirmed in her game log); storage withdrawals don't count. Never resets on its own.

## Improvements

- 2026-11-01: Simplified login to one centered form and removed its account/sync information panel.
- 2026-11-01: Dashboard navigation now contains only Home links. Home's account button is labeled Account & sign out.
- 2026-11-01: Launchers open sign-in, restored sessions validate online, and successful login returns to the requested page. Added real Windows encryption, restart, access-gate and PostgreSQL expiry coverage.

- 2026-10-31: Restyled Cloud sign-in to match Home, with labeled inputs, readable account/sync status and responsive layouts. Added navigation coverage for every operator page and every built-in directory destination.
- 2026-10-31: Linked AWS.md from AGENTS.md, CLAUDE.md and the README documentation map.
- 2026-10-31: Local code is now a thin Palia/input/artwork/rendering bridge with one shared cloud feed and bounded request queue. Removed inactive local rule modules, business timers, feature JSON writers and repeated overlay-request disk logs. Preserved local URLs, ES5 overlays, tracker skins, desktop widgets and explicit Cloudinary sync.
- 2026-10-31: PostgreSQL now has 58 tables and 84 indexes in icb, with one object definition per file, separate schema/role/permission folders, immutable upgrade 006 and separately retained administrative SQL bundles. Verified fresh-versus-upgraded structure and a full 58-table backup restore with migration ownership/limited grants.
- 2026-10-31: Added field-level ownership documentation, fresh frozen cutovers, export/fence/restore tools, SQL audit exports and metadata-only recovery lists. Change notifications retain revision markers rather than duplicate feature payloads. Assets, backups, data, private credentials and both checked-off logging plans remain ignored.
- 2026-10-31: Verified 240 PostgreSQL/unit tests, 29 headless pages, 17 Terraform checks, actual Gateway/ARM/limited-role SQL behavior, concurrent/stale forms, owner isolation, game replay, secret-version fencing, both AWS worker failure paths and isolated stream load. Backend intervals fell from 15 to 6; transport adds some CPU/memory/bytes. Existing nine missing-artwork E2E failures remain explicit in the validation report.
- 2026-10-31: Completed the cloud-server/local-server/ui split and SQL namespace move while preserving original ledger checksums, rows, Cloudinary IDs and historical quality flags. Terraform/admin environments accept the selected database username; ignored state and private credentials are preserved.

- 2026-10-30: Stopped tracking LOGGING-ADJUST.md; the ignored local copy remains available.
- 2026-10-30: Added LOGGING-ADJUST.md with a proposed minimal activity model, separate summaries, PostgreSQL delivery, and migration checks. Runtime behavior is unchanged.
- 2026-10-29: Turn Line background: none (see-through), a color panel, or a picture (upload on the dashboard or drop one in `assets/turn-line`), with strength, rounded corners and fill/fit/stretch. The background fills the whole Meld layer, so resize the layer to size it.

## Bug Fixes

- 2026-11-01: Login status refresh now updates only authentication controls and feedback, without accessing removed diagnostics elements.
- 2026-11-01: Removed both navigation bars from login and redundant Cloud sign-in links from all dashboard headers/footers.
- 2026-11-01: Sign out and expiry lock open pages and close event streams; obsolete login/restore responses cannot reopen access. Prevented login feedback being erased by session-change reloads and native form submission putting passwords in URLs.

- 2026-10-31: Prevented duplicate sign-in submissions and obsolete status polls from repainting an old account. Unavailable upload counters now display an explicit warning instead of zero.
- 2026-10-31: Documented that Steam rotation must update the pinned SQL secret version through ICB, and that the immediate check toast confirms queued work rather than successful Steam authentication.
- 2026-10-31: Prevented duplicate awards, obsolete snapshot writers, changed-command retries, stale edits, old account responses and replaced-worker results from changing current state. Preserved cumulative bits, anonymous/blocked reporting, weighted draws, undo, reconciliation, stock resets and persistent Amber/Essence.
- 2026-10-31: Prevented Steam key update/delete races and old retries restoring superseded versions. Kept first-success achievement baselines silent, deadlines/reveals stable across cold contexts, and expired sounds from replaying on login.
- 2026-10-31: Deferred physical artwork removal until cloud acknowledgment, retained removed originals, preserved numbered board reveals/page arrows/accented signup names, and made partial cutover retries reuse frozen defaults/collector identity.
- 2026-10-31: Fixed recreation/restore ownership, schema-collision rollback, private Terraform mock isolation and RDS TLS parameter drift without weakening source/test checks.
