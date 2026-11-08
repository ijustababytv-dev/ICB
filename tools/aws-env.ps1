param([string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) '.env.aws'))
$ErrorActionPreference = 'Stop'
# Load only AWS settings as literal strings. Never execute dotenv contents or print keys.
if (-not (Test-Path -LiteralPath $Path)) { return }
$allowed = @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_REGION','AWS_DEFAULT_REGION')
$settings = @{}
$lineNumber = 0
foreach ($line in [IO.File]::ReadAllLines($Path)) {
    $lineNumber++
    if ($line -match '^\s*(#.*)?$') { continue }
    if ($line -notmatch '^\s*([A-Z_]+)\s*=(.*)$') { throw "Invalid AWS environment line $lineNumber." }
    $key = $matches[1]
    $value = $matches[2].Trim()
    if ($key -notin $allowed -or $settings.ContainsKey($key)) { throw "Unsupported or repeated AWS setting on line $lineNumber." }
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $settings[$key] = $value
}
foreach ($required in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY')) {
    if ([string]::IsNullOrWhiteSpace($settings[$required])) { throw 'Project AWS credentials are incomplete. Repair .env.aws privately.' }
}
# Validate the complete file before replacing ambient credentials. A stale session
# token or login profile must not override this dedicated IAM user's key pair.
foreach ($name in @('AWS_PROFILE','AWS_DEFAULT_PROFILE','AWS_SESSION_TOKEN','AWS_SECURITY_TOKEN')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
foreach ($name in $settings.Keys) {
    [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
}
if (-not $settings.ContainsKey('AWS_REGION')) { $env:AWS_REGION = 'us-east-1' }
if (-not $settings.ContainsKey('AWS_DEFAULT_REGION')) { $env:AWS_DEFAULT_REGION = $env:AWS_REGION }
Write-Output 'Project AWS credentials loaded from .env.aws (values hidden).'
