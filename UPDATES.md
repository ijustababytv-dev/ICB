# Updates

## New Features

- 2026-10-22: Added Cloudinary image comparison and sync commands. New and changed images upload; identical images are skipped, folders stay organized, and remote-only images are kept.
- 2026-10-22: Uploaded and checksum-verified all 274 project images. Confirmed a repeat sync uploads nothing; added a double-click launcher and saved the image URLs locally.
- 2026-10-16: Chat Avatars (ghost avatars for chatters), Sprite Jar + spooky sticker book with floor toys, Fortnite Sprites sticker art.
- 2026-10-17: Countdowns dashboard and overlay (themes, end text, size).
- 2026-10-18: Team Hunt contest (unlimited !team teams, custom hunt items with points).
- 2026-10-19: Palia Clock with Palia-time alarms and a quick Palia timer.
- 2026-10-20: Bean Burger and Flow Tree sign-up widgets (copies of the Poke Bowl sign-up, each with its own saved events).
- 2026-10-20: Chat can type !show / !hide poke, cake, burger or flow for each sign-up.

## Improvements

- 2026-10-22: Split the giant server into focused feature, route, and business-rule modules; organized HTML, scripts, styles, and local images while keeping existing URLs and launchers.
- 2026-10-22: Added unit tests, headless browser checks, and guards against giant files, circular imports, and embedded base64 images. All future business rules require unit tests.
- 2026-10-20: Renamed Event Sign-Up to Poke Bowl Sign-up and Party Sign-ups to Cake Sign-Ups.

## Bug Fixes

- 2026-10-22: Updated stale tracker tests to validate prefix-based slots and intentional overlap between collection cards. End-to-end checks still report the existing missing `poke_bowl.png` artwork.
- 2026-10-22: Static file serving now keeps server source and private state outside public paths.
