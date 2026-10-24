'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Find pinned development tools supplied by npm exec without adding application dependencies. */
function developmentTool(name) {
    const directories = [
        process.env.ICB_FORMAT_TOOL_DIR,
        ...(process.env.PATH || '').split(path.delimiter).map((entry) => path.dirname(entry))
    ].filter(Boolean);
    for (const directory of directories) {
        try {
            return require(require.resolve(name, { paths: [directory] }));
        } catch (error) {
            if (error.code !== 'MODULE_NOT_FOUND') throw error;
        }
    }
    throw new Error('Run this tool with npm run format:js or npm run format:check.');
}

/** Identify standalone definitions; callbacks inside calls retain the formatter's normal layout. */
function isDefinition(node) {
    const functionValue = (value) =>
        value && ['FunctionExpression', 'ArrowFunctionExpression'].includes(value.type);

    return (
        node.type === 'FunctionDeclaration' ||
        (node.type === 'VariableDeclaration' &&
            node.declarations.some((declaration) => functionValue(declaration.init))) ||
        (node.type === 'ExpressionStatement' &&
            node.expression.type === 'AssignmentExpression' &&
            functionValue(node.expression.right)) ||
        (node.type === 'Property' &&
            (node.kind === 'get' ||
                node.kind === 'set' ||
                node.method ||
                functionValue(node.value))) ||
        node.type === 'MethodDefinition'
    );
}

/** Separate definitions and their following documentation without touching string or template data. */
function separateFunctions(source, parser) {
    const tree = parser.parse(source, { ecmaVersion: 'latest', locations: true });
    const lines = source.split('\n');
    const boundaries = new Set();

    /** Locate complete definition lines, including getters and setters in shared-state objects. */
    function visit(node) {
        if (isDefinition(node)) boundaries.add(node.loc.end.line);
        for (const [key, value] of Object.entries(node)) {
            if (key === 'loc') continue;
            for (const child of Array.isArray(value) ? value : [value]) {
                if (child && typeof child === 'object' && child.type) visit(child);
            }
        }
    }

    visit(tree);
    for (const boundary of [...boundaries].sort((a, b) => b - a)) {
        const next = lines[boundary];
        if (next?.trim() && !/^\s*[}\])]/.test(next)) lines.splice(boundary, 0, '');
    }
    return lines.join('\n');
}

/** Read project scripts, including local asset utilities, while keeping vendor distributions intact. */
function projectScripts(root) {
    const files = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        {
            cwd: root,
            encoding: 'utf8'
        }
    ).split('\0');

    /** Include operator-managed JavaScript utilities without visiting backups or linked directories. */
    function assets(directory) {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || ['backups', 'node_modules'].includes(entry.name))
                continue;
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) assets(file);
            else if (entry.isFile())
                files.push(path.relative(root, file).split(path.sep).join('/'));
        }
    }

    assets(path.join(root, 'assets'));
    return [...new Set(files)]
        .filter(
            (file) =>
                /\.[cm]?js$/.test(file) &&
                !file.startsWith('js/vendor/') &&
                fs.existsSync(path.join(root, file))
        )
        .sort();
}

/** Normalize source locations and spelling so formatting must preserve the parsed program. */
function syntaxOnly(key, value) {
    return ['start', 'end', 'raw'].includes(key) ? undefined : value;
}

/** Apply the project's layout and function spacing, rejecting any change to parsed code. */
function main() {
    const write = process.argv.includes('--write');
    const root = path.resolve(__dirname, '../..');
    const prettier = developmentTool('prettier');
    const parser = developmentTool('acorn');
    const options = JSON.parse(fs.readFileSync(path.join(root, '.prettierrc.json'), 'utf8'));
    const files = projectScripts(root);
    let changed = 0;
    for (const file of files) {
        const fullPath = path.join(root, file);
        const before = fs.readFileSync(fullPath, 'utf8');
        const after = separateFunctions(
            prettier.format(before, { ...options, parser: 'babel' }),
            parser
        );
        const originalTree = JSON.stringify(
            parser.parse(before, { ecmaVersion: 'latest' }),
            syntaxOnly
        );
        const formattedTree = JSON.stringify(
            parser.parse(after, { ecmaVersion: 'latest' }),
            syntaxOnly
        );
        if (originalTree !== formattedTree)
            throw new Error(`Formatting changed parsed code: ${file}`);
        if (before === after) continue;
        changed++;
        if (write) fs.writeFileSync(fullPath, after);
        else console.error(`Formatting needed: ${file}`);
    }
    console.info(
        `${files.length} JavaScript files checked; ${changed} ${
            write ? 'formatted' : 'need formatting'
        }.`
    );
    if (changed && !write) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { isDefinition, separateFunctions };
