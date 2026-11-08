# Required tracker release checklist

Every contributor and AI, including Claude, must complete this checklist for a
new tracker. Follow [AGENTS.md](../AGENTS.md) and [RULES.md](../RULES.md) first.
Adding a configuration entry and pushing Git is only part of the work.

## Why both local and cloud delivery are required

`local-server/config/resource-trackers.json` supplies local rendering/input
definitions and is bundled by `cloud-server/tools/build.py` into the Lambda ZIP
as `config/resource-trackers.json`. Lambda owns counting rules. PostgreSQL stores
owner progress and settings, not the deployed catalog of tracker definitions.

A local restart does not update Lambda. Editing PostgreSQL does not update Lambda.
A cloud release does not refresh the local Node process or deliver local artwork.
Navigation is also separate: `ui/js/navigation/catalog-trackers.js` supplies search
and All Pages. Missing that entry makes a configured tracker hard to find.

The local page renderer can show artwork before the cloud knows a new card, but
its value stays unconfirmed. A visible page alone does not prove counting works.

## Complete every step

1. [ ] Inspect current Git changes, recent commits and required root documents.
   Preserve other contributors' work. Run baseline unit/E2E tests and
   `backup-icb-clean-state.bat` before changing server code.
2. [ ] Confirm the exact item token against a real Palia Assistant log. Record
   the evidence without committing private logs. If no real event is available,
   explicitly mark live cooking verification pending; synthetic tests are not proof.
3. [ ] Add the focused tracker definition, appropriate inventory/direction filters,
   starting stock and count-per-event rule. Keep progress in the cloud. Test batch
   sizes, star quality, losses, unrelated tokens, resyncs and the zero floor.
4. [ ] Install the original artwork at the exact configured local path. If missing,
   immediately attempt Cloudinary lookup/download using
   [the image workflow](CLOUDINARY.md#required-contributor-workflow).
   New artwork follows the 2048 x 768 standard, transparent corners and blank value
   box. Preserve established supplied artwork; do not stretch or crop it to conceal
   a size mismatch. Measure its own value box and report any unresolved mismatch.
5. [ ] Add its navigation entry with a clear label, category and searchable aliases.
   Verify search, All Pages and the Tracker Command Center, not just a direct URL.
6. [ ] Run `npm.cmd run images:plan` and `npm.cmd run images:sync` for new/changed
   artwork. Repeat the plan to confirm identical remote contents. Ignored images
   do not travel through Git; download them on each target PC.
7. [ ] Run `npm.cmd run test:unit`, `npm.cmd run test:e2e`,
   `npm.cmd run check:structure` and `npm.cmd run format:check`.
   Run `npm.cmd run test:browser` after browser changes. Inspect the overlay in
   separate headless Chromium with temporary state, including static artwork with
   JavaScript disabled, number placement, and Meld-compatible ES5 polling.
8. [ ] Build and release the cloud package through the documented procedure in
   [AWS operations](../terraform/AWS.md#deployments-and-recovery) and
   [Step 2 operations](STEP2-OPERATIONS.md#sql-source-and-release).
   Use `./cloud-server/tools/release.ps1 -EnableWorker -Apply` after checks.
   Renew expired AWS access with `aws login --profile Vox`. Verify the deployed
   package contains the card; a local ZIP or Git push is not deployment evidence.
   Do not create an SQL migration or modify totals just to add a configured card.
9. [ ] Activate the updated checkout on the target PC at its normal authorized
   restart. Never interrupt a live server/stream just to verify an edit. Refresh
   the dashboard, sign in, and verify the cloud-backed `/api/resource-trackers`
   includes the card, the artwork URL returns an image and the plain overlay URL
   renders. Confirm a real cook changes the count once, without altering other totals.
10. [ ] Update UPDATES.md (three sections, last seven days), operating docs and the
    ignored per-step checklist. Commit and push the coherent change after checks.
    Report exactly what was deployed, tested and activated. Any missing image,
    failed check, unavailable credentials, pending target-PC restart or unobserved
    real cook remains explicitly pending. Never describe partial rollout as complete.

## Fish Tacos failure to avoid repeating

On 2026-11-08 the first Fish Tacos commit added only the local definition and an
update note. Navigation was added in a second commit. A checkout could still lack
the ignored PNG, and a cloud package built before the addition lacked the card.
An older cloud catalog also made the local page lookup return no card; the renderer
now retains the local artwork definition with an unconfirmed value during rollout.
Each item above checks a separate part of this failure.
