param([switch]$Apply)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cloudRoot=Join-Path $projectRoot 'cloud-server'
$terraformRoot=Join-Path $projectRoot 'terraform'
. (Join-Path $projectRoot 'database/admin-env.ps1') -Role master
try {
    & npm.cmd run build --prefix $cloudRoot
    if ($LASTEXITCODE -ne 0) { throw 'Cloud package build failed.' }
    $artifact=Join-Path $projectRoot 'dist/baby-icb-cloud-server.zip'
    $sha=[Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($artifact))
    $hex=([BitConverter]::ToString($sha)).Replace('-','').ToLowerInvariant()
    $tfOutputArgs=@(('-chdir='+$terraformRoot),'output','-json')
    $outputs=((& terraform @tfOutputArgs) -join [Environment]::NewLine) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Terraform outputs unavailable.' }
    $region=if($env:TF_VAR_aws_region){$env:TF_VAR_aws_region}else{'us-east-1'}
    $key='releases/baby-icb-step1-'+$hex+'.zip'
    $uploadRaw=& aws s3api put-object --region $region --bucket $outputs.activity_artifact_bucket.value --key $key --body $artifact --output json
    if ($LASTEXITCODE -ne 0) { throw 'Versioned artifact upload failed.' }
    $upload=($uploadRaw -join '') | ConvertFrom-Json
    if (-not $upload.VersionId) { throw 'Immutable S3 version required.' }
    $configuration=@{activity_api_enabled=$true;activity_database_ready=$true;activity_release=@{key=$key;version_id=$upload.VersionId;sha256=[Convert]::ToBase64String($sha)}}
    $configuration | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $terraformRoot 'activity-release.auto.tfvars.json') -Encoding ASCII
    $planArgs=@(('-chdir='+$terraformRoot),'plan','-input=false','-no-color','-out=activity-release.tfplan')
    & terraform @planArgs
    if ($LASTEXITCODE -ne 0) { throw 'Release plan failed.' }
    $inspectArgs=@(('-chdir='+$terraformRoot),'show','-json','activity-release.tfplan')
    $planText=(& terraform @inspectArgs) -join ''
    if ($LASTEXITCODE -ne 0) { throw 'Release inspection failed.' }
    foreach($privateValue in @($env:TF_VAR_db_password,$env:TF_VAR_activity_db_password)) {
        if ([string]::IsNullOrEmpty($privateValue) -or $planText.Contains($privateValue)) { throw 'Release secret inspection failed.' }
    }
    $plan=$planText | ConvertFrom-Json
    $changes=@($plan.resource_changes | Where-Object {$_.change.actions -notcontains 'no-op'})
    if ($changes | Where-Object { $_.change.actions -contains 'delete' -or $_.type -eq 'aws_db_instance' }) {
        throw 'Release would delete a resource or change RDS. Review a separate infrastructure plan.'
    }
    if (-not $Apply) { Write-Output 'Release plan prepared. Review it before rerunning with -Apply.'; return }
    $applyArgs=@(('-chdir='+$terraformRoot),'apply','-input=false','-no-color','activity-release.tfplan')
    & terraform @applyArgs
    if ($LASTEXITCODE -ne 0) { throw 'Release apply failed.' }
    $urlArgs=@(('-chdir='+$terraformRoot),'output','-raw','activity_api_url')
    $url=& terraform @urlArgs
    if ($LASTEXITCODE -ne 0) { throw 'API URL output unavailable.' }
    $localFile=Join-Path $projectRoot 'local-server/.env'
    $existing=if(Test-Path -LiteralPath $localFile){[IO.File]::ReadAllLines($localFile)}else{@()}
    $lines=@($existing | Where-Object {$_ -notmatch '^ICB_CLOUD_API_URL='})+@('ICB_CLOUD_API_URL='+$url)
    [IO.File]::WriteAllLines($localFile,$lines)
    Write-Output 'Cloud API released and local API URL configured. The local server was not restarted.'
} finally {
    [Environment]::SetEnvironmentVariable('PGPASSWORD',$null,'Process')
}
