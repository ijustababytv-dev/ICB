param([string]$OutputFile)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:PGHOST -or -not $env:PGUSER -or -not $env:PGPASSWORD -or -not $env:PGSSLROOTCERT) {
    throw 'Load private PGHOST, PGUSER, PGPASSWORD, PGDATABASE, and PGSSLROOTCERT first.'
}
if (-not $OutputFile) {
    $OutputFile = Join-Path $projectRoot ('backups/database/baby-icb-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.dump')
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputFile)
$backupRoot = Join-Path $projectRoot 'backups'
if (-not $resolvedOutput.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Database dumps must be written under the ignored project backups directory.'
}
if (Test-Path -LiteralPath $resolvedOutput) { throw 'Backup destination already exists.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
$env:PGSSLMODE = 'verify-full'
& pg_dump --format=custom --no-owner --no-acl --file=$resolvedOutput
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
Write-Output ('Database backup saved: ' + $resolvedOutput)
