param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $projectRoot 'tools/aws-env.ps1')
$targets = Get-Content (Join-Path $projectRoot 'cloud-server/config/release-targets.json') -Raw | ConvertFrom-Json
$identity = ((& aws sts get-caller-identity --output json) -join '') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $targets.accountId) { throw 'AWS identity does not match the ICB release account.' }
& python (Join-Path $PSScriptRoot 'build.py')
if ($LASTEXITCODE -ne 0) { throw 'Cloud package build failed.' }
$artifact = Join-Path $projectRoot 'dist/baby-icb-cloud-server.zip'
$digest = [Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($artifact))
$sha256 = [Convert]::ToBase64String($digest)
$hex = ([BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant()
$key = 'releases/baby-icb-cloud-' + $hex + '.zip'
$previous = @()
foreach ($functionName in $targets.functions) {
    $configuration = ((& aws lambda get-function-configuration --region $targets.region --function-name $functionName --output json) -join '') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $configuration.State -ne 'Active' -or $configuration.LastUpdateStatus -ne 'Successful') { throw 'An existing ICB Lambda is unavailable or already updating.' }
    $previous += [pscustomobject]@{functionName=$functionName; sha256=$configuration.CodeSha256; revisionId=$configuration.RevisionId}
    Write-Output ($functionName + ': ' + $(if ($configuration.CodeSha256 -eq $sha256) { 'already matches' } else { 'code update planned' }))
}
if (-not $Apply) { Write-Output 'Feature release preview complete. No AWS changes made. Use -Apply to upload and update the existing functions.'; return }
if (@($previous | Where-Object { $_.sha256 -ne $sha256 }).Count -eq 0) { Write-Output 'Both existing ICB functions already match this package. Nothing to update.'; return }
# Keep deployment receipts separate from Terraform. No IAM, network, database,
# function creation or configuration changes occur in this code-only release.
$history = Join-Path $projectRoot 'backups/releases'
[IO.Directory]::CreateDirectory($history) | Out-Null
$receiptFile = Join-Path $history ('icb-features-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff') + '.json')
$receipt = @{accountId=$targets.accountId; region=$targets.region; bucket=$targets.artifactBucket; key=$key; sha256=$sha256; previous=$previous; completed=@(); status='uploading'}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
try {
    $upload = ((& aws s3api put-object --region $targets.region --bucket $targets.artifactBucket --key $key --body $artifact --output json) -join '') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $upload.VersionId) { throw 'Versioned release upload failed.' }
    $receipt.versionId = $upload.VersionId
    foreach ($entry in $previous) {
        if ($entry.sha256 -eq $sha256) { continue }
        # Revision fencing prevents silently replacing a concurrent developer's release.
        & aws lambda update-function-code --region $targets.region --function-name $entry.functionName --s3-bucket $targets.artifactBucket --s3-key $key --s3-object-version $upload.VersionId --revision-id $entry.revisionId --output json | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Lambda update failed; inspect the release receipt before retrying.' }
        & aws lambda wait function-updated-v2 --region $targets.region --function-name $entry.functionName
        if ($LASTEXITCODE -ne 0) { throw 'Lambda update did not finish successfully.' }
        $confirmed = ((& aws lambda get-function-configuration --region $targets.region --function-name $entry.functionName --output json) -join '') | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or $confirmed.CodeSha256 -ne $sha256 -or $confirmed.LastUpdateStatus -ne 'Successful') { throw 'Deployed Lambda hash verification failed.' }
        $receipt.completed += $entry.functionName
        $receipt.status = 'updating'
        $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
        Write-Output ($entry.functionName + ': deployed code hash verified.')
    }
    $receipt.status = 'complete'
    Write-Output 'ICB feature code released. No infrastructure was created and the local server was not restarted.'
} catch {
    $receipt.status = 'incomplete'
    throw
} finally {
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
    Write-Output ('Release receipt: ' + $receiptFile)
}
