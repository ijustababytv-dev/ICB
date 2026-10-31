# PostgreSQL source, backup, and recovery

This folder is the versioned source needed to recreate ICB's PostgreSQL schema.
RDS manages its physical database files. Actual account data is recovered with an
RDS snapshot or a private logical dump, never by committing database files to Git.

- `tables/`: **one current `CREATE TABLE` definition per table**, named after that table (19 files).
- `indexes/`: one definition per standalone index (12 files). Primary-key and unique-constraint
  indexes are created by their table definitions, giving 34 indexes in total.
- `roles/`: one file each for `icb_migrator` and `icb_service`. Passwords come from private session settings.
- `permissions/`: schema access and one table-privilege file per table; the service cannot perform DDL or change account passwords.
- `views/`, `functions/`: reserved for one definition per object when those objects exist.
  PostgreSQL currently has no application views, stored functions/procedures, sequences, or custom triggers.
  Reports and business rules currently use explicit SQL and Node code in `cloud-server/src/activity/`.
- `schema.json`: dependency order for the actual object files and checksums of covered schema versions.
- `migrations/`: future numbered, immutable upgrade scripts (`ALTER`, backfills, etc.);
  table creation sources belong in `tables/`. See [the upgrade instructions](migrations/README.md).
- `state-manifest.json`: the allowlist of current local settings/progress copied to account-scoped `feature_state`.
- `backup.ps1`: a complete custom-format dump under ignored `backups/database/`.
- `restore.ps1`: transactional restore into a new empty database; it never uses `--clean`.

Install cloud tools with `npm ci --prefix cloud-server`. Administrative commands
require private `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and
`PGSSLROOTCERT`. TLS certificate and hostname verification are mandatory. Do not
put operational passwords in command-line arguments, tracked files, or shell output.

Load administrative connection settings without printing secrets:

```powershell
. ./database/admin-env.ps1 -Role master
node cloud-server/tools/bootstrap.js
. ./database/admin-env.ps1 -Role migration
```

The bootstrap preserves generated SQL role credentials in ignored
`database/.env.admin`, creates the schema from its object files or applies pending upgrades,
applies limited privileges, and adds the
limited service password to ignored `terraform/.env`. Existing roles without their
original private credential file cause a safe failure rather than a silent reset.

For a new database:

1. Provision the RDS/network foundation using the existing Terraform state or, for
   an intentionally new stack, a reviewed configuration. Keep the `baby-icb-` names.
2. Load the master connection and run `node cloud-server/tools/bootstrap.js` as above.
   This executes `roles/` and schema access files as master, then creates objects and
   applies permissions as `icb_migrator`. No manual password substitution in SQL is needed.
3. For structure-only recreation with roles already provisioned, load the migration
   connection and run `npm run schema:create --prefix cloud-server`, followed by
   `npm run schema:grants --prefix cloud-server`. Creation is transactional and refuses
   populated schemas. It does not create accounts or recover data. Use
   `npm run migrate --prefix cloud-server` for upgrades to an existing database;
   migrations never run automatically during Lambda startup.
4. Provision the default `ijustababytv` account with `npm run account --prefix cloud-server`.
   Supply `ICB_ACCOUNT_PASSWORD` privately; usernames are normalized to lowercase.
   Existing accounts keep their passwords unless the explicit `--rotate` option is used.
5. When recovering existing data, restore a logical dump into an empty database
   **instead of creating the schema first**. As the restore owner, run
   `npm run schema:grants --prefix cloud-server`, then verify login, totals, and TLS.
6. Configure the limited service secret and deploy the tested cloud ZIP through Terraform.

Back up with `powershell -File database/backup.ps1`. Recover using
`powershell -File database/restore.ps1 -BackupFile PATH_TO_PRIVATE_DUMP` after
selecting the new target through `PGDATABASE`. Dumps include password hashes and
private viewer/state data; keep them private. RDS also retains seven-day backups.

The four original grouped migrations are covered by the object definitions.
Their exact hashes remain in `schema.json`; their original contents remain in Git
commit `220aa40` and a private backup. Existing databases keep their four original
ledger rows unchanged. Fresh creation records those covered versions and a source
fingerprint in `schema_migrations`, without replaying duplicate `CREATE TABLE` scripts.
Editing a table file never alters an existing database; add an explicit upgrade
script for that change. Partially applied legacy versions must be completed with
their original release before switching to this layout.

Validate recreation against the selected database with:

```powershell
. ./database/admin-env.ps1 -Role master
npm.cmd run schema:check --prefix cloud-server
Remove-Item Env:PGPASSWORD
```

This creates and removes only a generated disposable schema, comparing column
types/defaults/order, constraints, indexes, views, routines, sequences, and custom
triggers. It reads the selected database's definitions without changing its objects
or rows. The 2026-10-31 check matched all 19 tables and 34 indexes.

`feature_state` is a recovery copy during Step 1. Current balances, settings,
signups, collections, timers, and other allowlisted feature files are copied under
the signed-in owner. Raw activity/chat archives, legacy Palia totals, import seed
copies, diagnostics, credentials, and duplicate backup folders are excluded.
Transcript-bearing nested fields and the local Palia reader diagnostic are removed.
Nothing automatically restores a historical snapshot over current tracker totals.

Preview current-state migration with `node cloud-server/tools/import-state.js`;
add `--apply` to save it. Historical activity uses
`node cloud-server/tools/import-history.js FILE CUTOFF_ISO [--apply]`. Both default
to preview. Keep the cutover fixed and source bytes frozen across retries. Changed
sources that already have an import record are rejected, avoiding accidental
double imports. Only normalized counts/support/audit events are uploaded.

Historical import explicitly records malformed lines, unequal chat representations,
ambiguous support, and missing award deltas. Such days are marked partial. One chat
representation is chosen per day (raw where available, structured otherwise), and
known source IDs are deduplicated. Old raw and structured chats are never added together.
No imported activity invokes local ticket-award functions.

`npm test --prefix cloud-server` runs pure/HTTP tests. With the private PG variables
and `ICB_TEST_POSTGRES=1` (load `admin-env.ps1 -Role master` for schema creation), it also creates and removes an isolated `icb_test_*` schema
to exercise actual object creation, legacy-history preservation, upgrade checksums,
DDL rollback, transactions, retries, concurrent support
duplicates, owner isolation, snapshot access, and summary retention. Tests never
point the local server at production `data/` or restore historical live progress.


A real backup was restored into an isolated `icb_test_restore_*` database on
2026-10-31 and its account/state/message totals matched. Repeat this verification
with `node cloud-server/tools/verify-backup.js PATH_TO_PRIVATE_DUMP` using the
master environment when testing a new backup. It removes only its generated test
database. After administrative work, clear `PGPASSWORD` from the shell environment.
