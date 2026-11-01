# What PostgreSQL stores

Application data lives in the `icb` schema and is separated by streamer account.

- **Accounts and access:** usernames, password hashes/salts, timezone, session-token hashes/expiry and login-attempt limits.
- **Viewer activity:** viewer identities, message counts, active-chat windows and daily viewer/stream summaries.
- **Support:** subscriptions, gifted subs, months/tiers, bits, follows, raids, monetary amounts/currencies and ticket awards.
- **Giveaways:** entrants, tickets, awards, draws, winners, eligibility snapshots, daily chat check-in policy/attendance, audit history and undo data.
- **Sign-ups and parties:** events, participants, roles and attendance/check-ins.
- **Turn Line:** waiting order, rounds and completed turns.
- **Games:** poll choices/votes, team membership and hunt participants/scores.
- **Trackers:** cooking countdowns, resource totals, multi-counter card progress, weekly goals, resets and reconciliation state.
- **Collections:** Aniimo checklists, avatars, sprites, walkers and plushie/trade-up collections and assignments.
- **Settings:** overlay appearance/visibility, decor/presets, clocks, ticker text, title/go-live lists, saved custom links and startup preferences.
- **Timers and tasks:** countdowns, scheduled feature actions and to-do items.
- **Steam:** account/game identifiers, achievements, polling jobs and references to credential versions in AWS Secrets Manager.
- **Asset metadata:** file paths, sizes and modification times; artwork itself stays in local files/Cloudinary.
- **Synchronization and recovery:** collector leases/sequences, duplicate-event protection, revisions, command receipts, cached feature snapshots, display events, imports and migration records.

Raw chat wording and original Palia log files are not archived here. Passwords and Steam API keys are not stored as plaintext. Recent-page browsing history stays in the browser.

Definitions: [database/](database/). Detailed feature mapping: [STEP2-FEATURE-MAP.md](docs/STEP2-FEATURE-MAP.md).

## Tables

All tables below are in the `icb` schema, listed alphabetically.

| Table | Stored data |
| --- | --- |
| `accounts` | Usernames, password hashes/salts, account status and reporting timezone. |
| `activity_event_receipts` | Processed activity event IDs to prevent duplicates. |
| `activity_receipts` | Accepted activity batches, checksums, collectors and receipt times. |
| `asset_references` | Artwork paths, file sizes and modification times. |
| `chat_window_presence` | Viewers present in ticket windows and whether already awarded. |
| `collection_entries` | Ordered feature collections, assignments and checklist entries. |
| `collector_history` | Past collector ownership periods for validating delayed input. |
| `collector_input_receipts` | Processed collector inputs, sequences and checksums. |
| `collector_leases` | Active collector ownership and lease expiry. |
| `collector_sequences` | Last accepted input sequence per collector. |
| `daily_summary_quality` | Partial-day flags and reporting completeness details. |
| `feature_authority` | Each feature's local/migrating/cloud ownership, protocol and revision. |
| `feature_changes` | Feature revision notifications; current writes contain no state payload. |
| `feature_commands` | Command IDs, checksums and results for safe retries. |
| `feature_display_events` | Expiring overlay animations, alerts and other display events. |
| `feature_feed_snapshots` | Temporary paginated state-feed payloads and revision watermarks. |
| `feature_metadata` | Operational state, including giveaway check-ins and reset metadata. |
| `feature_migrations` | Feature cutover checksums, timestamps, versions and input boundaries. |
| `feature_state` | Legacy Step 1 feature snapshots and their revisions/checksums. |
| `feature_timers` | Countdown deadlines, pauses, status and completion identifiers. |
| `feature_undo` | Recovery snapshots, backup descriptions and revision history. |
| `game_event_receipts` | Game-event identities/checksums for duplicate protection; no log lines. |
| `game_sessions` | Collector session IDs and start/end times. |
| `giveaway_audit_events` | Giveaway actions, timestamps, viewers and ticket changes. |
| `giveaway_awards` | Individual ticket awards/deductions and their source identities. |
| `giveaway_draws` | Immutable drawing rules, eligible ticket weights and results. |
| `giveaway_entrants` | Viewer ticket balances, support counts, notes and eligibility details. |
| `giveaway_winners` | Ordered, editable winner-display history. |
| `hunt_players` | Hunt participants, teams and game progress. |
| `integration_jobs` | Scheduled cloud work, execution leases, retries and errors. |
| `integration_secrets` | Secrets Manager references and credential versions; no secret values. |
| `login_attempts` | Failed-login counters and rate-limit expiry. |
| `migration_runs` | Historical activity imports, source checksums and verification results. |
| `owner_revisions` | Account-wide synchronization revision and recent activity time. |
| `owner_settings` | Per-feature configuration, appearance and check-in policy. |
| `poll_options` | Poll choices, images and display order. |
| `poll_votes` | Viewer selections, subscriber status and voting times. |
| `resource_progress` | Primary and secondary tracker totals/countdowns. |
| `resource_slot_progress` | Individual counter values on multi-counter tracker cards. |
| `schema_migrations` | Applied SQL migration versions, checksums and timestamps. |
| `sessions` | Hashed sign-in tokens, account links, expiry and revocation. |
| `signup_checkins` | Event participant attendance and check-in times. |
| `signup_entries` | Event participants, ordering, roles and entry details. |
| `signup_events` | Sign-up/party event definitions, ordering and event details. |
| `source_event_receipts` | Processed platform event IDs to prevent duplicate support records. |
| `state_import_runs` | Imported legacy state identifiers and source checksums. |
| `steam_accounts` | Steam profile/game identifiers, polling status and baseline flags. |
| `steam_achievements` | Achievement identifiers, details and unlock times. |
| `stream_daily_stats` | Daily stream-wide chat, support, raid and ticket totals. |
| `support_currency_daily` | Daily monetary totals separated by currency, viewer/stream and contribution type. |
| `support_events` | Individual subscriptions, gifts, bits, follows, raids and monetary contributions. |
| `team_members` | Team assignments, viewer scores and member details. |
| `todos` | Daily/weekly tasks, completion flags and goal progress. |
| `turn_entries` | Turn Line participants, order, round and current state. |
| `turn_rounds` | Turn Line rounds and start/end times. |
| `viewer_daily_stats` | Daily chat, support, raid and ticket totals per viewer. |
| `viewers` | Platform IDs, normalized usernames and display names. |
| `weekly_progress` | Weekly goal quantities, completion flags and week identifiers. |
