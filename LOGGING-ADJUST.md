# Minimal activity storage plan

Date: 2026-10-30. Status: proposed implementation; this document changes no runtime behavior.


## Recommendation

Keep ICB, Palia log reading, chat commands, and Meld overlays running locally.
Store compact activity records and separately maintained summaries in PostgreSQL.
Never archive chat text or entire Meld payloads, locally or in PostgreSQL.

Use one small authenticated HTTPS service between installations and PostgreSQL.
Local installations send minimal records to that service; database credentials stay
on the service. This hosts storage access, not the local streaming application.

PostgreSQL becomes the permanent activity store. A temporary local delivery queue
is recommended for internet outages; it contains only minimal unsent records and
is cleared after confirmation. If absolutely no local persistence is allowed,
activity received during an outage or process crash can be lost. Do not promise
both reliable offline collection and zero local storage.

This plan covers stream activity and reporting. Migrating tracker totals,
settings, authentication, or all other feature persistence is separate work.


## Current behavior and scope

The reviewed checkout contains approximately 63.9 MB of activity files, including
42.1 MB of raw chat and 9.8 MB of connection records. These are a snapshot of
this checkout, not an estimate of every installation.

- `js/client/giveaway-listener.js` sends structured giveaway events and a second,
  catch-all stream of compacted raw Meld events.
- `js/server/routes/activity.js` archives that catch-all stream before relaying
  chat to commands, signups, polls, Neon Chat, and other live features.
- `js/server/routes/giveaway-events.js` also records each chatter's name and saves
  the whole giveaway state for every accepted chat message.
- `js/server/giveaway/activity.js` appends activity files without a retention rule.
- The stream report and CSV currently read those files, including chat text.

Removing the archive must preserve live event handling. The application still
needs message text briefly to process commands and display Neon Chat. Keep it
only in the bounded live display buffer; exclude it from storage, retries,
diagnostic request dumps, cloud requests, and exports.


## What to retain

| Activity | Minimum stored information |
| --- | --- |
| Chat | Viewer identity, reporting day, message count, earned chat-window count; no individual message archive |
| Sub or resub | Viewer, event ID, time, subtype, tier, months purchased in this event |
| Gifted subs | Gifter when known, event ID, time, tier, quantity, anonymous flag |
| Bits | Viewer when known, event ID, time, integer bit quantity |
| Tips or purchases | Event ID, time, source/type, viewer when supplied, amount in integer minor units and currency when supplied |
| Follow or raid | Event ID, time, viewer when supplied; raid viewer count |
| Giveaway award/correction | Event ID, time, viewer, actual ticket delta and reason code |
| Draw, reset, restore | Event ID, time, action and minimal result needed for recovery/audit |

Use the existing six-AM-to-six-AM reporting day initially. Store the owner's
reporting timezone and derived day on each batch/event, so a cloud server's
timezone or a later settings change cannot regroup historical activity.
This day is a report grouping, not a claim about actual stream start/end times.

Identify the software owner by permanent account/workspace ID, never by a mutable
login name. Identify viewers within that owner by platform and stable platform
user ID where supplied, with a case-normalized username fallback and display name.
Never merge matching names from different platforms automatically.

Count each accepted live chat message once, including commands. Keep existing
blocked-user giveaway eligibility separate from reporting: supporter activity
remains reportable even when someone cannot enter a giveaway. Message quantity
must not change the existing one-award-per-active-chat-window rule.

Record purchased months, not a subscriber's cumulative tenure. Keep gifted subs
given separate from personal subscriptions. Omit gift recipient lists by default;
this plan tracks the gifter's contribution, not recipient histories. Keep anonymous
support in stream totals without inventing a viewer or changing giveaway eligibility.
Preserve unknown values as unknown. Do not convert bits to cash or combine amounts
in different currencies. Capture tips only when an actual source event supplies them.


## What to stop retaining

- Chat bodies, fragments, emote URLs, badges, colors, avatars, and transcripts.
- Generic raw event JSON, unknown-event payloads, user updates, viewer joins/leaves,
  repeated viewer lists, scene changes, and repeated connection/status notifications.
- Duplicate raw versions of subs, gifts, bits, follows, and raids already normalized.
- Per-message timestamps and records when a count per reporting day is sufficient.

Keep current connection health in memory and retain short error codes or actual
state changes only when useful for diagnostics. Audience charts and viewer-list
history are outside this minimal report; remove those report sections rather than
leaving misleading zero values. Do not upload Palia source logs or bridge event
files: those remain local inputs to the trackers, outside this activity archive.


## Store summaries separately from event history

Use ordinary PostgreSQL tables with explicit columns, not another JSON log blob:

| Table | Purpose |
| --- | --- |
| `activity_events` | Compact supporter and giveaway records; no chat messages or generic payload column |
| `activity_receipts` | Accepted batch/event IDs for retry deduplication |
| `viewer_daily_stats` | One row per owner, reporting day, platform, and viewer |
| `stream_daily_stats` | One row per owner and reporting day, including anonymous support totals |

