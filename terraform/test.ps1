$ErrorActionPreference='Stop'
$sourceRoot=$PSScriptRoot
$temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot=Join-Path $temporaryRoot ('baby-icb-terraform-tests-'+[guid]::NewGuid().ToString('N'))
$savedEnvironment=@{}
try {
    foreach($item in Get-ChildItem Env: | Where-Object {$_.Name -like 'TF_VAR_*'}) {
        $savedEnvironment[$item.Name]=$item.Value
        [Environment]::SetEnvironmentVariable($item.Name,$null,'Process')
    }
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object {$_.Name -like '*.tf' -or $_.Name -eq '.terraform.lock.hcl'} | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $testRoot
    }
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'tests') -Destination (Join-Path $testRoot 'tests') -Recurse
    $providers=Join-Path $sourceRoot '.terraform/providers'
    & terraform ('-chdir='+$testRoot) init -backend=false -input=false -lockfile=readonly ('-plugin-dir='+$providers) -no-color
    if($LASTEXITCODE -ne 0) {throw 'Isolated Terraform initialization failed.'}
    & terraform ('-chdir='+$testRoot) test -no-color
    if($LASTEXITCODE -ne 0) {throw 'Mocked Terraform checks failed.'}
} finally {
    foreach($entry in $savedEnvironment.GetEnumerator()) {[Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process')}
    $resolved=[IO.Path]::GetFullPath($testRoot)
    if($resolved.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^baby-icb-terraform-tests-[a-f0-9]{32}$' -and (Test-Path -LiteralPath $resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
