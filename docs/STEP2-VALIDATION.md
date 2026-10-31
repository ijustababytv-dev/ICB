# Step 2 release validation and costs

Verified 2026-10-31 in us-east-1. The local production listener was not started or
restarted. Browser/stream tests used isolated state, port 8791 and temporary
headless Chromium profiles. Runtime data, dumps, measurements, Terraform state,
release metadata and the two logging plans remain private/ignored.

## Release and data

- PostgreSQL upgrade 006 is applied. Fresh creation matches the upgraded catalog:
  **58 tables, 84 indexes**, no application views/routines/sequences/triggers.
  All application objects remain in `icb`; `public` is empty. Original migration
  checksums, data and limited service permissions are preserved.
- API and scheduled ARM64 Node 22 worker are deployed from the same immutable
  package. The runtime ZIP contains no DDL, administrative credentials or data.
  Administrative upgrade SQL is retained separately in versioned private S3.
  The release guard reported no RDS change or resource deletion.
- All **32 owner features** were imported from fresh current source/defaults,
  then compared against SQL hydration field by field. Source hashes, cutover
  UUIDs, acknowledged watermark and protocol/revision boundaries are recorded.
  A repeated completed cutover performs no reimport or transport reset.
- The existing default account/password is preserved. Its 30 Step 1 recovery
  copies, 34 historical reporting days and **30,901 messages** remain intact.
  Quality/partial-day flags were retained. No historical import reran award rules.
- The actual migrated owner's API returned all 32 cloud authorities and **36
  feature views**. A short-lived administrative verification session was removed
  afterward; the account password was not reset.
- A full private dump was restored into a disposable database and **all 58 table
  fingerprints** matched, with migration ownership and limited grants repaired.
  Fresh cloud feature export/fence/resume was exercised; SQL tests additionally
  exercise a fenced feature restore with a new revision/UUID and retained undo.

## Automated and live coverage

**240 PostgreSQL/unit tests passed with no failures or skips.** The full run covers schema recreation/namespace migration and
collision rollback, immutable version pins, limited-role grants, transaction
rollback, account/owner isolation, lost-response retries, changed UUID rejection,
concurrent/stale edits, collector leases/sequences, raw-payload rejection, real
incremental parsing shapes, Primary exclusion, inline quality, startup stocks,
weekly reset/undo, signup attendance/order, weighted draws/recovery, timer/alarm
replacement, Steam first-success baselines and worker/credential fences.

Browser verification passes **29 dashboards/overlays**, including two dirty
operator forms: the second stale save receives 409 without losing newer state.
Existing ES5 and static-artwork assertions are retained. Mocked Terraform checks
pass **17 runs**. Structure, import-cycle, file-size, vendor and formatting guards
remain enabled. Source stays within 500 lines/40 KB per maintained file.

Two late combined-run failures were remote PostgreSQL connection timeouts during
schema setup, rather than failed business assertions. Test files now run
sequentially against the small shared database; explicit concurrent-command,
lease and transaction tests still use concurrent operations. No assertions or
connection validation were removed. Private logs retain the failures and reruns.

The E2E suite completes its feature scenarios (48 routes, 177 browser assets),
then reports the same **nine pre-existing missing original artwork files**:

`poke_bowl.png`, `Apple_Pie.png`, `Pumpkin_Pie.png`, `Meaty_Stir_Fry.png`,
`Akwinduu_Chapaa.png`, `Vampire_Crab.png`, `King_Crab.png`,
`Stripeshell_Snail.png`, `Crab_Dishes.png`.

These failures remain visible; artwork was not fabricated and checks were not
suppressed. The feature migration cannot supply absent original images.

Actual Gateway → ARM Web Adapter → Express → limited-role RDS smoke checks verify
case-insensitive login, independent owners, bootstrap, immutable/stale commands,
privacy rejection, report access and exactly-once typed game inputs. Steady
traffic representing four feed installations succeeds. A deliberate 80-request
burst returned 77 upstream concurrency 503s and three successful responses;
Gateway 429 was not observed in that burst. A separate regression proves both
429 and 503 retain the identical ordered input, back off and remove it only after
the matching committed acknowledgment. Limits remain API 2/pool 1, worker 1/pool 1.

A separate live secret smoke check used a disposable disabled Steam integration
and a generated fixture value. Actual API IAM permissions created/read/versioned
and deleted the owner secret. Stale credential revisions were rejected and an old
PUT retry did not revive the removed key. The fixture secret and account were
removed; Steam was never contacted.

