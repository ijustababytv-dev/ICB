# Weekly Accomplishments

Baby's 21 repeating weekly goals, grouped exactly as they appear in game. **11 tick themselves off
the log; 10 are manual.** Meld layer:

| Layout | URL | Layer size |
| --- | --- | --- |
| One column | `http://127.0.0.1:8790/weekly.html` | 480 × 980 |
| Two columns | `http://127.0.0.1:8790/weekly-wide.html` | 900 × 520 |

**Two plain addresses, no query string.** Query strings are barred from Meld URLs — the one overlay
that ever used them never rendered. That was never proved to be the cause, but a live stream is the
wrong place to test the theory, so the wide layout gets its own path instead.

`?cols=` `?w=` `?panel=0` still work for previewing in Chrome. Baby ticks items on the dashboard by clicking a row.

## The week

Rolls over at **Monday 04:00 UTC** — Palia's own weekly reset. That is **Sunday 11 PM Central in
summer, 10 PM in winter**. It is anchored to UTC on purpose so daylight saving cannot drift it by an
hour twice a year, and the rollover is checked on a timer so it happens on a quiet night and catches
up if the server was off across the boundary.

**The reset is undoable**, like every other reset in ICB.

## What is automatic, and why

Established by reading 30 of Baby's real logs on 2026-08-19. **Do not re-litigate these without new
log evidence.**

The governing rule: **if it is measured by items arriving in her bag, it can be automatic. If it is
measured by an activity happening, it cannot.**

> Bug-catching items (Catch 30 Bugs, Catch 10 Uncommon Bugs, Catch 10 Bugs with Friends) were
> removed 2026-08-29 when the plushie/bug trackers were torn out. The rows below are what remains.

| # | Accomplishment | How |
| --- | --- | --- |
| ✅ | Gather 30 Forageables | sums `^itemtype_forage_` |
| ✅ | Chop Down 10 Trees | counts **lines** carrying `^itemtype_wood_` |
| ✅ | Chop Down 10 Magical Trees | counts lines carrying `itemtype_wood_magicwood` |
| ✅ | Harvest 30 Crops | sums `^itemtype_crop_` |
| ✅ | Harvest 10 Star Quality Crops | sums `^itemtype_crop_` carrying `(1*)` |
| ✅ | Use Fertilizer 30 Times | sums `^itemtype_fertilizer_` **lost** — using it removes it |
| ✅ | Hunt 30 Creatures | counts lines carrying `itemtype_material_hide` |
| ✅ | Mine 20 Nodes | counts lines carrying `^itemtype_mineral_(ore\|rock)_` |
| ✅ | Mine 10 Silver or Gold Ore | sums the two ore tokens |
| ⚠️ | Cook 10 Meals | counts lines carrying `^itemtype_c_` — **unverified** |
| ⚠️ | Cook 3 Star Quality Meals | same, `(1*)` only — **unverified** |

### Items vs events — the thing that makes half of these work

**One felled tree is ONE log line carrying 14–22 wood.** One kill is one line carrying meat and a
hide. One node is one line carrying several ore. So an accomplishment counted in *trees* or *nodes*
or *creatures* must count **log lines**, not quantities — counting quantities would score 21 trees
from a single chop.

That is what `mode: "events"` means. `mode: "items"` sums quantities, for goals genuinely counted in
items ("gather 30 forageables"). A test fails the build if `trees-10` is switched to `items`.

### The `(1*)` star flag

`(1*)` is confirmed to be Palia's star-quality marker: only **4.6%** of pickups carry it, and **65
tokens appear in the logs both with and without it** — the same item, sometimes starred. `(1*)` is
the only value that ever appears. `starOnly: true` counts starred pickups only.

### The two unverified rules

Cooking counts finished dishes arriving in the inventory. **A dish pulled out of storage or received
as a gift looks identical**, so these two can over-count. There is a cleaner signal —
`Crafted recipe 7342: 89 -> 90 (+1)`, a lifetime count per recipe, immune to storage moves — but it
appears only 78 times across all logs and uses numeric IDs with no names.

**The test:** Baby cooks three dishes back to back, two of the same recipe. Reading the log
afterwards settles whether the craft line fires reliably and whether recipe IDs can be mapped to
dishes by watching what arrives next. Until then these two carry `verified: false` and the dashboard
badges them **AUTO?** instead of **AUTO**.

## What cannot be automatic

| Accomplishment | Why not |
| --- | --- |
| The **With Friends** quests | **The log never names or counts another player.** Zero hits for party/teammate/group across every log file. Party loot arrives as ordinary pickups with no attribution. |
| All three **Furniture Making** | Crafting logs as `Crafted recipe 7342` — a numeric ID, no name, no rarity. |
| Hunt 5 Magical Creatures | Nothing marks a creature as magical. The only `magic` token anywhere is `itemtype_wood_magicwood`. |
| Both **Home Tours** | Home Tours leave no trace in the log at all. |

Every manual item carries a `whyManual` field, and **a test fails the build if one is missing** —
so a later session cannot quietly "improve" a manual item into a guessed automatic one.

## Baby can always override

Clicking any row on the dashboard ticks it, automatic ones included. The log can be wrong or miss a
session; Baby is the authority. Ticking an automatic item sets its counter to the target; clicking
again clears it.

## Files

| Path | What |
| --- | --- |
| `config/weekly-accomplishments.json` | The 21 items, their rules, and the week anchor |
| `data/weekly-accomplishments.json` | Ticks and counts for the current week. Back this up. |

Page generated by `renderWeeklyPage` in `server.js`, on the same pattern as everything else that
works in Meld: list rendered server-side into the HTML, plain ES5, XHR polling. If the script dies,
the checklist still shows — just frozen.
