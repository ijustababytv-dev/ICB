param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
if (-not $env:PGHOST -or -not $env:PGUSER -or -not $env:PGPASSWORD -or -not $env:PGDATABASE -or -not $env:PGSSLROOTCERT) {
    throw 'Set private PG connection variables for the new, empty target database first.'
}
$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
$env:PGSSLMODE = 'verify-full'
# No --clean: restoring over a populated database must fail instead of deleting existing data.
& pg_restore --dbname=$env:PGDATABASE --no-owner --no-acl --single-transaction --exit-on-error $resolvedBackup
if ($LASTEXITCODE -ne 0) { throw 'Restore failed. Use a new empty database; existing data was not deliberately removed.' }
Write-Output 'Database restored. Run grants.sql and verify the application account before cutover.'
