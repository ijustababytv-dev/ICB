'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');

/** Enumerate maintained source only; runtime state and local art are not source code. */
function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (['.git', 'node_modules', 'assets', 'backups', 'data'].includes(entry.name)) return [];
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? files(file) : [file];
    });
}

const source = files(root);

test('all HTML lives under html and JavaScript lives in logical js folders', () => {
    for (const file of source) {
        const relative = path.relative(root, file).split(path.sep);
        if (file.endsWith('.html')) assert.equal(relative[0], 'html', file);
        if (/\.[cm]?js$/.test(file)) assert.ok(relative.includes('js'), file);
    }
});
test('maintained source stays within 500 lines and 40 KB; vendor distributions are exempt', () => {
    for (const file of source.filter(
        (f) => /\.(js|html|css)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`)
    )) {
        const text = fs.readFileSync(file, 'utf8');
        assert.ok(
            text.trimEnd().split(/\r?\n/).length <= 500,
            `Split this file by responsibility: ${path.relative(root, file)}`
        );
        assert.ok(
            Buffer.byteLength(text) <= 40 * 1024,
            `Oversized source file: ${path.relative(root, file)}`
        );
    }
});
test('scripts, HTML, and CSS contain no embedded base64 image assets', () => {
    for (const file of source.filter((f) => /\.(js|html|css)$/.test(f)))
        assert.doesNotMatch(
            fs.readFileSync(file, 'utf8'),
            /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{80}/i,
            file
        );
});
test('all application JavaScript parses after the file moves', () => {
    for (const file of source.filter((f) => f.endsWith('.js')))
        new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
});
test('HTML references existing local scripts, styles, and extracted images', () => {
    for (const file of source.filter((f) => f.endsWith('.html'))) {
        const html = fs.readFileSync(file, 'utf8');
        for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
            const url = match[1];
            if (!/^(\/|\.\.\/)(js|css|images)\//.test(url)) continue;
            const target = url.startsWith('/')
                ? path.join(root, decodeURIComponent(url))
                : path.resolve(path.dirname(file), decodeURIComponent(url));
            assert.ok(fs.existsSync(target), `${file}: ${url}`);
        }
    }
});
test('feature modules have no circular imports', () => {
    const graph = new Map();
    for (const file of source.filter(
        (f) => f.startsWith(path.join(root, 'js', 'server')) && f.endsWith('.js')
    )) {
        const refs = [
            ...fs.readFileSync(file, 'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)
        ].map((m) => path.resolve(path.dirname(file), m[1]) + (m[1].endsWith('.js') ? '' : '.js'));
        graph.set(file, refs);
    }
    /** Follow the current branch to reject cycles while allowing shared utilities. */
    function visit(file, stack, done) {
        assert.ok(
            !stack.includes(file),
            `Circular import: ${[...stack, file].map((f) => path.relative(root, f)).join(' -> ')}`
        );
        if (done.has(file)) return;
        for (const dependency of graph.get(file) || []) visit(dependency, [...stack, file], done);
        done.add(file);
    }

    const done = new Set();
    for (const file of graph.keys()) visit(file, [], done);
});
