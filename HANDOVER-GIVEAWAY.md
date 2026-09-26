# ICB Fluffy Unicorn Giveaway — Handover for the next developer

Owner: Baby (Twitch streamer "IJustABabyTv"). Project folder on her PC:
`C:\Users\mrsch\Documents\GitHub\ICB\` (ICB = "IJUSTABABY Control Bridge").
Everything below describes the code **as it is on disk right now** (2026-09-25). Read this whole file
before changing anything.

---

## 1. What ICB is

- A **single Node.js server, `server.js`, with ZERO npm dependencies** (plain `http`, `fs`, `path`).
  Runs on `http://127.0.0.1:8790`. Started/restarted with `restart-icb-clean.bat`.
- It serves static pages from the folder root (plus `assets/...`) and a JSON API under `/api/...`.
- Live updates to dashboards go over **Server-Sent Events** at `/events` (event name `giveaway`).
- Data is saved as JSON in `data/` (giveaway state: `data/giveaway.json`; nightly logs:
  `data/activity/YYYY-MM-DD.jsonl`).
- ICB also runs many other Palia trackers — **don't touch unrelated sections of server.js.**

### House rules (Baby's conventions — keep them)
1. **Meld overlay pages must be plain ES5** (no `=>`, `let`, `const`, template strings, `fetch`).
   Use `var`, `function`, `XMLHttpRequest`. Dashboards opened in normal Chrome may use modern JS.
2. **No query strings in Meld layer URLs.** Each overlay is its own plain URL.
3. **Never guess an event/field name** — verify against real data or Meld's own `firehose.js`.
4. A `server.js` change needs an ICB restart; HTML-only changes need only a page/layer reload.
5. Test before shipping. After editing, run `node -c server.js` and syntax-check page scripts.

---

## 2. The giveaway — pages and URLs

| Page | Where it runs | Purpose |
|---|---|---|
| `giveaway-listener.html` | Meld layer (invisible) | Loads Meld's Firehose SDK and relays events to ICB. **Must be in the live scene.** |
| `unicorn-jar.html` | Meld layer, full screen 1920×1080 | Physics jar of fluffy unicorns + the lottery drawing show + song |
| `giveaway-entrants.html` | Meld layer | Top-N entrants board |
| `giveaway-winners.html` | Meld layer | "Winners Circle" board |
| `giveaway-control.html` | Normal Chrome tab | Baby's dashboard (draws, give unicorns, rates, block list, board text, listener status light) |
| `giveaway-report.html` | Normal Chrome tab | Nightly activity report: print / PDF / CSV |

All at `http://127.0.0.1:8790/<page>`.
Libraries/assets: `matter.min.js` (Matter.js 0.20.0 physics, local copy);
`assets/resources/JAR_BACK.png`, `JAR_FRONT.png`, `CLOUD_01.png`, `RAINBOW_01.png`, `STAR_PINK/BLUE/YELLOW.png`,
`UNICORN_COIN112.png` (the unicorn; also inlined as base64 in the pages),
`Pink Fluffy Unicorns Dancing on Rainbows (Trap Remix).mp3` (drawing song).

---

## 3. Meld Firehose facts (verified by reading Meld's `firehose.js` v2)

SDK: `https://elements.meldstudio.co/cdn/v2/firehose.js` → `new Firehose()`, `.on(type, fn)`, `.on('*', fn)`
(catch-all gives `{type, event}`), instance property `socketOpen`. It connects to Meld at
`ws://127.0.0.1:44423/events` using a token Meld gives its own layers (so it only works inside Meld).

- `chat` = raw RICH_MESSAGE. Sender: `msg.sender.displayname`. **Cheers/bits are inside chat**:
  `msg.donations[]` items `{type:'TWITCH_BITS', amount, count}`; Meld ignores them when
  `msg.attributes` contains `HIGHLIGHTED` or `ANNOUNCEMENT` (we do too). Super Chats etc. are other
  `donations` types (`YOUTUBE_SUPER_CHAT`, `FOURTHWALL_DONATION`, `KICK_KICKS`, `TIKTOK_COINS`).
- `sub` = new sub / RESUB only (NOT gifted). `subscriber.displayname`, `sub_type`, `sub_level`,
  `months_purchased` (1 normally).
- `gifts` = Meld bundles gifted subs: `{gifter, anonymous, count, recipients[], sub_level}`.
- `follow` `{follower}`, `raid` `{host, viewers}`, `viewer_count` `{count}`, `viewer_list`,
  `stream_status`, `purchase` (shop purchases, NOT bits), `meld.scene_change`, `stt`, etc.
