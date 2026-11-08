'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const targets = require('../../../cloud-server/config/release-targets.json');

/** Execute the real release orchestration with synthetic files and an in-process AWS stub. */
function release({
    apply = false,
    wrongAccount = false,
    failSecond = false,
    matching = false
} = {}) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-code-release-'));
    try {
        for (const file of [
            'tools/aws-env.ps1',
            'cloud-server/tools/release-features.ps1',
            'cloud-server/config/release-targets.json'
        ]) {
            const destination = path.join(folder, file);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(root, file), destination);
        }
        fs.writeFileSync(
            path.join(folder, '.env.aws'),
            'AWS_ACCESS_KEY_ID=fixture\nAWS_SECRET_ACCESS_KEY=fixture\n'
        );
        const artifact = Buffer.from('synthetic release artifact');
        fs.writeFileSync(path.join(folder, 'fixture.zip'), artifact);
        const hash = createHash('sha256').update(artifact).digest('base64');
        const runner = `
$ErrorActionPreference='Stop'
$global:icbReleaseCalls=@()
$global:icbReleaseUpdated=@{}
$global:icbReleaseExpectedHash='${hash}'
function global:terraform { throw 'Terraform must never run in a feature release.' }
function global:python {
    $global:LASTEXITCODE=0
    [IO.Directory]::CreateDirectory((Join-Path $PSScriptRoot 'dist')) | Out-Null
    Copy-Item (Join-Path $PSScriptRoot 'fixture.zip') (Join-Path $PSScriptRoot 'dist/baby-icb-cloud-server.zip')
}
function global:aws {
    $arguments=@($args)
    $global:icbReleaseCalls+=,@($arguments)
    $global:LASTEXITCODE=0
    if ($arguments[0] -eq 'sts') {
        Write-Output '{"Account":"${wrongAccount ? '000000000000' : targets.accountId}"}'
        return
    }
    $nameIndex=[array]::IndexOf($arguments,'--function-name')
    $functionName=if($nameIndex -ge 0){$arguments[$nameIndex+1]}else{''}
    if ($arguments[0] -eq 'lambda' -and $arguments[1] -eq 'get-function-configuration') {
        $sha=if($global:icbReleaseUpdated[$functionName] -or $${matching}){$global:icbReleaseExpectedHash}else{'old-code'}
        @{State='Active';LastUpdateStatus='Successful';CodeSha256=$sha;RevisionId='original-revision'} | ConvertTo-Json
        return
    }
    if ($arguments[0] -eq 's3api' -and $arguments[1] -eq 'put-object') { Write-Output '{"VersionId":"fixture-version"}'; return }
    if ($arguments[0] -eq 'lambda' -and $arguments[1] -eq 'update-function-code') {
        if ($${failSecond} -and $functionName -eq '${
            targets.functions[1]
        }') { $global:LASTEXITCODE=1; return }
        $global:icbReleaseUpdated[$functionName]=$true
        Write-Output '{}'
        return
    }
    if ($arguments[0] -eq 'lambda' -and $arguments[1] -eq 'wait') { return }
    throw 'Unexpected AWS operation in a code-only release.'
}
$failure=$null
try { & (Join-Path $PSScriptRoot 'cloud-server/tools/release-features.ps1') -Apply:$${apply} }
catch { $failure=$_.Exception.Message }
@{error=$failure;calls=$global:icbReleaseCalls} | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $PSScriptRoot 'result.json')
`;
        fs.writeFileSync(path.join(folder, 'runner.ps1'), runner);
        execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-File', path.join(folder, 'runner.ps1')],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        const result = JSON.parse(
            fs.readFileSync(path.join(folder, 'result.json'), 'utf8').replace(/^\uFEFF/, '')
        );
        const history = path.join(folder, 'backups/releases');
        result.receipts = fs.existsSync(history)
            ? fs
                  .readdirSync(history)
                  .map((file) =>
                      JSON.parse(
                          fs.readFileSync(path.join(history, file), 'utf8').replace(/^\uFEFF/, '')
                      )
                  )
            : [];
        return result;
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
}

test(
    'feature preview and matching packages never upload or update AWS resources',
    { skip: process.platform !== 'win32' },
    () => {
        for (const options of [{}, { apply: true, matching: true }]) {
            const result = release(options);
            assert.equal(result.error, null);
            assert.ok(
                result.calls.every(
                    (call) => call[0] === 'sts' || call[1] === 'get-function-configuration'
                )
            );
            assert.equal(result.receipts.length, 0);
        }
    }
);

test(
    'feature release refuses a mismatched AWS account before uploads or Lambda access',
    { skip: process.platform !== 'win32' },
    () => {
        const result = release({ apply: true, wrongAccount: true });
        assert.match(result.error, /does not match/);
        assert.equal(result.calls.length, 1);
        assert.equal(result.receipts.length, 0);
    }
);

test(
    'feature release updates only the two configured Lambdas with revision fencing and hash readback',
    { skip: process.platform !== 'win32' },
    () => {
        const result = release({ apply: true });
        assert.equal(result.error, null);
        const updates = result.calls.filter((call) => call[1] === 'update-function-code');
        assert.deepEqual(
            updates.map((call) => call[call.indexOf('--function-name') + 1]),
            targets.functions
        );
        assert.ok(
            updates.every((call) => call[call.indexOf('--revision-id') + 1] === 'original-revision')
        );
        assert.equal(result.receipts[0].status, 'complete');
        assert.deepEqual(result.receipts[0].completed, targets.functions);
    }
);

test(
    'partial feature release retains an incomplete receipt rather than reporting success',
    { skip: process.platform !== 'win32' },
    () => {
        const result = release({ apply: true, failSecond: true });
        assert.match(result.error, /Lambda update failed/);
        assert.equal(result.receipts[0].status, 'incomplete');
        assert.deepEqual(result.receipts[0].completed, [targets.functions[0]]);
    }
);
