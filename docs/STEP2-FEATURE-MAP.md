# Step 2 feature and field ownership

Every owner-scoped field below crosses the authenticated command service. `owner_settings` stores bounded presentation/configuration JSON; `feature_metadata` stores operational and undo metadata. Typed child tables hold progress, identities, ordering, attendance, votes, scores and integration state. All objects live in `icb`.

Public URLs remain local. Express validates their allowlisted equivalents through `cloud-server/src/features/executor.js`; isolated factories in `cloud-server/src/features/models/` consume injected transaction state and pure rules in `cloud-server/src/domain/`. There is no filesystem access or timer loop in those factories.

## Owner feature inventory

| Feature / source | Local API family | Additional SQL projections | Cloud model |
| --- | --- | --- | --- |
| `aniimo-dex` / `data/aniimo-dex.json` | `/api/aniimo` | collection_entries | `aniimo` |
| `avatars` / `data/avatars.json` | `/api/avatars` | collection_entries | `avatars` |
| `beanburger-signup` / `data/beanburger-signup.json` | `/api/beanburger-signup` | signup_events, signup_entries, signup_checkins | `signups/burger` |
| `countdowns` / `data/countdowns.json` | `/api/countdowns` | feature_timers | `countdowns` |
| `decor` / `data/decor.json` | `/api/decor` | collection_entries | `decor` |
| `eventtime` / `data/eventtime.json` | `/api/eventtime` | owner_settings / feature_metadata | `event-time` |
| `flowtree-signup` / `data/flowtree-signup.json` | `/api/flowtree-signup` | signup_events, signup_entries, signup_checkins | `signups/flow` |
| `giveaway` / `data/giveaway.json` | `/api/giveaway` | giveaway_entrants, giveaway_awards, giveaway_draws, giveaway_winners, chat_window_presence, feature_undo | `giveaway/state` |
| `hub` / `data/hub.json` | `/api/hub` | owner_settings / feature_metadata | `hub` |
| `hunt` / `data/hunt.json` | `/api/hunt` | hunt_players | `hunt` |
| `live` / `data/live.json` | `/api/live` | resource_progress | `state` |
| `neonchat` / `data/neonchat.json` | `/api/neonchat` | owner_settings / feature_metadata | `neon-chat` |
| `newsticker` / `data/newsticker.json` | `/api/newsticker` | owner_settings / feature_metadata | `news` |
| `oceanfish` / `data/oceanfish.json` | `/api/oceanfish` | owner_settings / feature_metadata | `ocean-fish` |
| `paliaclock` / `data/paliaclock.json` | `/api/paliaclock` | owner_settings / feature_metadata | `palia-clock` |
| `parties` / `data/parties.json` | `/api/party` | signup_events, signup_entries, signup_checkins, collection_entries | `party` |
| `poll` / `data/poll.json` | `/api/poll` | poll_options, poll_votes | `poll` |
| `randomizer` / `data/randomizer.json` | `/api/randomizer` | owner_settings / feature_metadata | `randomizer` |
| `resource-trackers` / `data/resource-trackers.json` | `/api/resource-trackers` | resource_progress, resource_slot_progress | `resources` |
| `sashimi-signin` / `data/sashimi-signin.json` | `/api/sashimi` | signup_events, signup_entries, signup_checkins | `signups/poke` |
| `settings` / `data/settings.json` | `/api/settings` | owner_settings / feature_metadata | `state` |
| `sprite-tv` / `data/sprite-tv.json` | `/api/sprite-tv` | owner_settings / feature_metadata | `sprite-tv` |
| `sprites` / `data/sprites.json` | `/api/sprites` | collection_entries, feature_undo | `sprites` |
| `steam` / `data/steam.json` | `/api/steam` | steam_accounts, steam_achievements, collection_entries, integration_jobs, integration_secrets | `steam` |
| `streamframe` / `data/streamframe.json` | `/api/streamframe` | owner_settings / feature_metadata | `stream-frame` |
| `teams` / `data/teams.json` | `/api/teams` | team_members | `teams` |
| `todos` / `data/todos.json` | `/api/todos` | todos | `todos` |
| `turnline` / `data/turnline.json` | `/api/turnline` | turn_rounds, turn_entries | `turn-line` |
| `walkers` / `data/walkers.json` | `/api/walkers` | collection_entries | `walkers` |
| `weekly-accomplishments` / `data/weekly-accomplishments.json` | `/api/weekly` | weekly_progress | `weekly` |
| `tradeup-config` / `data/tradeup-config.json` | `/api/tradeup/config` | collection_entries | `tradeup` |
| `tradeup-state` / `data/tradeup-state.json` | `/api/tradeup/state` | collection_entries | `tradeup` |

## Field map

Progress fields take precedence when an old mixed file also listed them as settings. Collections listed above use typed rows; other operational objects stay in `feature_metadata`. Raw `reader`, message/fragments/bubble diagnostics, credential values, and legacy pending-award markers are excluded. The cutover refuses unresolved pending-award markers rather than discarding them.

### aniimo-dex

