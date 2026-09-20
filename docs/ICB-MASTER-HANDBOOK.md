# ICB Master Handbook

**The one document to read if everything is forgotten.**

This is the complete record of the IJUSTABABY Control Bridge: what it is, how it was built, the
method used to build it, every hard-won lesson, and step-by-step recipes for adding to it.
Written 2026-08-19, at the point where the plush bar and all 14 resource trackers were confirmed
working on stream.

> **Update 2026-08-29 — Plush Hunt, Plush Bar, and Total Bug were removed at Baby's request for a
> fresh start.** Their overlay pages, config, data, artwork, dashboard panels, server code, and
> tests are gone. Weekly Accomplishments lost its three bug-catching items. The **Ramen Plush
> resource card** is a normal resource tracker and stays. Where this handbook still describes those
> features below, treat it as history — the *method* sections (Part 2) remain the point; the
> plush-specific tables, file map entries, API routes, and the "Add a plushie" recipe no longer
> reflect the code. Anything plush that comes back is a new deliberate build.

If you are a new AI session: read this first, then `CLAUDE.md`. If you are Baby: **Part 1 is for
you**, the rest is for whoever is doing the building.

---
---

# PART 1 — FOR BABY (no tech words)

## What this thing is

A little program that runs on your own computer. It reads the file Palia Assistant writes while you
play, notices when you pick something up, and shows the count on your stream.

Nothing goes to the internet. Nothing costs money. It only runs while you have it open.

## Turning it on, in order

1. **Double-click `restart-icb-clean.bat`** in the ICB-Clean folder. Wait until it says READY.
2. **Start Palia Assistant.**
3. **Start Palia.**
4. **Meld** — any time. The layers reconnect on their own.

The one rule: the server and Palia Assistant must both be running **before** you catch your first
thing. The reader jumps to the end of the log when it starts, so anything caught while it was off is
invisible to it forever. If you realise halfway through, use the **+** buttons on the dashboard to
add what you already got.

## Your dashboard

`http://127.0.0.1:8790/control.html` in Chrome. **Never put this in Meld** — it's your private
control panel, not something viewers should see.

It shows every tracker, lets you nudge counts up and down, and has a **Run the system** checklist at
the top that tells you the single next thing to do.

## What's on your stream

| Thing | Address to paste into Meld | Layer size |
| --- | --- | --- |
| Ticker banner | `http://127.0.0.1:8790/ticker.html` | 900 × 506 |
| Weekly Accomplishments | `http://127.0.0.1:8790/weekly.html` (or `/weekly-wide.html`) | 480 × 980 |
| Each resource card | `http://127.0.0.1:8790/gold-ore.html` and so on | 620 × 280 |

Full list of the card addresses is in `ICB-RESOURCE-TRACKERS.md`, and each one is printed next
to its picture on the dashboard so you can copy them.

**Never put a question mark or anything extra on the end of these addresses.** That has caused
trouble before.

## What resets and what doesn't

- **Amber Echo and Infected Essence** — never reset.
- **Every other resource card** — goes back to 0 each time you log into Palia.

If a reset happens and you didn't want it, the dashboard shows an **"Undo — put the numbers back"**
button. Use it before you log in again.

## If something looks wrong

1. Is the server running? Run `restart-icb-clean.bat`.
2. Open the address in **Chrome**. If it shows up there, the problem is Meld, not the tracker.
3. Still stuck? Tell your AI helper: **"read `docs/ICB-MASTER-HANDBOOK.md` and
   `data/overlay-requests.json`"**. That file records who asked the server for what, so they can see
   the problem instead of guessing.

## The things worth protecting

If you ever copy this folder somewhere safe, the part that actually matters is the **`data`**
folder. That's where your real numbers live. Everything else can be rebuilt; those counts can't.

Run `backup-icb-clean-state.bat` now and then.

---
---

# PART 2 — THE METHOD

This is the part that is genuinely hard to rediscover. The code can be read; the way of working
cannot.

## 1. Verify against real data, never against assumptions

The single most valuable habit on this project. The system was handed over **passing its own test
suite while being completely broken**, because the tests used a synthetic fixture that did not look
like a real Palia Assistant log.

The bug was only found by opening Baby's actual log files and reading them.

