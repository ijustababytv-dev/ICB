# Updates

## New Features

- 2026-10-30: Added Terraform for a micro AWS PostgreSQL database, public VPC/subnets, internet-accessible PostgreSQL firewall, password authentication, mandatory TLS, backups, and deployment instructions. Infrastructure has not been applied.

- 2026-10-29: Vampire Crab Dishes tracker card (`/crab-dishes.html`): Crab Gumbo, Spicy Crab Fried Rice and Crab Pot Pie as three countdown boxes on one art card (replaces the three separate cards). Each box takes 1 off per cook line of its dish. Collection cards can now have countdown boxes, with a per-box 'Set & restock' on the Tracker Command Center.
- 2026-10-29: Vampire Crab Pot Pie tracker card (`/crab-pot-pie.html`): counts down from 100, 1 per cook line of `itemtype_c_crabpotpie` (token from her; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-29: Spicy Vampire Crab Fried Rice tracker card (`/crab-fried-rice.html`): counts down from 100, 1 per cook line of `itemtype_c_crabfriedrice` (token from her; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-29: Vampire Crab Gumbo tracker card (`/crab-gumbo.html`): counts down from 100, 1 per cook line of `itemtype_c_crabgumbo` (token from her; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-29: Turn Line (tile on ICB Home): viewers type `!turn` to join a line to take turns starting the same dish. The person whose turn it is shows green, finished people turn red, the rest wait in white. One Done button moves to the next person (plus Undo, Skip to back, reorder, remove, New round). `!leave` takes a viewer off. The 10 starts each are shown on screen but not counted. Its own see-through Meld layer: `/turn-line.html`; dashboard `/turn-line-control.html`. Overlay is ES5 and polls every two seconds.
- 2026-10-29: Stripeshell Snail tracker card (`/stripeshell-snail.html`): counts up every Stripeshell Snail caught (`itemtype_bug_snailr`); storage withdrawals don't count. Never resets on its own.
- 2026-10-29: King Crab tracker card (`/king-crab.html`): counts up every King Crab caught (`itemtype_bug_az3_crab_king`); storage withdrawals don't count. Never resets on its own.
- 2026-10-29: Vampire Crab tracker card (`/vampire-crab.html`): counts up every Vampire Crab caught (`itemtype_bug_crabr`, confirmed in her game log); storage withdrawals don't count. Never resets on its own.
- 2026-10-25: Akwinduu Chapaa tracker card (`/akwinduu-chapaa.html`): counts down from 100, 1 per cook line of `itemtype_c_dinner_salisburychapaa` (the game's internal name for it).
- 2026-10-25: Meaty Stir Fry tracker card (`/meaty-stir-fry.html`): counts down from 100, 1 per cook line of `itemtype_c_stirfry` (confirmed from a real cook; Spicy Stir Fry is separate and not counted).
- 2026-10-25: Pumpkin Pie tracker card (`/pumpkin-pie.html`): counts down from 100, 1 per cook line of `itemtype_c_pumpkinpie` (confirmed from a real cook in her log).
- 2026-10-25: Apple Pie tracker card (`/apple-pie.html`): counts down from 100, 1 per cook line of `itemtype_c_dessert_pie_apple` (token confirmed in her logs; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-25: Neon Chat (tile on ICB Home): a chat box in the synthwave overlay style as its own Meld layer she sizes and places. Shows emotes, role colours and ★/MOD/VIP/SUB tags, hides !commands, bots and optionally /me lines, fades old messages, and can show follows, subs, gifts, bits and raids as glowing lines. The chat listener now also passes each chatter's badge names and name colour.
- 2026-10-25: Animated Overlay (tile on ICB Home): her synthwave overlay with a neon glow pulse and flicker, a light that runs along the real neon tubes round the camera and game frames, sun shimmer, twinkling stars and sparkles, colour shift, a power-on intro, and reactions to follows, subs, gifted subs, bits and raids (from the Meld listener; blocked names ignored). Overlay is ES5 and polls every two seconds; art lives in `assets/stream-frame/`.
- 2026-10-24: Ocean Fish overlay and dashboard (tile on ICB Home). Waves with gold trim and sparkles, several fish pictures (saved in `assets/ocean-fish/`), random or in-order picks, per-fish size and flip, and group jumps (fish per jump, time between). Overlay is ES5 and polls every two seconds; jump/show/hide reach it as numbered commands.

## Improvements

- 2026-10-31: Updated the ignored logging plan to use Express on Lambda with pg and pg-format, explicit SQL, and no ORM.

- 2026-10-31: Rewrote the local, ignored logging plan as technical implementation steps grouped by feature. No runtime or infrastructure changes.

- 2026-10-30: Stopped tracking LOGGING-ADJUST.md; the ignored local copy remains available.

- 2026-10-30: Added LOGGING-ADJUST.md with a proposed minimal activity model, separate summaries, PostgreSQL delivery, and migration checks. Runtime behavior is unchanged.

- 2026-10-29: Turn Line background: none (see-through), a color panel, or a picture (upload on the dashboard or drop one in `assets/turn-line`), with strength, rounded corners and fill/fit/stretch. The background fills the whole Meld layer, so resize the layer to size it.
- 2026-10-25: Neon Chat background colour and strength on the dashboard, with See-through and Solid buttons (strength 0 = only the neon frame shows).
- 2026-10-24: Updated README.md as the project overview and quick start, corrected stale port and documentation guidance, and added README reading instructions to CLAUDE.md and AGENTS.md.
- 2026-10-24: Removed the restored 7,217-line root server after migrating Sprite TV and Poke Bowl attendance into focused modules. Retired duplicate root pages while preserving the modular sprite jar.
- 2026-10-24: Added an installed pre-commit guard and GitHub source checks for the 500-line / 40 KB limits, source folders, unchanged vendor files, and the root-server ban. Added regression tests, including a rejected oversized test commit.
- 2026-10-24: Consolidated useful standing instructions into AGENTS.md and RULES.md. CLAUDE.md now only directs readers to those files and UPDATES.md, including after changes by Aleister V.M. Removed obsolete feature-status claims and conflicting skin geometry guidance.
- 2026-10-24: Verified 132 unit tests and 20 isolated browser pages; formatting and source-policy checks pass. E2E checks still report the existing missing `assets/resources/poke_bowl.png`; other integration checks pass.

## Bug Fixes

- 2026-10-24: Re-measured the Sashimi value box for the new `SASHIMI_NEW.png` art (1774 x 887) so the count sits in the blank panel. Only that card's `valueBox` in `config/resource-trackers.json` changed.
- 2026-10-24: Merged the restored Ocean Fish stash onto the modular-layout changes. Resolved conflicts in the API router and Poke Bowl dashboard handler, kept the tested `signup-checkins` attendance code, and removed a duplicate `!here` handler. Split the overlay to meet the 500-line limit and added unit, smoke, and browser coverage.
- 2026-10-24: Connected Sprite TV and Poke Bowl check-ins to the active modular server, with unit and integration coverage. Fixed slideshow roster lookup, ownership checks, cancellation/retry behavior, and the Sprite TV copy-link binding.