Settings: `visible`, `title`, `chat`, `popupSec`, `lookupSec`, `showElements`, `accent`, `panelColor`, `panelOpacity`, `seq`.

Progress / operational state: `roster`, `checked`, `recent`.

### avatars

Settings: `visible`, `maxAvatars`, `size`, `speed`, `bubbles`, `bubbleSec`, `showNames`, `textSize`, `bottom`, `leftEdge`, `rightEdge`, `idleMin`, `ignore`, `sayCmds`, `pickCmd`, `colors`, `onlyCmdShow`, `subOn`, `subMsg`, `followOn`, `followMsg`, `raidOn`, `raidMsg`, `bitsOn`, `bitsMsg`, `bounceAllOnSub`, `disabled`, `epoch`.

Progress / operational state: `assign`.

### beanburger-signup

Settings: `visible`, `open`, `live`, `seq`, `font`, `cols`, `title`, `max`, `ignore`, `accent`, `panelColor`, `panelOpacity`, `showZones`, `showCountdown`, `rseq`, `onDemand`, `showSec`, `showOnSignup`, `zones`.

Progress / operational state: `events`.

### countdowns

Settings: .

Progress / operational state: `list`.

### decor

Settings: `rev`.

Progress / operational state: `effects`, `presets`.

### eventtime

Settings: `title`, `subtitle`, `date`, `time`, `sourceTz`, `at`, `visible`, `showCountdown`, `layout`, `zones`.

Progress / operational state: None.

### flowtree-signup

Settings: `visible`, `open`, `live`, `seq`, `font`, `cols`, `title`, `max`, `ignore`, `accent`, `panelColor`, `panelOpacity`, `showZones`, `showCountdown`, `rseq`, `onDemand`, `showSec`, `showOnSignup`, `zones`.

Progress / operational state: `events`.

### giveaway

Settings: `rates`, `blocked`, `display`.

Progress / operational state: `entrants`, `chatActiveThisWindow`, `winners`, `manualLog`, `windowStartedAt`, `jarBaseline`, `testDraw`.

### hub

Settings: `order`, `startup`, `custom`.

Progress / operational state: None.

### hunt

Settings: `title`, `subtitle`, `visible`, `joinOpen`, `scoring`, `lockTeams`, `ignore`, `teams`, `items`, `seq`, `stopAtEnd`, `look`, `epoch`.

Progress / operational state: `players`, `timer`, `log`.

### live

Settings: `schemaVersion`, `reader`, `updatedAt`, `migration`.

Progress / operational state: `resources`, `session`, `reconciliation`.

### neonchat

Settings: `visible`, `showFrame`, `frameOnlyWithChat`, `showTitle`, `title`, `streamerName`, `textSize`, `maxMessages`, `fadeSec`, `glow`, `bgColor`, `bgOpacity`, `hueShift`, `nameFont`, `hideCommands`, `hideMe`, `hideNames`, `useTwitchColors`, `showBadges`, `sparkles`, `newestOnTop`, `roleColors`, `events`.

Progress / operational state: None.

### newsticker

Settings: `visible`, `label`, `showLabel`, `separator`, `speed`, `gap`, `barColor`, `barOpacity`, `textColor`, `labelColor`, `labelText`, `accent`, `font`, `messages`, `seq`, `alert`.

Progress / operational state: None.

### oceanfish

Settings: `visible`, `waveSpeed`, `waveHeight`, `sparkles`, `gold`, `bg`, `fishSize`, `jumpHeight`, `jumpSpeed`, `jumpEvery`, `jumpCount`, `jumpSpread`, `variety`, `autoJump`, `splash`, `directions`, `onDemand`, `showSec`, `showOnJump`, `useDefault`, `pick`, `fish`, `seq`.

Progress / operational state: None.

### paliaclock

Settings: `visible`, `title`, `bannerSec`, `sound`, `volume`, `alarms`, `look`, `seq`.

Progress / operational state: None.

### parties

Settings: `visible`, `showTwitch`, `seq`, `liveId`, `spotRotateSec`, `spotHoldSec`, `spotChat`.

Progress / operational state: `names`, `events`, `slots`.

### poll

Settings: `title`, `open`, `showResults`, `endsAt`, `subWeight`, `revealed`, `seq`.

Progress / operational state: `options`, `votes`.

### randomizer

Settings: `games`, `link`, `recent`.

Progress / operational state: None.

### resource-trackers

Settings: `schemaVersion`, `visible`, `updatedAt`, `startAt`, `slotStartAt`.

Progress / operational state: `counts`, `secondaryCounts`, `slotCounts`, `previous`, `lastLoginAt`, `lastResetAt`.

### sashimi-signin

Settings: `visible`, `open`, `live`, `seq`, `font`, `cols`, `title`, `max`, `ignore`, `accent`, `panelColor`, `panelOpacity`, `showZones`, `showCountdown`, `rseq`, `zones`, `showBy`, `hereColor`.

Progress / operational state: `events`, `names`.

### settings

Settings: `schemaVersion`, `countdown`, `worldClock`, `stream`, `ticker`, `layout`, `updatedAt`.

