# AWS operations and credentials

Updated 2026-11-08. This is the operator guide for ICB's AWS setup.
Command examples and plain file paths below are relative to the repository root.
Terraform under [terraform/](README.md) defines infrastructure;
[database/](../database/README.md) holds SQL object definitions and recovery tools.
Do not put credential values in this document.

## Replace the Steam API key

Use ICB's Steam dashboard. No Terraform apply, Lambda deployment or local server
restart is needed to change the key.

1. Start ICB normally if it is not already running. Open
   [Cloud account](http://127.0.0.1:8790/cloud.html) and sign into the ICB account
   whose Steam integration you want to update.
2. Open [Steam Achievements](http://127.0.0.1:8790/steam-control.html).
3. Paste the replacement **32-character Steam Web API key** into **Steam API key**
   under **1 · Connect to Steam**. This is an API key, not your Steam password.
   Keep **Game** unchanged. Leave the **Steam profile** input blank to retain
   the saved profile; only enter a profile when deliberately changing accounts.
4. Click **Save & check now**. The key input clears after a successful save;
   subsequent reads show a saved/configured indicator, not the key itself.
5. Make sure **Checking Steam is on** is enabled under **2 · On stream**. If you
   change that switch, click that section's **Save** button.
6. Keep ICB running and signed in. Allow roughly one to two minutes for the
   scheduled worker, then confirm **last checked** advances, the achievement
   list/progress loads and no **Steam problem** error appears. The immediate
   save/check toast acknowledges queued work; it does not prove Steam accepted
   the new key. **Check again** queues another check, subject to a 30-second
   minimum refresh interval and provider-error backoff.

Manage the key through [Steam's API key page](https://steamcommunity.com/dev/apikey).
ICB uses a standard user Web API key; a Steamworks publisher key is unnecessary.
[Valve's authentication documentation](https://partner.steamgames.com/doc/webapi_overview/auth)
describes these key types. The configured Steam profile's game details must be
public for the achievement/stat integration to work.

If a save reports a stale edit, reload the Steam dashboard and retry from its
current settings. A concurrent operator may have saved a newer version. If a
check was queued but no result arrives, check the account's signed-in status,
the enabled switch, the key/profile and game-details privacy setting before
investigating the worker in AWS.

### Where the key goes

```text
Steam dashboard -> local Node proxy -> authenticated Express API
                                      |-> Secrets Manager: key value
                                      |-> PostgreSQL: secret ARN + version ID
Scheduled Lambda -> exact secret version -> Steam Web API -> SQL results
Local shared feed -> Steam dashboard and Meld overlays
```

The secret name is `baby-icb-postgres-integrations/<owner-uuid>/steam` for the
current stack. `icb.integration_secrets` stores its ARN and `credential_version`;
the key value is not stored in PostgreSQL feature settings or returned to overlays.
ICB accounts have separate owner UUIDs and separate integration secrets.

**Do not rotate this key by editing Secrets Manager directly.** The worker reads
the exact version recorded in PostgreSQL, rather than simply following AWS's
`AWSCURRENT` label. The dashboard's save updates both references, advances the
Steam feature revision and queues work. Stale credential edits are rejected;
an old request retry cannot restore a superseded or removed key.

Do not put the Steam key in `local-server/.env`, `terraform/.env`, Lambda
environment variables or Git. The input necessarily passes through the local
browser/Node process during submission; the durable saved value lives in Secrets
Manager. Changing only the key preserves the existing achievement baseline when
the profile and game stay the same. First-time setup or changing profile/game
establishes a baseline without replaying every old achievement.

## What runs where

The gaming PC runs one local Node server on `127.0.0.1:8790`. It reads Palia logs,
normalizes inputs, serves local artwork and renders/relays overlay data. Internet
and an ICB cloud login are required. PostgreSQL owns saved feature state and
Lambda owns the migrated business rules. The local installation has one shared
cloud feed every two seconds, regardless of how many overlay pages are open.

The AWS region is **us-east-1 (N. Virginia)**. Configurable resource names and
network `Name` tags start with **`baby-icb-`**. The base identifier is
**`baby-icb-postgres`**. Two subnets support RDS's subnet-group requirement;
the database itself is Single-AZ.

| Component | Current setup and purpose |
| --- | --- |
| RDS PostgreSQL | `baby-icb-postgres`: PostgreSQL 17, `db.t4g.micro`, Single-AZ, 20 GB encrypted gp3; storage autoscaling disabled. Database and application schema are both named `icb`. |
| Network | Dedicated VPC, two public subnets in separate AZs, public route table and internet gateway. Security group permits internet-wide IPv4 access to TCP 5432 as requested; DB password authentication and TLS are required. |
| HTTP API | API Gateway HTTP API forwards authenticated app requests to Express. Stage: `baby-icb-postgres-api`; configured rate 10 requests/second, burst 20. |
| API Lambda | `baby-icb-postgres-activity-api`: Express 5 with Lambda Web Adapter, Node 22/ARM64, 512 MB, 15-second timeout, reserved concurrency 2, max DB pool 1. Uses `pg`/`pg-format`, no ORM. |
| Worker Lambda | `baby-icb-postgres-feature-worker`: ordinary Node handler, no Web Adapter; Node 22/ARM64, 256 MB, 15-second timeout, concurrency 1, max DB pool 1. Runs leased Steam and maintenance jobs. |
| Scheduler | One-minute EventBridge Scheduler trigger, flexible window off. Integration work is limited to enabled/recently active owners; Steam normally polls at least 60 seconds apart. |
| Secrets Manager | Separate limited DB-service credential secret and owner-specific Steam secrets. API writes integration secrets; worker reads the referenced versions. |
| Release bucket | Private, encrypted, versioned S3 bucket for immutable Lambda ZIPs and separate administrative SQL upgrade bundles. Application artwork/chat archives are not stored there. |
| Failure queue | Private encrypted SQS queue, `baby-icb-postgres-feature-worker-failures`, with 14-day retention. Receives terminal Scheduler delivery failures and Lambda asynchronous execution failures. |
| Monitoring | CloudWatch API/worker logs retain seven days. Alarms cover errors, throttles, worker/Scheduler/failure-destination problems, queued failures, DB free storage and connections. |
| Budget | `baby-icb-postgres-monthly-cost-guard`: $30/month, account-wide, including unrelated AWS spend. Console-visible; no email/action recipients configured. It is not a spending cap. |
| Backups | RDS automatic backups retain seven days; deletion protection and a final snapshot requirement are configured. Private logical dumps provide separately verified recovery. |

The Lambdas connect to public RDS over certificate-verified TLS from outside the
VPC. There is no NAT gateway, RDS Proxy, Redis or extra always-on application
server. Cloudinary remains the separate, explicit artwork sync provider; overlays
continue using local image files.

## Credentials and configuration map

| Item | Purpose and location |
| --- | --- |
| ICB username/password | Required app cloud login; usernames are case-insensitive. Salted password hashes are in PostgreSQL. A fixed 14-day bearer session is protected locally with Windows CurrentUser DPAPI under `%LOCALAPPDATA%\ICB\auth`; restore validates it online. Sign out forgets it. The password is never saved locally. See [authentication](../docs/AUTHENTICATION.md). |
| PostgreSQL service login | `icb_service`, used by both Lambdas. Terraform supplies endpoint/user/secret ARN as Lambda configuration; the password is read from the separate DB secret. No master credentials go into Lambda. |
| PostgreSQL administration | RDS master username/password inputs are in ignored `terraform/.env`; generated `icb_migrator`/`icb_service` credentials are in ignored `database/.env.admin`. Use the administrative environment loader below. |
| Steam API key | Optional achievements/stats integration; owner-specific Secrets Manager value. Replace it through the dashboard above. Steam ID/profile URL is configuration, not a password. |
| AWS deployments | Dedicated IAM user `baby-icb-deployer`; access key ID/secret are in the ignored root `.env.aws`. Load through `tools/aws-env.ps1`. The code-only feature release does this automatically. |
| AWS administration | Existing human AWS CLI profile `Vox`, for IAM provisioning, rotation or broader infrastructure administration. Runtime Lambdas keep their own scoped roles and never receive PC deployment keys. |
| Cloudinary API credentials | Explicit artwork upload/download tools use ignored root `.env.cloudinary` with `CLOUDINARY_URL`; an environment variable also works. See [Cloudinary instructions](../docs/CLOUDINARY.md). |
| Local API address | Ignored `local-server/.env` contains public `ICB_CLOUD_API_URL`. It does not contain a PostgreSQL URL/password or Steam key. |

ICB itself does not store Twitch/Palia passwords or OAuth credentials: Twitch
events arrive through Meld and Palia events through local files. Meld maintains
its own connection to Twitch. Generated session/CSRF/lease tokens are managed by
the application, not additional provider credentials to configure.

The DB service password and Steam key are different secrets. Database password
rotation must coordinate the SQL role password, private administration settings
and Terraform-managed DB secret/version. Changing only a Lambda environment
variable or pasting a new value into Secrets Manager does not rotate the SQL
role. Follow [Terraform](README.md) and [database](../database/README.md)
instructions for that administrative change.

## AWS access and useful read-only commands

### Dedicated deployment credentials (.env.aws)

The dedicated `baby-icb-deployer` IAM user has programmatic access for routine
ICB releases. Its access key ID and secret are stored only in the ignored root
`.env.aws`, with Windows permissions restricted to the current user and SYSTEM.
These are long-term access keys, not an expiring `aws login` session. They remain
usable until deactivated/deleted; no console password was created.

The file contains `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` and
`AWS_DEFAULT_REGION`. The loader also accepts an optional `AWS_SESSION_TOKEN`
for deliberately supplied temporary credentials. Never display the file or paste
its contents into chat, source, logs, Terraform variables/state, packages or backups.
Use a private authorized transfer if installing the credentials on Baby's PC;
Git ignores them. Do not send them through this chat.

For direct deployment/diagnostic commands, run this in the same PowerShell process:

```powershell
. ./tools/aws-env.ps1
aws sts get-caller-identity --query Arn --output text
aws lambda get-function-configuration --function-name baby-icb-postgres-activity-api --region us-east-1 --query LastUpdateStatus
```

The loader treats file values literally, validates the entire file before changing
the environment, and clears stale profile/session settings. It prints no values.
`cloud-server/tools/release-features.ps1` automatically loads it, without
Terraform or database administration. **Do not
append `--profile Vox` to routine commands**: that explicitly chooses the human
profile. With a valid `.env.aws`, routine releases do not require `aws login`.
If the file is absent, existing profile configuration remains available; if the
file exists but is incomplete, the loader fails instead of silently changing identities.

The inline `baby-icb-deployer-releases` policy permits only:

- Read and update code/configuration on the two existing functions:
  `baby-icb-postgres-activity-api` and `baby-icb-postgres-feature-worker`.
- Read/upload versioned release files under `releases/` in the existing ICB bucket.
- Pass only those two functions' existing roles to Lambda.

The exact allowed actions are:

| Scope | Actions |
| --- | --- |
| The two functions above, account 981928628017, us-east-1 | `lambda:GetFunction`, `lambda:GetFunctionConfiguration`, `lambda:GetPolicy`, `lambda:ListTags`, `lambda:UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration` |
| `arn:aws:s3:::baby-icb-postgre-builds-981928628017-us-east-1/releases/*` | `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` |
| Existing roles `baby-icb-postgres-activity-api` and `baby-icb-postgres-feature-worker` in this account | `iam:PassRole`, only when `iam:PassedToService` is `lambda.amazonaws.com` |

There are no AWS managed policies attached. The user cannot create/delete Lambda
functions, buckets, IAM users, stacks or other infrastructure, and cannot update
unrelated functions. It has no general Terraform refresh/administration permissions.
Baby's normal updates are code releases; Terraform and SQL administration stay with
the separate human administrator. PostgreSQL credentials remain in the existing
private database environment files, never in `.env.aws`.

Preview and release from the repository root:

```powershell
./cloud-server/tools/release-features.ps1
./cloud-server/tools/release-features.ps1 -Apply
```

Run the mandatory tests first. The script builds the runtime package, verifies the
account and both existing functions, uploads a versioned ZIP only when needed, and
updates their code with revision fencing. It waits for successful updates and
checks the deployed hashes. It records previous hashes/revisions and completed
functions in ignored `backups/releases/` receipts. An incomplete release remains
explicitly incomplete; rerun after reviewing the receipt to finish it. If both
functions already match the package, it makes no changes. It never restarts ICB,
creates infrastructure, applies SQL upgrades or uploads images. SQL upgrades must
be completed separately before releasing code that needs them.

The provisioning source is `cloud-server/tools/provision-deployer.ps1`. With the
human admin profile, rerunning it without `-CreateAccessKey` reapplies its policies
without creating another key. Initial key creation requires `-CreateAccessKey` and
refuses to overwrite a populated `.env.aws`. It never stores keys in Terraform.
For rotation, use the admin profile to create a second key, replace `.env.aws`
privately, verify caller identity and a feature-release preview, then deactivate/delete the old
key. If a key is lost, its secret cannot be recovered; create a replacement.

### Human administrative fallback

From PowerShell at the repository root:

```powershell
aws login --profile Vox
aws sts get-caller-identity --profile Vox
terraform -chdir=terraform output -raw activity_api_url
terraform -chdir=terraform output -raw database_host
terraform -chdir=terraform output -raw database_username
terraform -chdir=terraform output -raw feature_worker_name
```

The named-profile sign-in flow is described in
[AWS CLI documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).
Use the DNS hostname from Terraform for database clients, rather than a fixed IP.
For pgAdmin: database `icb`, port `5432`, username from the output, the privately
held DB password, SSL mode `verify-full`, and CA certificate
`database/certs/global-bundle.pem`. A working ICB login is not a DB login.

In the AWS console, select us-east-1 and look under RDS, Lambda, API Gateway,
Secrets Manager, EventBridge Scheduler, SQS and CloudWatch. Billing/Budgets shows
the account-wide budget. The log groups are
`baby-icb-postgres-activity-api-logs` and
`baby-icb-postgres-feature-worker-logs`. Alarms currently show in the console;
notifications require an explicitly configured destination.

## Deployments and recovery

Steam key changes use the dashboard. For routine feature-code releases, use the
code-only command above. The following is the separate administrator workflow for
a tested infrastructure/SQL release, using the human profile in a fresh process
without loading the restricted deployment keys:

```powershell
./cloud-server/tools/release.ps1 -EnableWorker -Apply
```

The release checks SQL readiness, builds/uploads immutable packages, and refuses
RDS changes or resource deletion in its release plan. It updates the public local
API URL without restarting the local server. SQL upgrades run separately with
administrative credentials, never at Lambda startup. Use one Terraform operator
at a time; preserve ignored state, release metadata, credentials and dumps.

Before an administrator later plans infrastructure changes, reconcile Terraform's
release key/version/hash with the latest successful code-only release receipt.
Do not let stale release inputs roll deployed feature code backward. The dedicated
feature command itself never invokes Terraform or modifies infrastructure settings.

For a private logical backup using the existing administration configuration:

```powershell
. ./database/admin-env.ps1 -Role master
try {
    ./database/backup.ps1
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
```

AWS CLI, Terraform, PostgreSQL tools and the repository's installed cloud tools
are prerequisites for administration. Recover dumps into a new empty database;
do not overwrite current progress with old local JSON. Detailed procedures:

- [Cloud operation, migration, rollback and worker failures](../docs/STEP2-OPERATIONS.md)
- [Database creation, grants, backup and restore](../database/README.md)
- [Feature/field ownership](../docs/STEP2-FEATURE-MAP.md)
- [Validation, existing missing-artwork failures and cost measurements](../docs/STEP2-VALIDATION.md)

The last cost estimate is about $20–27/month for one busy installation active
120 hours/month, depending on free allowances and integration use. That is an
estimate from the linked validation report, not a current bill or a hard limit.
