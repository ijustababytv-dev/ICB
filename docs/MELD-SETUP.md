# Startup order

1. **ICB server** — run `restart-icb-clean.bat` (kills any old server on 8790 first, waits for
   `/api/health`, then opens the dashboard in Chrome).
2. **Palia Assistant** — must be running or nothing is written to a log at all.
3. **Palia** — Palia Assistant waits for the game, so before or after is fine.
4. **Meld** — any time. Layers reconnect on their own after a server restart.

The reader jumps to the END of the log when it starts — it never replays history — so anything
that happened while the server was down is invisible to it permanently. Use the dashboard's
**Correct** / **+ / −** controls to fix a total by hand if you need to.

Palia Assistant writes a fresh log each day. When a new one appears the server switches to it
within a second, so an odd startup order corrects itself.

---

# Adding the trackers to Meld Studio

Server must be running first: `start-icb-clean.bat`

Add a **Browser / Web** layer per overlay, set its width/height to the size in the table, and
**paste the URL exactly — no query string** (a plain per-page path is the only thing Meld has been
proven to render here).

| Layer | URL | Layer size |
| --- | --- | --- |
| Ticker banner | `http://127.0.0.1:8790/ticker.html` | 900 × 506 |
| Weekly Accomplishments (tall) | `http://127.0.0.1:8790/weekly.html` | 480 × 980 |
| Weekly Accomplishments (wide) | `http://127.0.0.1:8790/weekly-wide.html` | 900 × 520 |
| Resource card (one per resource) | `http://127.0.0.1:8790/<card-id>.html` | per card |

Each resource card has its own plain path — `/amber-echo.html`, `/gold-ore.html`, and so on. The
address for every card is shown under its name in the **Resource Trackers** panel on the
dashboard. Add `?w=` to any of these pages to resize; the layer size scales with it.

All of these pages use the same deliberately plain pattern — plain ES5, XHR polling, no
EventSource, artwork already in the HTML the server sends. If a new layer refuses to render in
Meld, point a known-working layer (e.g. `ticker.html`) at the suspect URL: if it renders there,
the layer was misconfigured; if it does not, the page broke the pattern.

## Never in Meld

`control.html` is your private dashboard. Keep it in Chrome only.
