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