**So: when in doubt about log behaviour, read a real log** at
`C:\Users\mrsch\AppData\Local\PaliaAssistant\logs\app-*.log`. They are readable through the device
bridge. Grep them. Count occurrences. Compare two dumps hours apart. The answer is in there.

## 2. Never guess a token

An item's log token is **not** derivable from its name. Guessing produces a tracker that sits at
zero all stream and looks like a bug rather than a mistake.

Real examples from this project that would each have been wrong:

| Card | Wrong guess | Actual token | Why the guess fails |
| --- | --- | --- | --- |
| Gold Ore | `itemtype_currency_gold` | `itemtype_mineral_ore_gold` | The currency appears 606× in the logs, the ore 11×. Popularity is a trap — it would have counted her money. |
| Dragon's Beard Peat | anything with "peat" | `itemtype_forage_moss_dragonsbeard` | The word "peat" is not in the token at all. |
| Rockhopper plush | match plush to creature name | bug is `hopperflame`, plush is `rockhopper` | An automated creature-matcher was written, got these wrong, and was **discarded rather than shipped**. |

The rule that came out of it: **a token enters the config only after being seen in a real
`Inventory:` or `Lockbox:` line.** Where a token genuinely isn't known yet, build a "learn mode"
that captures unknown tokens and lets Baby bind one from the dashboard — never a placeholder.

## 3. Make failures loud, never silent

A silent failure on a live stream is worse than a visible error, because Baby can't tell whether
it's broken or just zero.

Applied throughout:
- An icon file whose token isn't in the catalog is **refused and listed on the dashboard**, not
  quietly skipped.
- The dashboard reports whether Meld is actually fetching each overlay page.
- `data/overlay-requests.json` records every request with its browser user-agent, so a future
  session can diagnose from files alone without needing Baby to describe symptoms.
- When a page can't reach the server it keeps the last number rather than blanking — a two-second
  stale number beats an empty box on stream.

## 4. Write tests that bite, then prove they bite

After writing an assertion, **deliberately break the thing it guards and confirm the test fails**,
then restore. An assertion that has never failed is not known to work.

Done for the skin standard (broken five different ways) and for the resource trackers (bad token,
box outside the artwork, two cards claiming one token — all three confirmed to fail).

## 5. Verify visually, not just numerically

Overlays are pictures. "The test passes" does not mean "it looks right".

The workflow used throughout: run the real server, load the page in headless Chromium via
Playwright, screenshot it, composite it onto a solid colour so transparency is visible, and
**actually look at it**.

This caught: numbers spilling outside their box, a bar wrapping to three rows instead of two,
tiles ballooning to 380px wide when there were only five, and washed-out greyscale artwork.

Also verify **with JavaScript disabled** for overlay pages. If the artwork still renders, a script
failure costs the counts instead of the whole layer.

## 6. Scope down when stuck

When the multi-card overlay refused to render in Meld after many attempts, Baby said: *"look I
don't even care about all the other trackers.. if we can just get the 'total bug tracker' working
I'll be happy."*

Building that one simple page worked immediately — and it became the template every later overlay
was built from. **One working thing beats four broken ones**, and the working thing teaches you why
the others failed.

## 7. Own mistakes plainly

A screenshot with fake test numbers was once sent without labelling it, and Baby reasonably asked
why there were already numbers in the box. The right response was to verify no real data existed,
say plainly that it was a mistake, and move on. No spiralling.

## 8. Change one thing at a time

Run the tests, back up state, change one thing, run the tests again. When several things change at
once and it breaks, you have learned nothing.

---
---

# PART 3 — HOW THE SYSTEM WORKS

## Hard constraints (Baby's rules — do not re-litigate)

- **One local Node server only.** Never create a second one.
- **`http://127.0.0.1:8790`.** **Never port 8787** — it is dead and has caused a wasted debugging
  session already, when Meld's assistant "helpfully" changed the URLs to it.
- **No dependencies.** Plain Node, no npm packages, ever.
- `/control.html` is the private Chrome dashboard. **Never put it in Meld.**
- Baby uses **Meld Studio, not OBS**.
- `C:\StreamLive` and the old `ICB` folders are **legacy, not runtimes**.
- Settings state and live tracker state stay separate. A settings save must never touch a count.
- **No generic tracker-creation dashboard.** Each tracker is a deliberate one-at-a-time build.
- Work autonomously. Don't stop at a report or a partial plan.