Progress / operational state: None.

### sprite-tv

Settings: `visible`, `mode`, `pinnedId`, `pinnedVariant`, `showName`, `showVariant`, `showRarity`, `flashMs`, `staticMs`, `idleBars`, `textPos`, `textSize`, `imgSize`, `slideshow`, `ssDelay`, `ssInterval`, `ssPool`, `ssMessage`, `ssSubMessage`, `ssShowInterrupt`, `seq`.

Progress / operational state: None.

### sprites

Settings: `season`, `popupSec`, `jar`.

Progress / operational state: `sprites`, `caught`, `recent`.

### steam

Settings: `steamId`, `appId`, `gameName`, `enabled`, `pollSec`, `popupSec`, `showRarity`, `progressTitle`, `pinnedStats`, `cardImage`, `cardBox`, `profileInput`.

Progress / operational state: `known`, `schema`, `statDefs`, `stats`, `rarity`, `seq`, `popups`, `lastPoll`, `lastOk`, `lastError`, `schemaAt`.

### streamframe

Settings: `visible`, `art`, `glow`, `glowStrength`, `glowSpeed`, `flicker`, `flickerRate`, `chaser`, `chaserSpeed`, `chaserLength`, `chaserColor`, `chaserOffset`, `chaserCount`, `chamfer`, `sun`, `sunShimmer`, `sunX`, `sunY`, `sunR`, `stars`, `starTwinkle`, `sparkles`, `colorMode`, `hueShift`, `cycleSpeed`, `introOnLoad`, `reactionStrength`, `reactions`.

Progress / operational state: None.

### teams

Settings: `title`, `teamCount`, `teams`, `item`, `presets`, `joinOpen`, `counting`, `showPlayers`, `showBanner`, `visible`, `seq`.

Progress / operational state: `players`, `log`.

### todos

Settings: `schemaVersion`, `updatedAt`.

Progress / operational state: `daily`, `weekly`.

### turnline

Settings: `visible`, `open`, `showHeader`, `title`, `dish`, `turnsEach`, `font`, `joinWord`, `goColor`, `doneColor`, `waitColor`, `accent`, `bgMode`, `bgColor`, `bgOpacity`, `bgRadius`, `bgImage`, `bgFit`, `seq`.

Progress / operational state: `people`, `roundId`, `roundStartedAt`.

### walkers

Settings: `settings`.

Progress / operational state: `people`.

### weekly-accomplishments

Settings: `schemaVersion`, `updatedAt`.

Progress / operational state: `weekStart`, `progress`, `previous`, `lastResetAt`.

### tradeup-config

Settings: `schemaVersion`, `pools`, `whammy`.

Progress / operational state: `items`.

### tradeup-state

Settings: .

Progress / operational state: `board`, `revealed`, `spinSeq`, `log`.

## Machine-only exclusions

- `desktop-widgets.json`: actual window positions, physical monitor IDs and local desktop preferences.
- `cloudinary-upload-manifest.json`: selected provider upload/download bookkeeping; credentials remain in ignored environment files.
- `activity-outbox.json`, `palia-cursor.json`, bridge cursor: temporary sealed transport and byte-position checkpoints.
- Actual Palia logs, artwork/audio files, and explicit import files stay on this PC. Only typed facts, selected relative artwork references and metadata cross the API.
- Neon Chat messages, avatar bubbles, walker animations, sounds and physics remain bounded local/browser RAM. Repetitive overlay-request JSON logging is removed.

## Commands and verification

- Operator edits: UUID, protocol 2, expected feature revision, allowlisted route/method/operands; stale forms return 409. Browser read revisions survive background SSE updates while a draft is dirty.
- Collector intents: ordered owner/collector sequence, provider source key, timestamp, minimal known operands; message counts use independent ten-second batches. PostgreSQL decides all awards.
- Game facts: explicit collector session, stable file-generation/byte-position source keys, verified item tokens, quantities and quality; no raw line. Startup stock is an explicit boot command.
- Reads: one shared two-second local feed, immutable paginated snapshots, incremental documents and unchanged-view digests, transport clock offset, bounded expiring display events.
- `feature-lifecycle.test.js`, `features-postgres.test.js`, `worker-postgres.test.js`, source-roundtrip PostgreSQL tests and existing domain tests cover cloud behavior, atomicity, owner isolation, retries, cold contexts, resets, timers and credentials.
- The existing local E2E suite uses a test-only injected cloud backend; production has no fallback rule engine. Actual PostgreSQL tests cover the SQL repositories separately.
- Headless Chromium covers the existing 29 pages plus two simultaneous unsaved forms; no personal browser is controlled.
- Fresh builds and version-005 upgrades must match the per-object catalog. Private dump verification compares row counts and content fingerprints for every table.

## Source recovery

`feature_migrations` records the source hash, acknowledged input boundary, migration UUID, protocol/schema versions and initial cloud revision. `feature-recovery.js` exports fresh current SQL state and can fence/resume one feature with digest verification. A fence pauses collector claims; rollback never restores a pre-cutover local file over newer cloud progress.
