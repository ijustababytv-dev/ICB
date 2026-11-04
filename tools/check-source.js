'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isSource, violations } = require('./source-policy');

/** Scan the entire index at commit time, so unstaged fixes cannot conceal a bad staged file. */
function checkProject(root, staged = false) {
    const args = ['ls-files', '-z', '--cached'];
    if (!staged) args.push('--others', '--exclude-standard');
    const files = [
        ...new Set(execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0'))
    ].filter(isSource);
    const errors = [];
    for (const file of files) {
        if (!staged && !fs.existsSync(path.join(root, file))) continue;
        const content = staged
            ? execFileSync('git', ['show', ':' + file], {
                  cwd: root,
                  encoding: 'utf8',
                  maxBuffer: 16 * 1024 * 1024
              })
            : fs.readFileSync(path.join(root, file), 'utf8');
        for (const error of violations(file, content)) errors.push(`${file}: ${error}`);
    }
    return errors;
}

/** Report every architectural violation without changing files or starting the application. */
function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== '--staged'))
        throw new Error('Usage: check-source.js [--staged]');
    const errors = checkProject(path.resolve(__dirname, '..'), args.includes('--staged'));
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exitCode = 1;
    } else
        console.info(
            'Source policy passed: folder boundaries, file sizes, root-server ban and image rules.'
        );
}

if (require.main === module) main();

module.exports = { checkProject };
