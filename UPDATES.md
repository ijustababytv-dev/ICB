# Updates

## New Features

- 2026-10-25: Akwinduu Chapaa tracker card (`/akwinduu-chapaa.html`): counts down from 100, 1 per cook line of `itemtype_c_dinner_salisburychapaa` (the game's internal name for it).
- 2026-10-25: Meaty Stir Fry tracker card (`/meaty-stir-fry.html`): counts down from 100, 1 per cook line of `itemtype_c_stirfry` (confirmed from a real cook; Spicy Stir Fry is separate and not counted).
- 2026-10-25: Pumpkin Pie tracker card (`/pumpkin-pie.html`): counts down from 100, 1 per cook line of `itemtype_c_pumpkinpie` (confirmed from a real cook in her log).
- 2026-10-25: Apple Pie tracker card (`/apple-pie.html`): counts down from 100, 1 per cook line of `itemtype_c_dessert_pie_apple` (token confirmed in her logs; no real cook line seen yet, so spot-check the first time it moves).
- 2026-10-25: Neon Chat (tile on ICB Home): a chat box in the synthwave overlay style as its own Meld layer she sizes and places. Shows emotes, role colours and ★/MOD/VIP/SUB tags, hides !commands, bots and optionally /me lines, fades old messages, and can show follows, subs, gifts, bits and raids as glowing lines. The chat listener now also passes each chatter's badge names and name colour.
- 2026-10-25: Animated Overlay (tile on ICB Home): her synthwave overlay with a neon glow pulse and flicker, a light that runs along the real neon tubes round the camera and game frames, sun shimmer, twinkling stars and sparkles, colour shift, a power-on intro, and reactions to follows, subs, gifted subs, bits and raids (from the Meld listener; blocked names ignored). Overlay is ES5 and polls every two seconds; art lives in `assets/stream-frame/`.
- 2026-10-24: Ocean Fish overlay and dashboard (tile on ICB Home). Waves with gold trim and sparkles, several fish pictures (saved in `assets/ocean-fish/`), random or in-order picks, per-fish size and flip, and group jumps (fish per jump, time between). Overlay is ES5 and polls every two seconds; jump/show/hide reach it as numbered commands.
- 2026-10-22: Added a separate Cloudinary download launcher. Restores new or changed images into assets, skips identical files, verifies downloads, and backs up replaced local images.
- 2026-10-22: Added Cloudinary image comparison and sync commands. New and changed images upload; identical images are skipped, folders stay organized, and remote-only images are kept.
- 2026-10-22: Uploaded and checksum-verified all 274 project images. Confirmed a repeat sync uploads nothing; added a double-click launcher and saved the image URLs locally.
- 2026-10-17: Countdowns dashboard and overlay (themes, end text, size).
- 2026-10-18: Team Hunt contest (unlimited !team teams, custom hunt items with points).
- 2026-10-19: Palia Clock with Palia-time alarms and a quick Palia timer.
- 2026-10-20: Bean Burger and Flow Tree sign-up widgets (copies of the Poke Bowl sign-up, each with its own saved events).
- 2026-10-20: Chat can type !show / !hide poke, cake, burger or flow for each sign-up.

## Improvements

- 2026-10-25: Neon Chat background colour and strength on the dashboard, with See-through and Solid buttons (strength 0 = only the neon frame shows).
- 2026-10-24: Updated README.md as the project overview and quick start, corrected stale port and documentation guidance, and added README reading instructions to CLAUDE.md and AGENTS.md.
- 2026-10-24: Removed the restored 7,217-line root server after migrating Sprite TV and Poke Bowl attendance into focused modules. Retired duplicate root pages while preserving the modular sprite jar.
- 2026-10-24: Added an installed pre-commit guard and GitHub source checks for the 500-line / 40 KB limits, source folders, unchanged vendor files, and the root-server ban. Added regression tests, including a rejected oversized test commit.
- 2026-10-24: Consolidated useful standing instructions into AGENTS.md and RULES.md. CLAUDE.md now only directs readers to those files and UPDATES.md, including after changes by Aleister V.M. Removed obsolete feature-status claims and conflicting skin geometry guidance.
- 2026-10-24: Verified 132 unit tests and 20 isolated browser pages; formatting and source-policy checks pass. E2E checks still report the existing missing `assets/resources/poke_bowl.png`; other integration checks pass.
- 2026-10-22: Formatted all maintained JavaScript with four-space indentation and blank lines between functions. Split files that exceeded the size limits, added repeatable formatting commands, and expanded browser checks to 16 pages.
- 2026-10-22: Split the giant server into focused feature, route, and business-rule modules; organized HTML, scripts, styles, and local images while keeping existing URLs and launchers.
- 2026-10-22: Added unit tests, headless browser checks, and guards against giant files, circular imports, and embedded base64 images. All future business rules require unit tests.
- 2026-10-20: Renamed Event Sign-Up to Poke Bowl Sign-up and Party Sign-ups to Cake Sign-Ups.

## Bug Fixes

- 2026-10-24: Re-measured the Sashimi value box for the new `SASHIMI_NEW.png` art (1774 x 887) so the count sits in the blank panel. Only that card's `valueBox` in `config/resource-trackers.json` changed.
- 2026-10-24: Merged the restored Ocean Fish stash onto the modular-layout changes. Resolved conflicts in the API router and Poke Bowl dashboard handler, kept the tested `signup-checkins` attendance code, and removed a duplicate `!here` handler. Split the overlay to meet the 500-line limit and added unit, smoke, and browser coverage.
- 2026-10-24: Connected Sprite TV and Poke Bowl check-ins to the active modular server, with unit and integration coverage. Fixed slideshow roster lookup, ownership checks, cancellation/retry behavior, and the Sprite TV copy-link binding.
- 2026-10-22: Updated stale tracker tests to validate prefix-based slots and intentional overlap between collection cards. End-to-end checks still report the existing missing `poke_bowl.png` artwork.
- 2026-10-22: Static file serving now keeps server source and private state outside public paths.
