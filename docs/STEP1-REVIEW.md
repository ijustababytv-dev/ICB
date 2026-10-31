# Step 1 review

Implementation and cloud deployment completed on 2026-10-31; final local cutover
and representative-stream acceptance remain open. Step 2 is not implemented. The local
production server was not restarted; new local behavior takes effect at its next
normal restart. Then open **Cloud account** on ICB Home (`/cloud.html`) and sign
in as `ijustababytv` using the password supplied in the conversation. Mixed-case
usernames work. The password is not in source, logs, or browser token storage.

Before closing Step 1, confirm the final archive freeze/cutover boundary, activate
the updated local app/listener at its normal authorized startup, verify a real
local-to-cloud stream, and record traffic/connection/write/queue/cost measurements.
The local status endpoint was unreachable during the 2026-10-31 checklist review;
that review did not verify activation. The nine existing missing artwork files
remain a separate E2E limitation. Keep Step 2's prerequisite unchecked until the
remaining acceptance work has evidence.

## Changes to review

- `cloud-server/`: Express 5 on ARM64 Lambda, HTTP API Gateway, parameterized `pg`
  SQL, no ORM, scrypt accounts, hashed opaque sessions, throttles, and owner isolation.
- `local-server/`: local Palia reader and live feature rules, one transient chat
  relay, minimal count aggregation, bounded durable outbox, and account-bound sync.
- `ui/`: existing dashboards/overlays with preserved URLs, cloud sign-in/status,
  and daily summary reports/CSV. No transcript or raw-event export remains.
- `database/`: one SQL file per table/index/role, separate permissions and upgrade
  migrations, the saved-state allowlist,
  administrative environment helper, and actual backup/restore commands.
- All 19 application tables, their indexes, and the migration ledger use the `icb`
  schema, created by `database/schemas/icb.sql`. Version 005 preserves existing rows
  and object identities while moving them out of `public`.
- `data/`: remains local for live feature state, recovery, and the minimal outbox;
  it is now ignored/untracked. Existing files and historical private backups were
  preserved. Old raw chat remains in earlier Git history; history was not rewritten.

Cloud reports use daily PostgreSQL summary tables. Chat records contain viewer
identity and message deltas only. Support records retain purchased sub months,
gift quantities, bits, currency-specific amounts, and actual award deltas. Text is
available only for immediate commands and bounded in-memory live displays.
Giveaway recovery backups still exist; a jar display reset never alters balances.

## Data already saved

- One default account, verified using the supplied password over the deployed API.
- 30 current settings/progress files copied into owner-scoped `feature_state`.
- 34 historical activity files reduced to 8,003 minimal records and daily summaries;
  30,901 recoverable chat messages were counted. Repeated import did not increase totals.
- The historical cutoff is **2026-10-31 17:15:29.532 UTC** (12:15:29.532 CDT).
  Sources were hashed and the boundary recorded in PostgreSQL and the private
  `backups/step1-migration-review.json`.

Historical reports are marked partial because raw and structured chat records
differ, and three malformed lines exist. Legacy files lack an explicit timezone; their
old offset/DST grouping limitation remains documented. Imported activity never runs ticket
award functions or replaces current Palia/giveaway balances. Raw archives, reader
diagnostics, legacy totals, import seed copies, credentials, and duplicate backups
were excluded from cloud storage. The snapshot allowlist includes current
settings, resource/weekly progress, giveaway state, signups, collections, polls,
timers, decorations, and other maintained feature state.

## Verification

- Actual PostgreSQL tests in disposable schemas, also using the limited service
  role: migrations, transactions, owner isolation, duplicate/reordered deliveries,
  source receipts, rollback, summaries after retention, snapshots, and throttles.
- Actual API Gateway -> Web Adapter -> Express -> RDS test with disposable accounts:
  mixed-case login, session forwarding, owner isolation, retry-safe ingestion,
  rejection of text fields, and a 500-record batch (759 ms in the smoke run).
- Default-account login and access to all 34 report days / 30 state files verified.
- A real database dump restored into a disposable database; account count, state
  files, and message totals matched. Dumps stay under ignored `backups/database/`.
- Deployed CloudWatch entries checked for sample chat text and operational secrets.
- The latest full validation passed 216 unit/PostgreSQL checks, with real SQL tests using the limited role.
  E2E, headless browser, source-policy, formatter, and Terraform checks are rerun at handoff. E2E retains the existing nine missing-artwork failures; these
  assertions are preserved. See UPDATES.md for the final counts.

The missing originals under `assets/resources/` are `poke_bowl.png`, `Apple_Pie.png`,
`Pumpkin_Pie.png`, `Meaty_Stir_Fry.png`, `Akwinduu_Chapaa.png`, `Vampire_Crab.png`,
`King_Crab.png`, `Stripeshell_Snail.png`, and `Crab_Dishes.png`.

## Operating boundaries

Sign-in is required after a local restart. Pending batches retain their original
owner through logout or account changes. An installation's existing local data
binds to its first collecting account; a different account can read its cloud
reports without importing the previous owner's local state. One collector per
account and one updated Meld listener per local server are permitted.

Counts seal every ten seconds. A crash can lose the unsealed interval; sealed
batches and saved award markers recover without recalculating ticket awards.
Upstream events without real source IDs cannot be perfectly deduplicated across
separate deliveries/restarts. An unreadable/full outbox or rejected batch must
remain visible for operator resolution. No supporter records are silently deleted.
Keep historical archives private until deliberate cleanup is authorized.

Database/API configuration remains in ignored `terraform/.env`, the immutable
release metadata in ignored `terraform/activity-release.auto.tfvars.json`, and
the public API URL in ignored `local-server/.env`. Lambda retrieves its limited
password from Secrets Manager; it never gets the RDS master login. SQL role
credentials are recoverable locally in ignored `database/.env.admin`.

For database recreation and restore, follow [database/README.md](../database/README.md).
For normal local startup use the existing launchers or `npm start`; preserve port
8790 and the current feature-state files. Refresh the Meld listener at the normal
cutover so it uses the single chat route and minimal support relay.