Both real AWS failure paths were observed in the private queue: Scheduler delivery
to a missing target (`ResourceNotFoundException`) and the accepted production
worker handler failing its deliberately refused test DB connection
(`RetriesExhausted`). The verification tool handles qualified Lambda ARNs through
the fixture request identity. Both sets of uniquely named temporary resources
were destroyed; only their own test messages were deleted. No production failure
switch or test payload backdoor exists in the application.

AWS account concurrency is 1,000. PostgreSQL `max_connections` is 79. The sampled
test window peaked at 10 DB connections, below the connection alarm at 40;
RDS CPU peaked at about 8%. Three normal warm runtime connections, or roughly six
during overlapping replacements, leave room for the observed administrative
connections. This is a measured small-stream deployment, not unlimited capacity.

## Local stream measurement

An archived pre-Step-2 checkout (`7b40a50`) and current source each ran for 30
seconds with **600 chat messages, 300 game facts and 300 overlay reads**. Test state
and disposable cloud owners were separate. Both finished with the exact expected
game total, 301 after starting at 1. No local HTTP workload requests failed.

| Measurement | Before | After |
| --- | ---: | ---: |
| Process CPU time / 30 seconds | 750 ms | 906 ms |
| RSS | 66.5 MiB | 85.0 MiB |
| Backend intervals | 15 | 6 |
| Synchronous file writes | 110 | 93 |
| Bytes written | 451,289 | 603,637 |
| Shared feed requests | 0 | 15 |
| Feature input/command requests | 0 | 27 |
| Reporting uploads | 3 | 3 |
| Cloud bytes downloaded | 1,420 | 3,220,650 |

The migration removes local business ownership/timers, rather than claiming a CPU
or memory reduction that this sample does not show. Compact durable transport and
cloud DTOs add CPU, RAM and disk bytes. After CPU is about 3% of one core in this
short sample. Twenty overlay polls still produce one cloud feed per two seconds.
Measurements include active game/chat traffic; idle operation sends fewer writes.

## Monthly estimate

These are estimates for **one installation active 120 hours/month**, before tax,
credits/free allowances, extra backups, surplus CPU credits or unrelated account
usage. They are not a spending cap.

The AWS Price List API returned **$0.016/hour** for PostgreSQL Single-AZ
`db.t4g.micro` and **$0.115/GB-month** for its gp3 storage in us-east-1 on the
verification date: about **$11.68 + $2.30** for 730 hours/20 GB.
See [RDS pricing](https://aws.amazon.com/rds/postgresql/pricing/).
One public IPv4 adds about **$3.65/month** at $0.005/hour.
[VPC pricing](https://aws.amazon.com/vpc/pricing/)

The existing DB secret is $0.40/month, plus API calls. Each configured Steam
owner adds another $0.40 secret and usage. Eleven standard alarms budget about
$1.10/month before applicable free allowances. Allow small S3/logs/secret-call
charges; the steady infrastructure baseline is approximately **$19–20/month**.
[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/),
[CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)

The measured busy workload generated 45 cloud calls/30 seconds: approximately
**5,400/hour**, including 1,800 feed reads. At 120 active hours that is 648,000
API calls. Using $1/million HTTP API calls, $0.20/million Lambda requests and a
conservative 250 ms average at 512 MB ARM yields about **$1.86/month** for API plus
Lambda requests/compute. This duration assumption is conservative relative to
the observed warm end-to-end median around 150 ms; it is not a billed-duration
guarantee. Cold starts and future feature sizes can change the result.
[API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/),
[Lambda pricing](https://aws.amazon.com/lambda/pricing/),
[AWS ARM rate explanation](https://builder.aws.com/content/3KVvIb9GOBUUwLwDHQiiLSgkPZo/you-dont-pay-for-the-wait-lambda-web-functions-for-ai)

At the same observed download rate, response traffic is about **46 GB/month**;
budget roughly **$4.20** at $0.09/GB if no account-wide outbound allowance remains.
Allow **$0.05–0.30** for 43,200 small worker invocations and a few cents for its
logs/queue/secret reads at this scale. Scheduler's 43,200 ticks fit its published
14-million-invocation monthly allowance; without that allowance they are about
$0.043. Steam work and larger payloads add usage.
[API transfer example](https://aws.amazon.com/api-gateway/pricing/),
[Scheduler pricing](https://aws.amazon.com/eventbridge/pricing/)

Plan on roughly **$20–27/month total** for this single busy 120-hour installation,
depending on remaining free allowances and Steam configuration. More installations
add request/transfer/secret costs and DB work. The deployed **$30 account-wide
budget** includes unrelated AWS spend, is visible in the console, sends no email,
and does not automatically stop resources. Recheck measured duration, transfer,
credits, storage growth and alarms after real streams before increasing limits.
