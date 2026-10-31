# ICB AWS infrastructure: Step 1

Terraform defines Step 1 infrastructure. It does not implement the application,
restructure source folders, create SQL roles/tables, import data, or complete the
Step 1 acceptance tests. No AWS resources are applied by editing these files.

## Resources

| Component | Configuration |
| --- | --- |
| Database | RDS PostgreSQL 17, db.t4g.micro, Single-AZ, 20 GiB gp3; storage autoscaling disabled |
| Network | Dedicated VPC, two publicly routed subnets/AZs, internet gateway, RDS subnet group |
| DB firewall | Internet-wide IPv4 TCP 5432, as requested; `allowed_ipv4_cidrs` can restrict it |
| DB protection | Password auth, mandatory TLS, encryption, seven-day backups, deletion protection, retained final snapshot |
| Releases | Private encrypted/versioned S3 bucket for immutable cloud-server ZIPs; public access blocked; TLS required |
| Secrets | Secrets Manager container for the limited service-role login; seven-day recovery; populated on API enablement |
| API foundation | API Gateway HTTP API, prefixed named stage, 10 requests/sec with burst 20, no access-log payload archive |
| API runtime | Explicitly enabled Node.js 22 ARM64 Lambda, 512 MB, 15-second timeout, concurrency 2, pinned Web Adapter layer 30 |
| Permissions | Lambda writes only its own logs and reads only its service-role secret; Gateway invocation is scoped to this API |
| Monitoring | Seven-day custom Lambda log group; RDS free-storage/connection alarms; Lambda error/throttle alarms when enabled |

All configurable AWS resource names begin with **`baby-icb-`**. The RDS identifier
defaults to `baby-icb-postgres`; overrides and final snapshot names must preserve
the prefix. IAM policies, the Gateway stage, the custom Lambda log group, secrets,
buckets, and alarms follow the same rule. Network resources use prefixed `Name`
tags; other taggable resources receive a prefixed default `Name` tag. AWS-generated
IDs, log-stream names, automatic backup naming, route syntax, SQL identifiers,
and referenced AWS-owned adapter layers retain their required service formats.

The API base URL includes its named stage. Use `activity_api_url` as returned;
the adapter strips that stage path before Express routing. Lambda is explicitly
configured to write to the prefixed log group. Naming changes can rename or
replace existing resources; review the full plan and preserve state before apply.
Change old explicit `db_identifier = "baby-icb"` overrides to a prefixed identifier
with a suffix (for example, `baby-icb-postgres`) before planning.

Lambda connects over verified TLS to public RDS without joining the VPC. No NAT
gateway, EC2 server, Aurora, RDS Proxy, load balancer, custom domain, provisioned
concurrency, or Step 2 worker is included. Secrets, S3, alarms/logs, API Gateway,
and Lambda add service/usage charges to RDS.

`activity_api_enabled` defaults to **false**. The foundation creates no Lambda or
API routes and outputs no usable API URL. It does not publish a sample handler.
Full API resources are defined but require the actual Step 1 build, verified DB
bootstrap, and explicit enablement. An empty secret container is expected first.

## Phase A: review/provision the foundation

Use Terraform 1.11+ and an AWS profile/SSO session authorized for VPC, RDS, S3,
Secrets Manager, IAM, CloudWatch, Lambda and API Gateway, including scoped PassRole
when deploying Lambda. Select the intended profile; the default region is
`us-east-1`. Do not put AWS credentials in tracked files.

An ignored `terraform/.env` can contain:

```dotenv
AWS_PROFILE=YOUR_EXISTING_PROFILE
TF_VAR_aws_region=us-east-1
TF_VAR_db_username=YOUR_MASTER_USERNAME
TF_VAR_db_password=YOUR_MASTER_PASSWORD
```

Terraform does not read `.env`. Load plain unquoted KEY=value lines privately,
then initialize/validate from PowerShell:

```powershell
Set-Location terraform
Get-Content -LiteralPath .env | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}
terraform init
terraform fmt -check -recursive
terraform validate
terraform test
terraform plan
```

Review account, region and resources before `terraform apply`. Defaults suffice
for Phase A. Copy `terraform.tfvars.example` only when needed; explicit tfvars
override TF_VAR environment values. Applying incurs charges. Preserve the state
of existing resources; do not create a new state directory for an existing stack.

Master usernames default to `icbadmin`: 1-16 letters/digits/underscores, starting
with a letter, excluding reserved engine names. Changing an existing master name
or identifier can replace the DB: inspect the plan. Master passwords use sensitive
ephemeral inputs and write-only RDS fields, excluding them from state/plans. Use
16-128 printable ASCII characters without spaces, `/`, `@`, or double quotes.
Retain the password yourself; Terraform cannot recover it. Increment
`db_password_version` when deliberately rotating it.

## Phase B: enable the real Step 1 API

These application prerequisites remain pending until Step 1 is implemented and
tested. Terraform infrastructure cannot substitute for working application code.

1. Complete the planned `cloud-server/`, `local-server/`, and `ui/` migration.
   Build the real Express app with authentication/owner middleware, ingestion,
   reports, input limits, DB access, and acceptance tests.
