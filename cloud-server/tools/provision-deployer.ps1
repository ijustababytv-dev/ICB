param([string]$AdminProfile = 'Vox', [switch]$CreateAccessKey)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$credentialFile = Join-Path $projectRoot '.env.aws'
$userName = 'baby-icb-deployer'
if ($CreateAccessKey -and (Test-Path -LiteralPath $credentialFile) -and (Get-Item -LiteralPath $credentialFile).Length -gt 0) {
    throw 'Refusing to replace existing .env.aws credentials. Rotate keys deliberately.'
}
# This administrative bootstrap deliberately uses the explicit human profile,
# never the deployment credentials it is creating. No key enters Terraform state.
$accountId = (& aws sts get-caller-identity --profile $AdminProfile --query Account --output text)
if ($LASTEXITCODE -ne 0) { throw 'Administrative AWS access unavailable.' }
$targets = Get-Content (Join-Path $projectRoot 'cloud-server/config/release-targets.json') -Raw | ConvertFrom-Json
if ($accountId -ne $targets.accountId) { throw 'Administrative account does not match the ICB release target.' }
$bucket = $targets.artifactBucket
$functionArns = @()
$roleArns = @()
foreach ($functionName in $targets.functions) {
    $configuration = ((& aws lambda get-function-configuration --profile $AdminProfile --region $targets.region --function-name $functionName --output json) -join '') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Existing ICB Lambda configuration unavailable.' }
    $functionArns += $configuration.FunctionArn
    $roleArns += $configuration.Role
}
$users = ((& aws iam list-users --profile $AdminProfile --output json) -join '') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect IAM users.' }
if ($userName -notin $users.Users.UserName) {
    & aws iam create-user --profile $AdminProfile --user-name $userName --tags Key=Name,Value=$userName Key=Project,Value=baby-icb --output json | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'IAM user creation failed.' }
}
$policy = @{
    Version = '2012-10-17'
    Statement = @(
        @{ Sid='ICBExistingLambdaUpdates'; Effect='Allow'; Action=@('lambda:GetFunction','lambda:GetFunctionConfiguration','lambda:GetPolicy','lambda:ListTags','lambda:UpdateFunctionCode','lambda:UpdateFunctionConfiguration'); Resource=$functionArns },
        @{ Sid='ICBReleaseFiles'; Effect='Allow'; Action=@('s3:GetObject','s3:GetObjectVersion','s3:PutObject','s3:AbortMultipartUpload','s3:ListMultipartUploadParts'); Resource=@("arn:aws:s3:::${bucket}/releases/*") },
        @{ Sid='ICBPassExistingLambdaRoles'; Effect='Allow'; Action=@('iam:PassRole'); Resource=$roleArns; Condition=@{StringEquals=@{'iam:PassedToService'='lambda.amazonaws.com'}} }
    )
}
$policyFile = Join-Path ([IO.Path]::GetTempPath()) ('icb-deployer-policy-' + [Guid]::NewGuid().ToString('N') + '.json')
try {
    [IO.File]::WriteAllText($policyFile, ($policy | ConvertTo-Json -Depth 10))
    & aws iam put-user-policy --profile $AdminProfile --user-name $userName --policy-name baby-icb-deployer-releases --policy-document ('file://' + $policyFile)
    if ($LASTEXITCODE -ne 0) { throw 'Deployment policy update failed.' }
    $attached = ((& aws iam list-attached-user-policies --profile $AdminProfile --user-name $userName --output json) -join '') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect attached deployment policies.' }
    if ('arn:aws:iam::aws:policy/ReadOnlyAccess' -in $attached.AttachedPolicies.PolicyArn) {
        & aws iam detach-user-policy --profile $AdminProfile --user-name $userName --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
        if ($LASTEXITCODE -ne 0) { throw 'Cannot remove broad Terraform inspection permissions.' }
    }
} finally { Remove-Item -LiteralPath $policyFile -ErrorAction SilentlyContinue }
if ($CreateAccessKey) {
    & git -C $projectRoot check-ignore -q .env.aws
    if ($LASTEXITCODE -ne 0 -or (& git -C $projectRoot ls-files -- .env.aws)) { throw '.env.aws must be ignored and untracked before saving keys.' }
    # Restrict the destination before requesting the once-only secret response.
    [IO.File]::WriteAllText($credentialFile, '')
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $credentialFile /inheritance:r /grant:r "${identity}:(F)" '*S-1-5-18:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect credential file permissions.' }
    $created = ((& aws iam create-access-key --profile $AdminProfile --user-name $userName --output json) -join '') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $created.AccessKey.SecretAccessKey) { throw 'Access-key creation failed.' }
    try {
        $lines = @('# Private ICB deployment credentials. Never print, commit or upload this file.',
            ('AWS_ACCESS_KEY_ID=' + $created.AccessKey.AccessKeyId),
            ('AWS_SECRET_ACCESS_KEY=' + $created.AccessKey.SecretAccessKey),
            'AWS_REGION=us-east-1', 'AWS_DEFAULT_REGION=us-east-1')
        [IO.File]::WriteAllLines($credentialFile, $lines, [Text.UTF8Encoding]::new($false))
    } catch {
        & aws iam delete-access-key --profile $AdminProfile --user-name $userName --access-key-id $created.AccessKey.AccessKeyId | Out-Null
        throw 'Credential file write failed; attempted to revoke the unsaved access key.'
    } finally { $created = $null }
}
Write-Output "ICB deployment user configured: $userName. Credential values were not displayed."
