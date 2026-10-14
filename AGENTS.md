# ICB Clean

**Read [`docs/ICB-MASTER-HANDBOOK.md`](docs/ICB-MASTER-HANDBOOK.md) first**, then
[`CLAUDE.md`](CLAUDE.md). The handbook is the complete record: the method, the failures and their
root causes, and the recipes for adding trackers.

**Always read [`RULES.md`](RULES.md) before creating or editing any code. This is required.**
Follow it to determine how code must be written, edited, documented, and maintained, including
recording completed work in `UPDATES.md`.

---

[`CLAUDE.md`](CLAUDE.md) holds the standing decisions for this project and is the canonical
onboarding file for any AI session (Claude, Codex, ChatGPT, or otherwise). Agents that discover
`AGENTS.md` must follow the reading order above and the requirements in this file.

The three things most likely to be got wrong by a fresh session:

1. **Tracker skin standard is 2048 × 768, 8:3** — always. Never ask Baby the size again.
   Spec: `docs/ICB-TRACKER-SKIN-STANDARD.md` · Source of truth: `config/tracker-skin-standard.json`
2. **Never bake the tracker number into skin artwork.** The value box stays blank; ICB renders
   the live value on top at runtime.
3. **One server, port 8790, Meld gets `overlay.html` only.** Never port 8787, never a second
   server, never the dashboard in Meld.

**Always write unit tests for each business rule.** Cover the expected behavior and relevant edge
cases, and update those tests whenever the rule changes.

**Run tests after making any changes**, including code, configuration, and documentation changes.
Run the relevant unit tests and `npm run test:e2e`, and report any failures. The skin standard is
asserted in the end-to-end suite — if you change it, the build fails, and that is deliberate.

**Commit and push all pending project changes to GitHub whenever it makes logical sense**, such
as after completing a coherent task or fix, and **at least once per day when there are changes**.
Include all project work while respecting `.gitignore` and the prohibition on committing secrets
in `RULES.md`.
