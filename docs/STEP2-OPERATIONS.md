# Cloud features: operation, release and recovery

The local bridge remains at `127.0.0.1:8790`. Start it through the existing
launchers or `npm start`, open `/cloud.html`, and sign in. Username matching is
case-insensitive. The existing default account/password is preserved. Sessions
are held only in Node memory; sign in after a normal local restart.

Internet is required. The PC tails local Palia logs, normalizes verified item
facts, relays minimal chat commands/counts, serves local artwork and renders
overlays. PostgreSQL owns feature settings/progress; Express Lambda owns their
rules. Meld pages keep their existing URLs and two-second local ES5 XHR polling.
The one shared account feed makes cloud requests independent of overlay count.
A bounded per-installation request queue keeps background uploads/feed reads from
throttling their own commands against the small Lambda concurrency limit.

## State and privacy

- Settings are stored separately from progress. Typed tables store signup/turn
  positions, attendance, tickets, draws, votes, teams, hunt scores, resource/weekly
  progress, timers and Steam achievements. Revision notifications retain markers only; they do not archive each intermediate
  feature payload. Only paginated feed responses need a two-minute materialized
  snapshot. The full field inventory is in
  [STEP2-FEATURE-MAP.md](STEP2-FEATURE-MAP.md).
- Chat wording and raw game lines never enter feature requests or SQL. Chat
  counts are batched separately from prompt recognized intents and timestamped
  giveaway-window presence. Neon/avatar/walker text effects use bounded local RAM.
- A command has a UUID, canonical digest and expected feature revision. A lost
  response can retry the same command; changed content under that UUID is rejected.
  Dirty browser forms retain the revision they displayed and reject stale saves.
- Owner locks serialize commits. Collector inputs additionally require an active
  lease, ordered sequence and upstream source receipt. Game facts retain a stable
  file-generation/byte-position identity even when rebatched.
- On cloud failure, overlays retain the last confirmed snapshot. Operator pages
  show reconnecting/login status. Unconfirmed mutations are not reported as saved.
  No local rule engine or writable SQL mirror takes over.
- `local-server/.env` holds `ICB_CLOUD_API_URL` only. Terraform supplies the Lambda
  DB endpoint; its password remains in the service secret. Steam keys use separate
  owner-scoped Secrets Manager secrets, with exact version fencing and seven-day
  recovery on deletion. Credential edits use the displayed Steam revision and
  advance it atomically, so stale forms cannot replace a newer key. Keys are never
  returned to browser settings.
- Artwork remains ordinary local files with explicit Cloudinary sync. SQL stores
  relative references and metadata. Local upload bytes never go through Lambda.
  Removal waits for cloud acknowledgment and retains the original under `_removed`.

## Normal operation and diagnostics

Keep one production server. Do not restart a live stream for source verification.
Tests use isolated state and port 8791. Cloud account status shows collector,
pending/quarantined transport and last acknowledgment; `/api/diagnostics` reports
cloud authority/feed status without credentials. Old local JSON is recovery
evidence, not current progress. A new account receives initial cloud defaults;
an existing account with Step 1 history requires an explicit source cutover.

Countdowns/hunts/polls use persisted deadlines and database time. A feed/read or
command finalizes elapsed state. The browser estimates the cloud clock offset for
smooth seconds. Lambda cold starts never reset a session. Expiring numbered events
prevent historical sounds/popups on login. Palia weekly reset stays Monday 04:00
UTC, separate from the stream reporting day at six AM in the account timezone.

Steam is polled for recently active enabled owners, normally every 60 seconds.
Manual refresh is bounded. First success establishes a silent baseline; already
known achievements never flood the overlay. Disabled/inactive owners do not keep
making provider requests. Sprite file import is now an explicit dashboard action;
the local process reads the fixed import file, sends semantic state and archives
the file after acknowledgment.

Reports use SQL summaries/audits, not logs. Existing daily URLs remain.
`/api/feature-reports/{commands,awards,draws,signups,turns,resources,archives}` supports
bounded owner-authorized JSON or `?format=csv`. Archive rows expose an authorized
download ID, not another owner's data. CSV neutralizes formula-leading text.

## SQL source and release

All application objects are in `icb`. There are 58 current table sources, one per
file under `database/tables/`, and 19 standalone index sources. Constraint indexes
are created with their tables. Schemas, roles, permissions and future views/functions
have their own folders. No DDL runs at HTTP startup or on worker invocation.

Use PowerShell from the repository root, after `aws login --profile Vox` when needed:

```powershell
. ./database/admin-env.ps1 -Role master
./database/backup.ps1
Remove-Item Env:PGPASSWORD
. ./database/admin-env.ps1 -Role migration
npm.cmd run migrate --prefix cloud-server
Remove-Item Env:PGPASSWORD
. ./database/admin-env.ps1 -Role master
npm.cmd run schema:grants --prefix cloud-server
npm.cmd run schema:check --prefix cloud-server
Remove-Item Env:PGPASSWORD
./cloud-server/tools/release.ps1 -EnableWorker -Apply
```

Run mandatory unit/E2E/browser/structure/format and actual PostgreSQL checks first.
The release preflight verifies the schema ledger/object inventory. The release
script builds retained SQL upgrade bundles separately from the runtime ZIP,
uploads versioned immutable artifacts, and refuses resource deletion or any RDS
change in its release plan. It writes only the public API URL locally and does
not restart the local bridge. Terraform names/tags use `baby-icb-`.

Upgrade 006 adds Step 2 objects without rewriting versions 001–005. Its manifest
pins each original object file. Administrative ZIPs under the private release
bucket's `database-upgrades/` prefix retain the exact SQL if a later canonical
definition changes. After deployment, use a new migration for schema changes;
never regenerate already-applied 006 checksums. Fresh builds and upgraded catalogs
must match, with `icb_migrator` owning objects and limited `icb_service` grants.