Viewer summaries contain message count, chat windows earned, subscription event
count, purchased months, gifted subs given, bits given, and actual giveaway ticket
deltas. Keep tip/purchase amounts separated by currency in a small related totals
table when those events exist. Stream summaries contain overall counts and support
totals. Lifetime totals can initially be queried from daily summaries; avoid another
stored lifetime counter that can drift.

Update receipt, compact event where applicable, and summary increments in one
database transaction. Reports read summary tables directly, without scanning or
replaying logs. Use the compact event table only for supporter/correction details.
Report actual ticket deltas at the time of award, rather than recalculating history
using today's giveaway rates. Summary rows survive event-history cleanup.


## Collection, delivery, and duplicate protection

1. Give local event processing one normalization/counting path so structured and
   catch-all deliveries cannot both count the same message or contribution.
2. Process live commands/display locally, then discard text from the persistence path.
3. Aggregate chat counts per viewer/day into small batches, initially every 10 seconds.
   Put sealed batches in a durable temporary outbox before considering them queued.
   A crash can still lose the current unsealed interval; report this limit explicitly.
4. Queue supporter events promptly with their minimal fields. Preserve existing
   immediate local giveaway saves for valuable awards, draws, and corrections;
   reduce ordinary chat-driven whole-state rewrites with bounded checkpoints.
5. Assign each batch a persistent unique ID. Every retry sends the same ID and contents.
   Use unique database constraints and atomic increments to prevent duplicate application.
6. Prefer source event IDs to catch repeated provider deliveries. Inspect real Meld
   events for available IDs before implementation. A newly generated ID alone cannot
   detect the same source event received twice. When source IDs are unavailable,
   enforce one listener per stream and retain existing history/replay exclusions;
   document the remaining duplicate risk without comparing or storing message text.
7. Use one collecting installation per workspace initially. Multiple signed-in users
   may view reports, but must not run competing collectors for the same stream.
8. Show last successful sync, pending count, and failures locally. Retry with backoff;
   remove queued records only after a confirmed commit. Enforce owner access on the
   service using authenticated identity, not a trusted owner ID in the request body.

The cloud path must never delay Palia tracking or Meld rendering. Show cloud
reports as delayed while uploads are pending; do not silently display stale totals
as current. Bound the outbox by count/bytes and show a clear collection fault if
full; never silently discard supporter records. Errors must omit request bodies,
chat text, passwords, and connection secrets.


## Retention and migration

Retain daily summaries until deliberately deleted by the owner. Initially retain
compact supporter/audit events for one year. Retain deduplication receipts while
their events/batches remain eligible for retry or replay; do not delete receipts
on an unrelated timer. Keep short diagnostic errors for seven days. The local
outbox is temporary delivery state, not a second historical activity archive.

Before changing runtime code, run baseline tests and the state backup launcher.
Import existing activity files with a repeatable, dry-run-first tool. Build counts
from one chosen chat representation per day; do not add raw and structured chat
counts together. The earlier scan found different counts for these representations
and three malformed lines, so report discrepancies and incomplete days explicitly.
Use structured supporter records where present; reconcile raw-only support separately
without duplicating events. Never upload message text during import.

Mark imported days and seed the new counting boundary so import and live collection
cannot overlap. Compare summary results with the existing report and current saved
giveaway data; do not add historical awards to current balances. Read historical
giveaway rates only where known. Never invent a missing ticket delta.

Switch report/CSV reads to summaries after verification, then stop local activity
JSONL writes. Remove full chat, transcripts, generic event timelines, and raw export
paths. Keep old files in the existing private backup until an explicit cleanup;
this planning task does not delete or migrate anything. Explain that older backups
may still contain historical chat text.


## Implementation order and acceptance checks

1. Add pure normalization, identity, summary, and day-boundary rules with unit tests.
2. Split live relay handling from persistence; remove catch-all archiving and duplicate
   chat collection. Preserve ES5 compatibility in the Meld listener.
3. Add authenticated batch ingestion, PostgreSQL tables/transactions, temporary outbox,
   and sync status in focused modules. No root server file or feature monolith.
4. Add summary report/CSV reads, dry-run migration, reconciliation, and controlled cutover.
5. Verify retries, duplicate source events, restarts, anonymous/blocked support,
   gifts versus subs, tips by currency, rollover at six AM and daylight saving,
   account isolation, outbox overflow, and interrupted database transactions.
6. Assert a distinctive sample chat phrase never appears in persisted files,
   database rows, cloud batches, application diagnostics, or CSV output. Confirm
   commands, Neon Chat, ticket awards, tracker totals, and recovery still work.
7. Run unit, E2E, browser, source-policy, and formatting checks; back up live state
   before cutover and use the next authorized restart. Measure before/after storage
   and write counts using representative traffic rather than promising a fixed saving.

Completion means message counts and supporter totals remain available from summary
tables even after eligible event records are removed, ordinary chat text is never
archived, and a repeated upload cannot change totals twice.
