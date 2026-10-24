'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { violations, LIMITS } = require('../../tools/source-policy');
const { checkProject } = require('../../tools/check-source');
const root = path.resolve(__dirname, '../../..');

test('source ceilings reject excess lines and bytes independently, including renamed modules', () => {
    const lines = Array(LIMITS.lines).fill('// readable').join('\n');
    assert.deepEqual(violations('js/server/feature.js', lines), []);
    assert.match(violations('js/server/feature.js', lines + '\n// excess').join(), /500 lines/);
    assert.deepEqual(violations('js/client/page.js', 'x'.repeat(LIMITS.bytes)), []);
    assert.match(violations('js/client/page.js', 'x'.repeat(LIMITS.bytes + 1)).join(), /40 KB/);
    assert.match(violations('js/server/renamed.ts', 'x\n'.repeat(501)).join(), /500 lines/);
});

test('source layout rejects root entry points, misplaced pages and inline applications', () => {
    assert.match(violations('server.js', '// tiny forwarding stub').join(), /Root server/);
    assert.match(violations('server.cjs', '').join(), /Root server/);
    assert.match(violations('widget.ts', '').join(), /logical js/);
    assert.match(violations('page.html', '').join(), /HTML belongs/);
    assert.match(violations('style.css', '').join(), /CSS belongs/);
    assert.match(violations('html/page.html', '<script>run();</script>').join(), /inline scripts/);
    assert.deepEqual(
        violations('html/page.html', '<script src="/js/client/page.js"></script>'),
        []
    );
});

test('only unchanged approved vendor files receive a size exemption', () => {
    const file = 'js/vendor/matter.min.js';
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.deepEqual(violations(file, source), []);
    assert.deepEqual(violations(file, source.replace(/\r?\n/g, '\r\n')), []);
    assert.match(violations(file, source + '\ncustomFeature();').join(), /Vendor contents changed/);
    assert.match(violations('js/vendor/new.js', 'x'.repeat(41000)).join(), /New vendor exemptions/);
});

test('embedded image assets are rejected in each maintained source type', () => {
    const embedded = 'data:image/png;' + 'base64,' + 'A'.repeat(100);
    for (const file of ['js/client/page.js', 'html/page.html', 'css/page.css'])
        assert.match(violations(file, embedded).join(), /base64 images/);
    assert.deepEqual(violations('js/client/page.js', "image.src = '/assets/example.png';"), []);
});

test('current project satisfies the shared source policy', () => {
    assert.deepEqual(checkProject(root), []);
});

test('installed commit hook rejects a bad staged file even after the working copy is fixed', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-policy-test-'));
    /** Run Git only inside the disposable fixture repository. */
    function git(...args) {
        return execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: 'pipe' });
    }

    try {
        git('init');
        git('config', 'user.name', 'ICB Test');
        git('config', 'user.email', 'icb-test@example.invalid');
        git('config', 'commit.gpgsign', 'false');
        for (const file of [
            'js/tools/check-source.js',
            'js/tools/source-policy.js',
            'js/tools/install-hooks.js',
            '.githooks/pre-commit'
        ]) {
            const target = path.join(temp, file);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(root, file), target);
        }
        fs.chmodSync(path.join(temp, '.githooks/pre-commit'), 0o755);
        execFileSync(process.execPath, ['js/tools/install-hooks.js'], { cwd: temp, stdio: 'pipe' });
        const target = path.join(temp, 'js/feature.js');
        fs.writeFileSync(target, '// oversized\n'.repeat(501));
        git('add', '.');
        fs.writeFileSync(target, '// fixed but not yet staged\n');
        assert.deepEqual(checkProject(temp), []);
        assert.match(checkProject(temp, true).join(), /500 lines/);
        const rejected = spawnSync('git', ['commit', '-m', 'Must reject'], {
            cwd: temp,
            encoding: 'utf8'
        });
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr + rejected.stdout, /500 lines/);
        git('add', 'js/feature.js');
        git('commit', '-m', 'Valid focused module');
        assert.match(git('log', '-1', '--format=%s'), /Valid focused module/);
    } finally {
        assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
        assert.ok(path.basename(temp).startsWith('icb-policy-test-'));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
