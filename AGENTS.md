# ICB Clean

**Read [`docs/ICB-MASTER-HANDBOOK.md`](docs/ICB-MASTER-HANDBOOK.md) first**, then
[`CLAUDE.md`](CLAUDE.md). The handbook is the complete record: the method, the failures and their
root causes, and the recipes for adding trackers.

---

**Read [`CLAUDE.md`](CLAUDE.md) first.** It holds the standing decisions for this project and is
the canonical onboarding file for any AI session (Claude, Codex, ChatGPT, or otherwise). This file
exists only so agents that look for `AGENTS.md` by convention still find their way there.

The three things most likely to be got wrong by a fresh session:

1. **Tracker skin standard is 2048 × 768, 8:3** — always. Never ask Baby the size again.
   Spec: `docs/ICB-TRACKER-SKIN-STANDARD.md` · Source of truth: `config/tracker-skin-standard.json`
2. **Never bake the tracker number into skin artwork.** The value box stays blank; ICB renders
   the live value on top at runtime.
3. **One server, port 8790, Meld gets `overlay.html` only.** Never port 8787, never a second
   server, never the dashboard in Meld.

Verify work with `npm run test:e2e`. The skin standard is asserted there — if you change it, the
build fails, and that is deliberate.
