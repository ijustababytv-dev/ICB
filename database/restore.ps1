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
$projectRoot=Split-Path -Parent $PSScriptRoot
& node (Join-Path $projectRoot 'cloud-server/tools/restore-permissions.js')
if ($LASTEXITCODE -ne 0) { throw 'Rows were restored; complete namespace/ownership recovery before cutover. Legacy public-schema dumps require migrate first.' }
Write-Output 'Database restored with migration ownership and limited service privileges. Verify the application account before cutover.'