## The log reader — the heart of it

Palia Assistant writes several kinds of line. **Only some are real events:**

| Line | Counted? | Why |
| --- | --- | --- |
| `Inventory gained:` / `Inventory lost:` | **Yes** | Real incremental changes |
| `Lockbox gained:` / `Lockbox lost:` | **Yes** | Real incremental changes |
| `Primary gained:` / `Primary lost:` | **NO** | Periodic full-inventory resync. Counting these inflates everything. |
| `Crafted recipe N: a -> b` | N/A | No item token |

This distinction **is the original bug** that broke the handed-over system. It was proved by
diffing two `Primary` dumps three hours apart: item-for-item identical. The old parser scored any
line containing "gained" near a token, so every resync silently inflated the totals.

**Quality markers.** Tokens can carry one: `itemtype_forage_spice_sweetleaves (1*) x6`. The quantity
regex must allow an optional parenthesised group or it silently undercounts. This was confirmed in
production on Baby's real log — that exact line applied correctly as −6.

**Login detection.** `MAP_IntroMovie` and `MAP_PreGame` appear **only** at game startup, never on
zone travel — `app-20260818.log` contains no other `MAP_` value at all. But Baby logged in **11
times that day**, so a login reset must be debounced (2 minutes) and must always be undoable.

**Substring safety.** `quantityFor` matches the exact token followed by an optional `(...)` then
digits, so `itemtype_crop_apple` cannot match `itemtype_crop_apple_golden x2`. Keep it that way.

## The overlay pattern that works in Meld

This cost more time than anything else on the project, so it is written down precisely.

**`plushhunt.html` — the multi-card overlay — NEVER rendered in Meld**, across many attempted
fixes. It is abandoned. Do not resurrect it. Do not debug it.

**What works**, proven on stream:

1. **A dedicated page per layer.** One URL, one job.
2. **No query string on the Meld URL.** Ever. If a layout variant is needed, give it its own plain
   path (`/weekly-wide.html`) rather than a parameter. Note this was never *proved* to be the cause
   of the failure — but the one page that used query strings never rendered, and a live stream is
   the wrong place to test the theory.
3. **The image is in the HTML the server sends** — not created by JavaScript after a fetch. This
   was the actual difference between the working and non-working pages.
4. **Plain ES5 only.** No arrow functions, no `const`/`let`, no `??`, no template literals in the
   inline script. Modern syntax kills the entire script and Meld shows a blank layer.
5. **XHR polling every 2 seconds.** No EventSource on overlay pages.
6. **Old-school CSS.** Tables and explicitly sized `<img width= height=>`. No flexbox, no
   `object-fit`, no percentage-padding aspect tricks on the bar.
7. **Small images.** 18 full-size PNGs came to nearly 6MB. Thumbnails brought it to ~540KB.

Tests enforce points 3, 4 and 7. The resource cards and `weekly.html` are **generated by the
server** (`renderResourceCardPage` / `renderWeeklyPage`) precisely so point 3 can't regress.

**Debugging a layer that doesn't show:** the decisive test is to point a *known-working* layer
(e.g. `ticker.html`) at the suspect URL. If it renders there, the page is fine and that layer is
broken — delete and rebuild it. If it goes blank, the page is at fault.

## The pieces