## Explicit owner cutover

This is an administrative operation, not a startup migration. Use the owner's
normal shutdown if their local server is running; the tool refuses port 8790.

```powershell
. ./database/admin-env.ps1 -Role master
node cloud-server/tools/cutover-features.js
node cloud-server/tools/cutover-features.js --apply
Remove-Item Env:PGPASSWORD
```

Preview maps fresh source files to the catalog. Apply refuses unresolved activity
or feature envelopes, creates a startup fence in `data/.feature-cutover.json`,
backs up sources/transport, renews the same collector lease, imports features
individually with source SHA/migration UUID/input watermark, and compares every
supported frozen field after SQL hydration. Additive defaults are permitted;
changed balances, order, deadlines or reset metadata are not. Missing files use
initial defaults. Existing historical import receipts/daily quality flags remain.

After all comparisons, it retires only obsolete recovery-copy envelopes, saves
the same owner/collector identity for protocol 2 and removes the fence. A failure
leaves the fence and recovery evidence in place; resolve the cause and rerun.
The tool never discards supporter awards. Pending legacy activity must first be
drained with the compatible collector or explicitly reconciled against receipts.
Existing `feature_state` rows remain pre-cutover recovery copies; migrated keys
reject further local recovery PUTs and client-decided award deltas.

## Backup, undo and feature rollback

`backup-icb-clean-state.bat` copies all existing catalogued source and machine
transport/preferences plus public definitions with a hash manifest. This does not
replace a current SQL backup. RDS retains seven days of automated backups.
`database/backup.ps1` creates a private logical dump. `verify-backup.js <dump>`
restores into a generated disposable database, compares every table fingerprint,
checks migration ownership/service grants and removes only its generated database.
`restore.ps1` restores transactionally into a new empty target and repairs owners
and grants; it never uses `--clean` on the active database.

Giveaway recovery snapshots live in `feature_undo`, with metadata-only lists.
Retention is 144 automatic, 60 daily, 40 before-action and 20 corrupt-recovery
snapshots. Restoration preserves the current chat-window anchor/presence and
source receipts. Draw eligibility/rules/results and supporter audits remain
immutable. Sprite season archives are also SQL recovery records.

For a per-feature rollback, export **fresh cloud state**, fence writers and retain
the export digest/revision. With private admin credentials loaded:

```powershell
node cloud-server/tools/feature-recovery.js todos --fence
node cloud-server/tools/feature-recovery.js --resume backups/cloud-exports/todos-<stamp>.json
# Or restore a deliberate prior CLOUD export, comparing a fresh fenced current export:
node cloud-server/tools/feature-recovery.js --restore backups/cloud-exports/todos-<prior>.json backups/cloud-exports/todos-<current>.json <command-uuid>
```

The restore command requires a fenced feature, a current export no older than
15 minutes, unchanged current revision/content, and a replacement exported after
the feature's cloud cutover. It keeps displaced state in `feature_undo`, retains
source receipts and records a new command UUID/revision boundary. Repeating that
UUID returns its original result. Giveaway uses its dedicated backup restore API
because it must preserve current participation/window state.
The `--fence` mode blocks new collector claims and expires the current lease;
`--resume` only resumes when the current SQL projection still matches that export.
Do not restore an older local JSON file or run a second award engine. A deliberate
replacement implementation must import the fresh export at a new boundary and
receive its own authority/protocol transition. The tool never silently switches the app back to obsolete local source.

For code rollback, retain the prior S3 key/version/hash in ignored release metadata.
Choose a version compatible with the current authority protocol; an old Step 1
writer is fenced and is not a functioning Step 2 rollback. Schema rollback is
restore-to-new-database plus verified data/permission comparison and an explicit
endpoint/release change. Preserve the current database until verification passes.

## Worker failure handling and limits

The worker is ARM64 Node 22, 256 MB, 15 seconds, reserved concurrency 1, max pool 1.
API settings remain 512 MB, reserved concurrency 2, max pool 1. Each worker tick
claims at most two jobs with expiring leases and remaining-time checks. Provider
HTTP happens outside SQL transactions. Job updates require the same active lease,
feature revision and credential version. Duplicate ticks do not repeat awards.

Scheduler runs once a minute, no flexible window, one delivery retry and a private
SQS DLQ. Lambda asynchronous execution separately retries once and delivers terminal
failures to the same queue. Queue retention is 14 days; logs retain seven days.
Alarms cover worker errors/throttles, failed destinations/dropped async events,
Scheduler errors/drops and queued messages, plus existing DB/API alarms. Alarm
actions are console-only unless explicitly configured; no email recipients are set.

```powershell
./cloud-server/tools/verify-aws-failures.ps1
./terraform/test.ps1
```

The live failure check deploys uniquely prefixed temporary fixtures: the production
worker package with a refused loopback DB connection, and a Scheduler target that
does not exist. It observes both failure types, deletes only its own queue messages
and destroys only its fixture resources, even on failure. It does not modify the
production worker or inject a production failure backdoor. Private metadata is
retained under ignored `backups/baby-icb-step2-check-*`.

The $30 AWS Budget is account-wide and console-visible, including unrelated AWS
spend. It is an alert threshold, not a spending cap. See the release validation
and cost measurements alongside this document before raising concurrency or
Gateway throttles. Account quota and RDS connection ceilings must be checked
against API + worker + rollout/admin connections together.

See [STEP2-VALIDATION.md](STEP2-VALIDATION.md) for measured results, limits and cost calculations.
