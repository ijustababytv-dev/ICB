# Updates

## New Features

- 2026-11-08: Created baby-icb-deployer for updates to the two existing ICB Lambdas, their release files and their existing runtime roles. AWS resource creation/deletion and broad account reads are not permitted. Access keys stay in ignored local .env.aws with restricted Windows permissions.

- 2026-11-08: Added a Fish Tacos tracker (token itemtype_c_fishtacos). It counts down from 100, one per cook line whatever the stack size; selling or eating never moves it. Page: /fish-tacos.html. Cloud definition deployed and verified on 2026-11-08; target PCs need current source/artwork and a normal authorized restart.

- 2026-11-02: Added stop-icb-clean.bat to stop the local ICB server and confirm port 8790 is free, with an already-stopped message and a guard against stopping unrelated apps.

- 2026-11-01: Integrated main's daily Unicorn Jar check-in and jar/cloud/unicorn size sliders. Checked-in viewers bring their full saved ticket balance; absent viewers stay out of the jar, board and draws until they chat.

- 2026-11-01: Added the categorized operator sidebar, tight fuzzy page search with keyboard suggestions, an alphabetical All Pages directory and a last-opened Recent Pages table. Home shows responsive panels of four recent tools beneath its subtitle.

- 2026-11-01: Restored 339 missing project images from Cloudinary using download-cloudinary-images.bat, including the Poke Bowl tracker artwork.
- 2026-11-01: Implemented required Cloud sign-in for all pages, overlays, artwork and feature APIs, with Windows-protected fixed 14-day remembered sessions. Deployed the cloud session update; local activation requires a normal authorized restart.

## Improvements

- 2026-11-08: Added a code-only feature release command that automatically loads .env.aws and updates existing Lambdas without Terraform. Documented this workflow for Claude, private credential transfer and deliberate key rotation; infrastructure/SQL administration stays separate.

- 2026-11-08: Made tracker delivery requirements explicit for every contributor, including Claude: navigation, Cloudinary recovery/upload verification, cloud deployment, local activation and honest pending-step reporting.

- 2026-11-04: Restored the GitHub Actions Source policy workflow after briefly disabling it. Pushes and pull requests again run architecture checks, unit tests and formatting checks; local verification remains required.

- 2026-11-01: Moved the PostgreSQL guide into database/ and the AWS guide into terraform/; updated contributor instructions, documentation references and internal links.

- 2026-11-01: Expanded database/POSTGRES.md with an alphabetical, table-by-table data inventory.

- 2026-11-01: Merged origin/main through 902ec2f into log-adjust, adapting giveaway behavior to cloud transactions and current UI folders. Kept runtime JSON/logs untracked, stopped tracking the machine-specific bridge cursor, and retained current sidebar/authentication.

- 2026-11-01: Referenced the PostgreSQL data inventory from AGENTS.md and CLAUDE.md.

- 2026-11-01: Added database/POSTGRES.md with a compact inventory of stored account, activity, feature and operational data, plus what remains outside PostgreSQL.

- 2026-11-01: Removed Home's obsolete startup/custom-link tile section and editor code; saved links remain in Connections, search and All Pages. Audited all 116 catalog pages and 30 former built-in tiles for sidebar coverage.

- 2026-11-01: Replaced the Home button wall with shared navigation across operator dashboards. Startup ordering/custom links remain in collapsed settings. Recent UI history is browser-local and account-separated; automated Meld layers are excluded.

- 2026-11-01: Clarified all 113 Home directory labels by purpose: dashboards, sign-up overlays, cooking/resource/collection trackers, widgets and connection tools. Built-in tiles use the same labels; custom names stay intact.
- 2026-11-01: Cloudinary download verified all 613 images, updated six differing files with backups and skipped 268 identical files. A second comparison found nothing left to download.
- 2026-11-01: Kept Home navigation bars only on other dashboards; Home continues using its page directory.
- 2026-11-01: Simplified login to one centered form and removed its account/sync information panel.
- 2026-11-01: Dashboard navigation now contains only Home links. Home's account button is labeled Account & sign out.
- 2026-11-01: Launchers open sign-in, restored sessions validate online, and successful login returns to the requested page. Added real Windows encryption, restart, access-gate and PostgreSQL expiry coverage.

## Bug Fixes

- 2026-11-08: Dedicated deployment credentials override the legacy Vox profile and clear stale session tokens. The dotenv loader rejects incomplete/unsupported settings without printing credentials; routine releases no longer depend on an expiring human login.

- 2026-11-08: Restored Fish Tacos and the eight previously missing tracker originals from Cloudinary. Kept new overlay URLs reachable during cloud rollout without inventing counts; Fish Tacos ignores lockbox dumps. Added rollout, cooking transport and browser regression coverage. Deployed the cloud package and verified Fish Tacos in the authenticated production feed. Target-PC activation and first real cook remain pending.

- 2026-11-02: Countdown dashboard edits made at the same moment all save. Writes now send one at a time, and a rejected write shows one error instead of being dropped silently.

- 2026-11-02: Countdown Start buttons work again. They sent the remembered input and the start as two requests with the same revision, so the cloud rejected the start without any message. They now send one command, and a rejected timer action shows an error.

- 2026-11-01: Same-window chat can re-enter an emptied jar without a second ticket award. Earlier queued presence cannot undo an explicit clear; the 06:00 account-timezone cutoff survives DST and cold cloud contexts.

- 2026-11-01: Kept Home randomizer, connection checks and saved-link navigation working after removing the legacy tile controls.

- 2026-11-01: Search input does not mark feature forms as edited or freeze their revisions. Recent history removes duplicate visits, ignores query strings and handles corrupt/blocked browser storage. No pinned-tools section or top-right Browse all pages button was added.

- 2026-11-01: Distinguished Poke Bowl and Bean Burger sign-up dashboards, sign-up overlays and cooking trackers, and identified the Plushie Jar draw dashboard and overlay by their actual purpose.
- 2026-11-01: Fixed missing Poke Bowl artwork: the original 2048 x 768 PNG now returns HTTP 200. The other eight tracker originals were subsequently restored on 2026-11-08.
- 2026-11-01: Removed redundant top/bottom ICB Home links from the Home page itself.
- 2026-11-01: Login status refresh now updates only authentication controls and feedback, without accessing removed diagnostics elements.
- 2026-11-01: Removed both navigation bars from login and redundant Cloud sign-in links from all dashboard headers/footers.
- 2026-11-01: Sign out and expiry lock open pages and close event streams; obsolete login/restore responses cannot reopen access. Prevented login feedback being erased by session-change reloads and native form submission putting passwords in URLs.