| Overlay | URL | Resets? |
| --- | --- | --- |
| Ticker banner | `/ticker.html` | n/a (text set on the dashboard) |
| Resource cards | `/gold-ore.html` etc. | Amber & Essence never; rest each login |
| Weekly Accomplishments — 21 goals, 11 automatic | `/weekly.html` · `/weekly-wide.html` | Monday 04:00 UTC (Palia's reset) |

*(Plush Bar / Total Bug / Plush Hunt overlays removed 2026-08-29.)*

## Files

| Path | Purpose |
| --- | --- |
| `server.js` | Everything. One file, no dependencies. |
| `control.html` | The private Chrome dashboard |
| `overlay.html` | Read-only Meld layer scaffold (skin wiring still pending) |
| `ticker.html` / `weekly.html` | Server-rendered overlay pages — the reference pattern |
| `config/resource-trackers.json` | Cards: tokens, modes, value boxes |
| `config/weekly-accomplishments.json` | The 21 weekly items and the week anchor |
| `config/tracker-skin-standard.json` | The 2048×768 skin standard |
| `data/*.json` | **THE REAL NUMBERS. Back these up.** |
| `data/overlay-requests.json` | Diagnostic log of who asked for which overlay page |
| `assets/resources/` | Resource card artwork |
| `test/e2e.js` | The whole safety net |

**Config owns definitions, state owns progress.** They are merged on load, so a token can be
corrected without wiping a live count, and a new card appears without deleting the state file.

## API

`/api/health` · `/api/state` · `/api/live` · `/api/live/reconcile` · `/api/live/(amber|essence|sweetLeaf)`
`/api/settings` · `/api/actions` · `/api/diagnostics` · `/api/tracker-skin-standard`
`/api/layout` · `/api/ticker` · `/api/todos`
`/api/resource-trackers` (+ `/reset-session`, `/undo-reset`, `/<id>/(adjust|set|visible)`)
`/api/weekly` (+ `/reset`, `/undo-reset`, `/<id>/toggle`)

Live push over SSE at `/events?role=control|overlay`. Events: `live`, `settings`, `action`,
`resourcetrackers`, `weekly`, `todos`. (`/api/weekly/<id>/toggle` is matched by regex.)

*(The `/api/plush-hunt*` and `/api/plush-bar*` routes and the `plush*` SSE events were removed
2026-08-29.)*

---
---

# PART 4 — RECIPES

## Add a resource tracker

1. **Get the token from a real log.** Have Baby pick the item up, then search her log:
   `grep -E "\b(Inventory|Lockbox) (gained|lost):" app-*.log | grep -i <thing>`
   Take the exact token. Watch for the Gold Ore trap — check you have the *item*, not a currency or
   a decor item that happens to share a word.
2. Put the artwork in `assets/resources/`.
3. **Measure the value box.** Detect the largest dark (`luminance < 70`), locally flat
   (5px-window std < 6), fully opaque connected region; convert to percentages of the image. Then
   **draw the rectangle on the card and look at it** before trusting it.
4. Add an entry to `config/resource-trackers.json`: `id` (kebab-case, becomes the URL), `name`,
   `image`, `tokens` (an array — several tokens sum into one card, like Meat), `mode`
   (`session` or `lifetime`), `valueBox`.
5. Run `npm.cmd run test:e2e`. The tests check the token shape, that the artwork exists, that the
   box is inside the image, that no two cards claim the same token, and that the page ships its
   `<img>` in the HTML.
6. Screenshot the page and confirm the number sits inside the box.
7. The Meld URL is `http://127.0.0.1:8790/<id>.html`, 620 × 280.

## Add a whole new overlay layer

Generate it server-side like `renderResourceCardPage` / `renderWeeklyPage`, or copy the shape of
`ticker.html`. Obey all seven rules in "The overlay pattern that works in Meld" above. Add an
assertion that the script stays ES5.

## Diagnose "I can't see it on stream"

1. **Is the new server actually running?** Compare `server.js`'s modified time against the boot
   time implied by the `data/*.json` write times. Deploying a file is not restarting the server —
   this exact confusion cost a round trip.
2. **Read `data/overlay-requests.json`.** It shows every request for an overlay page with its
   user-agent. No entry means Meld never asked — the fault is the layer's configuration, not the
   page.
3. **Open the URL in Chrome.** Renders there → Meld's problem. Blank there → the page's problem.
4. **Point a known-working layer (e.g. `ticker.html`) at the suspect URL.** Renders → that layer
   was broken; delete and rebuild it.
5. Only after all that, suspect the page itself.

---
---

# PART 5 — THE HISTORY, SO IT ISN'T REPEATED

Every one of these was a real failure that cost real time.

| What happened | Root cause | Fix / lesson |
| --- | --- | --- |
| Totals wildly inflated | Parser counted `Primary` resync dumps | Only `Inventory`/`Lockbox` count. **The original break.** |
| Pickups silently missed | `(1*)` quality marker broke the quantity regex | Optional non-capturing group |
| Tests passed while broken | Synthetic fixture didn't resemble a real log | Test against real log lines |
| Duplicate plush names | Auto-namer produced two "Tier Cearnukhighlands" | Rewrote namer; 132 unique |
| Creature matcher missed Rockhopper and Frogbert | Bug token `hopperflame` ≠ plush `rockhopper` | **Discarded the matcher** rather than ship a guess |
| "NO PLUSH YET" spilled out of its box | `padding-top:26%` — CSS % padding resolves against **width**, not height | Grid rows + `overflow:hidden`, plus a geometry assertion |
| Giant number floating loose on the scene | Missing image left the number with no card | Self-contained fallback card |
| Changes had no effect | Old server still running on 8790 | `restart-icb-clean.bat`, which kills the port holder first and polls before saying READY |
| URLs changed to port 8787 | Meld's assistant "fixed" them | 8787 is forbidden. Say so explicitly in any Meld prompt. |
| Whole overlay blank | `??` (ES2020) killed the script | ES5 only, enforced by test |
| Overlay rendered nothing | Mangled query string matched no tracker | Guard that displays "TRACKER NAME NOT RECOGNISED" |
| Screenshot showed fake numbers | Test data sent unlabelled | Label test data, or don't send it |
| Plush bar blank in Meld while Chrome was fine | Images built in JS after a fetch; ~6MB payload; modern CSS | Server-render the HTML, thumbnails, table layout |
| Bar wrapped to 3 rows | Inline-block margin is `gap × N`, not `gap × (N−1)`; borders sit outside the width attribute | Budget the full cell: image + borders + gap |
| Tiles ballooned with few plushies | No maximum tile size | `TILE_MAX`, enforced by test |
| Bar looked washed out | Heavy greyscale on unfound items, designed for cut-out icons but applied to full scene art | Gentle dimming instead |
| Test failed mysteriously | A leftover dev server was squatting on the test port | Kill stray servers before blaming the code |

## Still open

- The two cooking rules in the weekly tracker are `verified: false` until Baby cooks three dishes
  back to back and the log is read — a dish pulled from storage currently looks identical to a
  cooked one. See `ICB-WEEKLY-ACCOMPLISHMENTS.md`.
- Gathering boards and quest boards are **designed but not built** — see
  `ICB-TRACKER-SYSTEM-DESIGN.md`. The quest board rule Baby stated: a board is automatic **only** if
  its profile name is one of her own characters; everything else is manual, permanently.
- **No version control.** Nothing is in git, so a clobbered file has no history. Worth fixing.
- 10 resource cards still exist at the wrong canvas size (1672×941 instead of 2048×768) from the
  older skin standard.

## Facts about Palia's logs, learned the hard way

- **Quests are invisible.** `WeeklyWantsUpdatedEvent fired` is the whole line — never which want,
  never whether it completed. Same for gifts, skills and relationships: the log announces that
  something changed and never says what.
- **One action is one line.** A felled tree is ONE `Inventory gained:` line carrying 14–22 wood; a
  kill is one line carrying meat and a hide; a node is one line carrying several ore. So goals
  counted in *trees* or *nodes* or *creatures* must count **lines**, not quantities. This single
  observation is what made half the weekly accomplishments automatable.
- **`(1*)` is the star-quality flag.** Only 4.6% of pickups carry it and 65 tokens appear both with
  and without — the same item, sometimes starred. `(1*)` is the only value that ever appears.
- **Rarity is not in every token.** Fish carry `_uncommon`; many item families do not. Any
  rarity rule for those is guesswork.
- **Crafting logs a bare number.** `Crafted recipe 7342: 89 -> 90 (+1)` — a lifetime count per
  recipe with no name and no rarity, so furniture goals cannot be automated.
- **Home Tours leave no trace whatsoever.**
- **No character or account identity appears anywhere in the logs.** This is why quest boards for
  other players, and any "with Friends" goal, must be fully manual.
- Spending is **not** logged reliably. Across every log there is exactly one Amber loss and zero
  Essence losses, while Essence demonstrably fell from 1,505 to 69. A lifetime counter therefore
  **drifts upward**. This cannot be engineered around — hence the "set exact value" reconciliation
  control for Amber and Essence.
