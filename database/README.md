# PostgreSQL source, backup, and recovery

This folder is the versioned source needed to recreate ICB's PostgreSQL schema.
RDS manages its physical database files. Actual account data is recovered with an
RDS snapshot or a private logical dump, never by committing database files to Git.

- `migrations/`: ordered, immutable schema migrations with checksums/advisory locking.
- `bootstrap.sql`: separate migration/service roles; role passwords come from private session settings.
- `grants.sql`: limited service permissions after migrations; no service DDL or account-password writes.
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
`database/.env.admin`, applies the versioned migrations/grants, and adds the
limited service password to ignored `terraform/.env`. Existing roles without their
original private credential file cause a safe failure rather than a silent reset.

For a new database:

1. Provision the RDS/network foundation using the existing Terraform state or, for
   an intentionally new stack, a reviewed configuration. Keep the `baby-icb-` names.
2. Run `bootstrap.sql` as master after setting `icb.migration_password` and
   `icb.service_password` with parameterized `set_config` calls in that session.
3. Connect as `icb_migrator`; run `npm run migrate --prefix cloud-server`, then
   `grants.sql`. Migrations never run automatically during Lambda startup.
4. Provision the default `ijustababytv` account with `npm run account --prefix cloud-server`.
   Supply `ICB_ACCOUNT_PASSWORD` privately; usernames are normalized to lowercase.
   Existing accounts keep their passwords unless the explicit `--rotate` option is used.
5. Restore a logical dump into an empty database instead of replaying migrations
   when recovering existing data. Then rerun grants and verify login, totals, and TLS.
6. Configure the limited service secret and deploy the tested cloud ZIP through Terraform.

Back up with `powershell -File database/backup.ps1`. Recover using
`powershell -File database/restore.ps1 -BackupFile PATH_TO_PRIVATE_DUMP` after
selecting the new target through `PGDATABASE`. Dumps include password hashes and
private viewer/state data; keep them private. RDS also retains seven-day backups.

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
to exercise actual PostgreSQL migrations, transactions, retries, concurrent support
duplicates, owner isolation, snapshot access, and summary retention. Tests never
point the local server at production `data/` or restore historical live progress.


A real backup was restored into an isolated `icb_test_restore_*` database on
2026-10-31 and its account/state/message totals matched. Repeat this verification
with `node cloud-server/tools/verify-backup.js PATH_TO_PRIVATE_DUMP` using the
master environment when testing a new backup. It removes only its generated test
database. After administrative work, clear `PGPASSWORD` from the shell environment.
