param([ValidateSet('master','migration','service')][string]$Role = 'migration')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$terraformRoot = Join-Path $projectRoot 'terraform'
foreach ($envLine in [IO.File]::ReadAllLines((Join-Path $terraformRoot '.env'))) {
    if ($envLine -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $envKey=$matches[1]
        $envValue=$matches[2]
        if ($envValue.Length -ge 2 -and (($envValue.StartsWith('"') -and $envValue.EndsWith('"')) -or ($envValue.StartsWith("'") -and $envValue.EndsWith("'")))) {
            $envValue=$envValue.Substring(1,$envValue.Length-2)
        }
        if ($envKey -match '^(AWS_PROFILE|AWS_REGION|AWS_DEFAULT_REGION|TF_VAR_[A-Za-z0-9_]+)$') {
            [Environment]::SetEnvironmentVariable($envKey,$envValue,'Process')
        }
    }
}
$outputArgs=@(('-chdir='+$terraformRoot),'output','-json')
$databaseOutputsRaw=& terraform @outputArgs
if ($LASTEXITCODE -ne 0) { throw 'Terraform outputs are required before loading database access.' }
$databaseOutputs=($databaseOutputsRaw -join [Environment]::NewLine) | ConvertFrom-Json
$env:PGHOST=$databaseOutputs.database_host.value
$env:PGPORT=[string]$databaseOutputs.database_port.value
$env:PGDATABASE=$databaseOutputs.database_name.value
$env:PGSSLMODE='verify-full'
$env:PGSSLROOTCERT=Join-Path $PSScriptRoot 'certs/global-bundle.pem'
if ($Role -eq 'master') {
    $env:PGUSER=$env:TF_VAR_db_username
    $env:PGPASSWORD=$env:TF_VAR_db_password
} else {
    $roleCredentials=Get-Content -LiteralPath (Join-Path $PSScriptRoot '.env.admin') -Raw | ConvertFrom-Json
    $env:PGUSER=if($Role -eq 'migration'){'icb_migrator'}else{'icb_service'}
    $env:PGPASSWORD=if($Role -eq 'migration'){$roleCredentials.migration_password}else{$roleCredentials.service_password}
}
Write-Output ('Private PostgreSQL environment loaded for role: '+$Role)