- On connect Meld may replay history (`x_history`, `catchup`) — skip those.
- **Channel-point redemptions are NOT delivered by Firehose.** Twitch also never exposes viewers'
  channel-point balances to any app.

Demo/test trick: you can run a fake Meld websocket on 127.0.0.1:44423 that sends events shaped as above
and load the real listener page with the CDN script routed to a local copy (we did this with
Playwright + Python `websockets`).

---

## 4. Giveaway rules & data model (server.js, section "STREAM GIVEAWAY")

`giveaway` object (saved in `data/giveaway.json`):
- `entrants[username]` = `{ username, counts:{chatWindows, subMonths, giftedSubs, bits}, chatTickets,
  subTickets, giftTickets, bitsTickets, manualTickets, note, mysteryOutfitWon, lastSeenAt }`.
  **`counts` are the truth**; the `*Tickets` fields are derived by `recomputeEntrant()` from `rates`.
  `manualTickets` = hand-given bonus (may be negative to correct, total never < 0).
  Total unicorns = sum of the five `*Tickets` (`entrantTotal()`).
- `rates` = `{chatWindow:1, subMonth:2, giftedSub:4, bitsPerUnicorn:100}` (editable; re-prices everyone).
- Chat: every 10 min (`CHAT_WINDOW_MS`) anyone who chatted gets `chatWindow` unicorns (not per message).
- Sub: +`months_purchased` months. Gifts: gifter +count (receivers get nothing — Baby's choice).
  Bits accumulate (60+50 = 110 → 1 unicorn).
- `blocked[]` — Baby + bots (IJustABabyTv, StreamDatabase, Nightbot, StreamElements, …, Anonymous).
  Case-insensitive; blocked names are purged, can't earn, can't be drawn, can't be given unicorns.
- `winners[]` `{username, prize:'plushie'|'mystery-outfit', tickets, at}`. Plushie winners can win again;
  Mystery Outfit winners are excluded from future Mystery Outfit draws (flag `mysteryOutfitWon`).
- **Everything rolls over between streams**; only "Reset everything" (`/api/giveaway/reset`) clears
  entrants/winners. Reset keeps `display`, `rates`, `blocked`.
- `jarBaseline` — the on-screen jar starts empty each stream day (6 AM local cutoff) while counts roll
  over. `jarView()` = per-person total − snapshot total. "Empty the jar" button snapshots now.
- `display` — board wording + `jarSide`, `unicornSize`, `showNames` (false), `magic` (true).
- `manualLog[]` — hand-given history.
- Names are matched case-insensitively (`findEntrantKey`).

### API (all JSON)
- `GET /api/giveaway/state` → `{ok, giveaway}` (also includes `listener` status and `jar` view)
- `POST /api/giveaway/event` `{type: chat|sub|gifts|bits|follow|raid, username, months?, count?, amount?, tier?, subType?, recipients?}`
- `POST /api/giveaway/manual` `{usernames[], kind: unicorns|subMonths|giftedSubs|bits, amount(±), reason}`
- `POST /api/giveaway/draw` `{prize:'plushie'|'mystery-outfit'}` → weighted random winner (server-side, fair)
- `POST /api/giveaway/reset`, `/rates`, `/display`, `/display/reset`, `/blocked {names}`, `/note {username,note}`,
  `/jar/empty`, `/listener` (heartbeat from the listener every 5 s)
- `POST /api/activity/raw {kind,data}` (listener catch-all), `GET /api/activity/nights`,
  `GET /api/activity/night?date=YYYY-MM-DD`
- SSE: `/events` → event `giveaway` with the same object as state.

### Nightly log (`data/activity/<night>.jsonl`, one JSON per line, night = 6 AM→6 AM)
Types: `chat, follow, raid, sub, gifts, bits, chat_unicorns, manual, winner, reset, jar_emptied, raw`.

---

## 5. unicorn-jar.html (the show) — how it works

- Matter.js world: floor, side walls, ceiling just above screen; the jar is a static compound body whose
  walls follow the jar art (measured in the 1024×1536 art's pixels, see `init()` → `seg(...)`).
- Draw order: jar back → unicorns → jar front (+30% back sheen) → sparks → winner → cloud → countdown → banner → confetti.
- Unicorn bodies carry `owner`. `applyState()` reconciles bodies with `g.jar.counts` (this stream only).
- Idle drops come out of the cloud; overflow piles across the bottom; stars + little rainbows are accents (half unicorn size).
- **Drawing** (triggered when `giveaway.winners` grows): `rain` 6 s (jar tips, cloud rains everyone's
  FULL rolled-over unicorns) → `mix` 5 s (swirl wind, low gravity) → `countdown` 10 s → `rise` (winner
  unicorn + banner, song fades) → `gather` (extras fly back to cloud) → `upright` → `refill` → idle.
  Reveal ≈ 23 s after the click; Winners Circle hides new winners for 25 s; dashboard toast counts down.
- Sound: `drawAudio` = the MP3 above, starts with the rain, loops, fades after the banner.
  Baby must make sure the jar layer's audio isn't muted in Meld.
- Test hook: `window.__jar.state()`.

---

## 6. NEXT FEATURE TO BUILD: "Plushie Gamble" (agreed with Baby, not started)

Viewers spend fluffy unicorns in chat to gamble for a Palia plushie/pod. Instead of unicorns, **prize
images rain from the cloud**, the same lottery mix + 10 s countdown runs, and one prize is revealed.

Decisions already made:
- **Chat commands, paid with fluffy unicorns** (not channel points): `!plushie common|uncommon|rare|epic|legendary`
  and aliases `!common !uncommon !rare !epic !legendary`. **Viewer picks the rarity**; the prize inside
  that tier is random.
- **Prices** (editable on dashboard): Common 10, Uncommon 20, Rare 40, Epic 75, Legendary 150.
  Check against the viewer's FULL rolled-over total; subtract via a new `spent` counter shown in the
  breakdown; never below 0; blocked names can't gamble.
- **Prizes from Airtable** base "Kingdom Command Center" `app3zJZjkXqz9nCDe`, table **Prize Vault**
  `tbloRHQosTh5lwJHH`: Prize Name `fldoZgTui6YTBf6vb`, Image `fldKWWdSBI7e3k6ZW` (attachments,
  128×128 webp), Type `fldUGu3b7Ih0fyscf` (Plushie/Pod), Active `fldP90kjKzmE3bUHQ`, Card ID
  `fldmnuEKvPKCKUjIC`, **Rarity `fldt1SA2XK4drWXDr`** (number: 1 Common, 2 Uncommon, 3 Rare, 4 Epic,
  5 Legendary; **blank = Common**). ~186 active prizes, all with images.
- **New prizes join automatically:** sync the Prize Vault every few minutes + a "Sync prizes now"
  button. Pool = Active + has Image. **Download and cache images locally** (Airtable attachment URLs
  expire after ~2 h), e.g. `assets/prizes/<recordId>.webp`.
- Each win → create a **Work Order** in `tbl9RwbVlTtk0p5N6` (fields: Order, Player (link), Prize (link),
  Winner Name, Platform, Palia IGN, Prize Name, Source (select: Pull/Round/Manual — add "Gamble"),
  Round #, Status = Pending, Won At, Notes) and link/create the viewer in **Players** `tbl3xTZYcTk5Whx2S`.
- Airtable access: Baby creates a Personal Access Token (read Prize Vault, write Work Orders + Players).
  Store it in `data/secrets.json` (gitignored) — never in page code. Use Node's built-in `https`.

Build steps:
1. Listener: send the chat **message text** with `type:'chat'` (currently only username is sent).
2. server.js: prize sync + image cache; gamble settings (prices, on/off); parse commands in the chat
   event handler; balance check; subtract; pick a random prize in the tier server-side; queue a show
   (one at a time, queued after drawings); write the Work Order; log `gamble` to the activity log.
3. Expose pending gamble shows in the state payload (e.g. `giveaway.gambles[]` like `winners[]`).
4. unicorn-jar.html: new show type reusing rain → mix → countdown → reveal, raining prize images of
   that tier (repeat images if the tier is small), reveal the prize big with rarity colour/label and
   "@name won <Prize>!". Hold the result on dashboard/boards until the reveal.
5. Dashboard: prices per tier, on/off, sync status (count per tier, last sync, missing images),
   recent gambles, a manual "run gamble for <name>/<tier>" test button. Report: "Plushie gambles" section.
6. Rehearse with a fake Meld (chat commands) before shipping.

Still to ask Baby: can the same prize be won repeatedly (unlimited stock?) and is there a
per-viewer gamble limit per stream?

---

## 7. Known facts / cautions
- ~30 old Work Orders in Airtable from July are still "Pending" (maybe undelivered prizes) — tell Baby.
- "FrostyTools" may be a bot account (won a plushie last stream) — Baby's call to block it.
- Firehose's `sub` behaviour on real Twitch events is inferred from Meld's code; worth watching live.
- The jar page caps drawn unicorns at 900 (extras still count).
- Don't store secrets in overlay pages; don't add npm dependencies to ICB.
- A detailed build log is in Baby's Claude project doc `claude/icb-stream-giveaway.md`.
