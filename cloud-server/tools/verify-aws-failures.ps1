$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$terraformRoot=Join-Path $projectRoot 'terraform'
$outputs=((& terraform ('-chdir='+$terraformRoot) output -json) -join '') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $outputs.feature_worker_name.value) { throw 'Deploy the worker first.' }
$worker=((& aws lambda get-function-configuration --function-name $outputs.feature_worker_name.value --output json) -join '') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Worker configuration unavailable.' }
$queueUrl=$outputs.feature_failure_queue_url.value
$queue=((& aws sqs get-queue-attributes --queue-url $queueUrl --attribute-names QueueArn --output json) -join '') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Failure queue unavailable.' }
$release=Get-Content (Join-Path $terraformRoot 'activity-release.auto.tfvars.json') -Raw | ConvertFrom-Json
$prefix='baby-icb-step2-check-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$target=Join-Path $projectRoot ('backups/'+$prefix)
[IO.Directory]::CreateDirectory($target) | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'cloud-server/test/fixtures/aws-failures/main.tf') -Destination $target
Copy-Item -LiteralPath (Join-Path $terraformRoot '.terraform.lock.hcl') -Destination $target
$variables=@{
    prefix=$prefix;worker_role=$worker.Role;worker_log_group=$worker.LoggingConfig.LogGroup
    environment=$worker.Environment.Variables;queue_arn=$queue.Attributes.QueueArn
    release=@{bucket=$outputs.activity_artifact_bucket.value;key=$release.activity_release.key;version=$release.activity_release.version_id;sha256=$release.activity_release.sha256}
    run_at=[DateTime]::UtcNow.AddMinutes(2).ToString('yyyy-MM-ddTHH:mm:ss')
}
$variables | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $target 'fixture.auto.tfvars.json') -Encoding ASCII
$pluginDir=Join-Path $terraformRoot '.terraform/providers'
$applied=$false
try {
    & terraform ('-chdir='+$target) init -input=false -no-color ('-plugin-dir='+$pluginDir) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture initialization failed.' }
    $applied=$true # Destroy also cleans up partial applies.
    & terraform ('-chdir='+$target) apply -input=false -auto-approve -no-color > (Join-Path $target 'apply.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Fixture apply failed; see private apply.txt.' }
    $function=(& terraform ('-chdir='+$target) output -raw failure_function) -join ''
    @{fixture=$prefix;kind='accepted-probe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'input.json') -Encoding ASCII
    & aws lambda invoke --function-name $function --invocation-type Event --payload ('fileb://'+(Join-Path $target 'input.json')) (Join-Path $target 'accepted.json') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Async invocation failed.' }
    $seen=@{accepted=$false;delivery=$false}
    $deadline=[DateTime]::UtcNow.AddMinutes(5)
    while ([DateTime]::UtcNow -lt $deadline -and -not ($seen.accepted -and $seen.delivery)) {
        $received=((& aws sqs receive-message --queue-url $queueUrl --max-number-of-messages 10 --wait-time-seconds 10 --visibility-timeout 5 --message-attribute-names All --output json) -join '')
        if ($LASTEXITCODE -ne 0) { throw 'Queue verification failed.' }
        if (-not $received) { continue }
        foreach($message in ($received | ConvertFrom-Json).Messages) {
            if (-not $message.Body.Contains($prefix)) {
                & aws sqs change-message-visibility --queue-url $queueUrl --receipt-handle $message.ReceiptHandle --visibility-timeout 0 | Out-Null
                continue
            }
            $body=$message.Body | ConvertFrom-Json
            $message.Body | Set-Content -LiteralPath (Join-Path $target ('message-'+$message.MessageId+'.json')) -Encoding UTF8
            if ($body.requestPayload.fixture -eq $prefix -and $body.requestContext.condition -eq 'RetriesExhausted') { $seen.accepted=$true }
            # Scheduler DLQ preserves the exact target input and includes delivery error attributes.
            if ($message.MessageAttributes.SCHEDULE_ARN.StringValue -like ('*'+$prefix+'*') -and $message.MessageAttributes.ERROR_CODE) { $seen.delivery=$true }
            @{fixture=$prefix;condition=$body.requestContext.condition;error_code=$message.MessageAttributes.ERROR_CODE.StringValue;accepted=$seen.accepted;delivery=$seen.delivery} |
                ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $target 'observations.jsonl') -Encoding ASCII
            & aws sqs delete-message --queue-url $queueUrl --receipt-handle $message.ReceiptHandle | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Fixture message cleanup failed.' }
        }
    }
    $seen | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'verification.json') -Encoding ASCII
    if (-not ($seen.accepted -and $seen.delivery)) { throw 'Both failure paths were not observed; inspect fixture metadata.' }
    Write-Output 'Verified Scheduler delivery failure and accepted Lambda execution failure in the private queue.'
} finally {
    if ($applied) {
        if ($prefix -notmatch '^baby-icb-step2-check-[a-f0-9]{8}$' -or (Split-Path -Parent ([IO.Path]::GetFullPath($target))) -ne (Join-Path $projectRoot 'backups')) { throw 'Unsafe fixture cleanup target.' }
        & terraform ('-chdir='+$target) destroy -input=false -auto-approve -no-color > (Join-Path $target 'destroy.txt')
        if ($LASTEXITCODE -ne 0) { Write-Error ('Fixture cleanup incomplete: '+$prefix) }
    }
}