2. Run SQL migrations and create a limited PostgreSQL role such as `icb_service`
   with table/sequence grants. Verify its password, TLS and permissions. Terraform
   does not execute SQL bootstrap. Do not use the master role in Lambda.
3. Build a Linux-compatible ZIP with executable LF `run.sh` at its root, real
   application code, pinned production dependencies, and `certs/global-bundle.pem`
   from AWS's RDS trust store. The script starts the packaged Express bootstrap.
   Listen on `PORT=8080`; expose a non-sensitive `/healthz`. All other routes
   except login require authentication. The adapter handles HTTP API v2 events.
4. Upload the ZIP under `releases/` in the bucket shown by
   `terraform output -raw activity_artifact_bucket`. Record its immutable S3
   VersionId and base64 SHA-256 of the ZIP bytes. Exclude `.env`, state, development
   dependencies, live data, artwork, backups, and credentials from the archive.
5. Supply `TF_VAR_activity_db_password` privately with the password already
   assigned to that service role (16-128 characters). Keep `activity_db_username`
   equal to the bootstrapped role. This is separate from the RDS master password.
6. Configure non-secret inputs in ignored `terraform.tfvars` when ready:

```hcl
activity_api_enabled     = true
activity_database_ready = true
activity_db_username    = "icb_service"
activity_release = {
  key        = "releases/REPLACE_WITH_REAL_RELEASE.zip"
  version_id = "REPLACE_WITH_S3_VERSION_ID"
  sha256     = "REPLACE_WITH_BASE64_SHA256_OF_ZIP"
}
```

7. Review the plan and apply deliberately. Missing release metadata, missing
   service password, an unprepared database, or reuse of the master role blocks
   deployment. Guards require truthful bootstrap confirmation; actual SQL grants
   and application behavior still require live acceptance tests.
8. Verify readiness, login, owner isolation, ingest/report round trips, retries,
   TLS and redacted logs. Use the `activity_api_url` output in local Node settings.
   Infrastructure apply does not connect ICB automatically.

API throttling is not a spending cap. Express must implement authorization,
failed-login throttling, schema validation, and redaction. Verify account quota
allows reserving two Lambda concurrency units while preserving AWS's required
unreserved headroom. Verify ARM64 adapter layer 30 exists in the selected region.
Do not silently remove the connection cap to get past a quota error.

## Automatically wired Lambda environment

Terraform derives `DB_HOST`, `DB_PORT`, `DB_NAME`, and `DB_SECRET_ARN` from resources.
`DB_USER` is the configured limited role. It also sets `DB_CA_FILE`, `DB_POOL_MAX=1`,
connection timeout, body/batch limits, session lifetime, and adapter startup/readiness.
See the non-secret `activity_lambda_environment` output.

There is no `DB_PASSWORD` environment value or master login in Lambda. Its code
retrieves the secret and verifies the RDS certificate. Environment settings enforce
nothing until the app reads/validates them. Increment `activity_db_password_version`
when deliberately rotating the service password, coordinating the PostgreSQL role
first. A changed input alone does not rotate it. No automatic rotation is configured.

## Connect and monitor

For private administrative access with `psql` installed:

```powershell
Invoke-WebRequest https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -OutFile global-bundle.pem
terraform output -raw psql_command
```

Run the printed command to verify TLS and enter the master password privately.
Users receive ICB accounts, not that DB password.

Alarms initially appear only in CloudWatch. Set `alarm_action_arns` to existing
SNS topics for notifications; topic permissions/subscriptions must permit delivery.
Set an AWS Budget alert separately. Neither alarms nor throttles impose a hard
cost cap. Retained backups, S3 versions, IPv4, transfer, CPU credits, monitoring,
and secrets can add charges. Check regional pricing before apply.

## State, verification, and removal

State/plans/tfvars/provider downloads stay ignored; retain the provider lockfile.
Keep state private, back it up securely, and use one Terraform operator at a time.
Use an encrypted locking remote backend before concurrent Terraform administration.
OneDrive sync is not state locking. No state or release ZIP belongs in public Git.

`terraform test` uses mocked AWS resources, including mocked applies, and creates
nothing in AWS. It tests both modes, release metadata, adapter settings, secret
separation, IAM scope, alarms, and DB safety gates. It does not prove quotas,
regional layer availability, SQL grants, ZIP contents, authentication, connectivity,
or a successful deployed service. No AWS resources were applied during preparation.

For deliberate removal, first disable/apply DB deletion protection, then review
`terraform plan -destroy`. Use an unused final snapshot identifier. The artifact
bucket refuses forced deletion while nonempty; preserve required releases before
deliberately emptying it. Secrets have seven-day recovery. Retained DB snapshots,
backups, S3 objects/versions can keep incurring charges after removal. Disabling
`activity_api_enabled` tears down Lambda/routes and the managed secret version;
it is not a pause button.

References: [AWS Express ZIP example](https://github.com/aws/aws-lambda-web-adapter/tree/main/examples/expressjs-zip),
[RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html),
[Lambda concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html),
[write-only inputs](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral).
