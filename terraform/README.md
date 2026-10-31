# ICB AWS PostgreSQL

Creates regular RDS PostgreSQL 17, `db.t4g.micro`, Single-AZ, with 20 GiB gp3,
password authentication, encryption at rest, mandatory TLS, seven-day backups,
deletion protection, and a final snapshot on deletion. Minor updates are automatic;
major upgrades are deliberate. Backup/maintenance times in the configuration are UTC.

The dedicated VPC has two public subnets in separate AZs, an internet gateway,
routes, an RDS subnet group, and a security group allowing TCP 5432 from
`0.0.0.0/0`, as requested. Other inbound ports are closed. Restrict
`allowed_ipv4_cidrs` to trusted public IPs when practical. An internet-accessible
database will receive login attempts; use a unique database admin password.

There is no NAT gateway, EC2 instance, Aurora cluster, proxy, Secrets Manager
subscription, Enhanced Monitoring, or CloudWatch log export. This creates the
database infrastructure only; it does not create application tables, cloud API,
or ICB accounts, migrate data, or change the local server.

## Requirements and deployment

Use Terraform 1.11+ and AWS credentials authorized to manage VPC/RDS resources.
Use your existing AWS profile/SSO session; never put AWS keys in these files.
The default region is `us-east-1`; change it before creation if needed.

From PowerShell at the project root:

```powershell
Set-Location terraform
Copy-Item terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform test
terraform plan
terraform apply
```

Review the plan before applying. `plan` and `apply` each request `db_password`
privately; supply the same password from your password manager. Use 16-128 printable
ASCII characters excluding spaces, `/`, `@`, and double quotes. The input is sensitive
and ephemeral and uses RDS `password_wo`, so Terraform omits it from plans and state.
Avoid CLI `-var` password arguments, shell transcripts, or debug logging. Retain the
password yourself; Terraform cannot recover it. Increment `db_password_version`
whenever deliberately changing it. A new password without a version increment
does not request rotation. Changing the identifier can replace the database;
inspect replacement actions carefully.

Terraform state, plans, private tfvars, and `.terraform/` downloads are ignored.
Commit `.terraform.lock.hcl` for repeatable provider installation. State defaults
to local storage: keep it private, back it up securely, and have one operator run
Terraform at a time. For team infrastructure administration, move state to a
private encrypted remote backend with locking before concurrent use. OneDrive
sync is not Terraform state locking.

## Connect

After creation, download AWS's public RDS CA bundle into this folder:

```powershell
Invoke-WebRequest https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -OutFile global-bundle.pem
terraform output -raw psql_command
```

Run the printed command with `psql` installed. It verifies the server certificate
and prompts for the password. Use the hostname, database `icb`, user `icbadmin`,
port 5432, and certificate verification in other clients too. Create a separate
limited database role when implementing application access; do not distribute
the master password to software users. Their future ICB login accounts are separate.

## Cost, checks, and removal

Use the AWS pricing calculator for the chosen region and review the RDS console
estimate. The bill includes instance time, provisioned storage, public IPv4,
and applicable backup/transfer/CPU-credit charges. Set an AWS Budget alert;
it is a notification, not a spending cap. No resources are created by `init`,
`validate`, or the mocked `terraform test`; AWS-backed `plan` needs credentials.

Tests check the small-instance configuration, internet routing, requested port
exposure, TLS, backups, and a restricted-CIDR override with a mocked AWS provider.
They do not prove AWS account quotas, regional availability, password login, or
live reachability. Validate those after a deliberate deployment.

To remove deliberately, set `deletion_protection = false`, review and apply that
change first, then review `terraform plan -destroy`. Use `terraform destroy` only
when ready. The final snapshot identifier must be unused; change the example if
a previous snapshot exists. Retained automated backups and final snapshots can
continue incurring charges after deletion. Deletion protection does not prevent
an authorized operator from changing it; keep recovery backups.

References: [RDS Terraform resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance),
[write-only secret handling](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral),
[RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html),
[RDS pricing](https://aws.amazon.com/rds/postgresql/pricing/).
