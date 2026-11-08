'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const loader = path.resolve(__dirname, '../../../tools/aws-env.ps1');

/** Run the real loader only against synthetic credentials in an isolated child process. */
function load(contents, expression) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-aws-env-'));
    const file = path.join(folder, 'fixture.env');
    fs.writeFileSync(file, contents);
    try {
        return execFileSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `$ErrorActionPreference='Stop'; . '${loader.replace(
                    /'/g,
                    "''"
                )}' -Path '${file.replace(/'/g, "''")}'; ${expression}`
            ],
            {
                encoding: 'utf8',
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    AWS_PROFILE: 'stale-profile',
                    AWS_SESSION_TOKEN: 'stale-token',
                    AWS_ACCESS_KEY_ID: 'ambient-key',
                    AWS_SECRET_ACCESS_KEY: 'ambient-secret'
                }
            }
        );
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
}

test(
    'AWS dotenv loads literal credentials and clears conflicting profiles and session tokens',
    { skip: process.platform !== 'win32' },
    () => {
        const output = load(
            '# fixture\nAWS_ACCESS_KEY_ID="test-key"\nAWS_SECRET_ACCESS_KEY=literal$(throw)\nAWS_REGION=us-east-1\n',
            "if ($env:AWS_ACCESS_KEY_ID -ne 'test-key' -or $env:AWS_SECRET_ACCESS_KEY -ne 'literal$(throw)' -or $env:AWS_PROFILE -or $env:AWS_SESSION_TOKEN -or $env:AWS_DEFAULT_REGION -ne 'us-east-1') { throw 'Isolation failed' }; Write-Output 'verified'"
        );
        assert.match(output, /verified/);
        assert.doesNotMatch(output, /test-key|literal\$|ambient-secret/);
    }
);

test(
    'AWS dotenv refuses unsupported, duplicate and incomplete settings without printing their contents',
    { skip: process.platform !== 'win32' },
    () => {
        for (const contents of [
            'AWS_ACCESS_KEY_ID=test-key\n',
            'AWS_ACCESS_KEY_ID=test-key\nAWS_SECRET_ACCESS_KEY=dummy\nAWS_PROFILE=forbidden\n',
            'AWS_ACCESS_KEY_ID=test-key\nAWS_SECRET_ACCESS_KEY=dummy\nAWS_SECRET_ACCESS_KEY=repeated\n'
        ]) {
            assert.throws(
                () => load(contents, "throw 'Must not reach this point'"),
                (error) => {
                    assert.doesNotMatch(
                        error.stderr.toString(),
                        /dummy|test-key|repeated\n|forbidden/
                    );
                    assert.match(error.stderr.toString(), /incomplete|Unsupported or repeated/);
                    return true;
                }
            );
        }
    }
);
