'use strict';
const { createHash } = require('node:crypto');

const LIMITS = { lines: 500, bytes: 40 * 1024 };
const VENDORS = new Map([
    ['js/vendor/matter.min.js', '72d30be0f579eb02ce1e0b6f9d359a4f392e6837e5a26ba8be5dbee7f88e24ae'],
    [
        'js/vendor/meld-firehose.js',
        'b259235fa5d0dd8d24d3a77bc6e638a30cf2c3d08752dbf9012f4dc4f97152fe'
    ]
]);

/** Exclude state and operator artwork, never arbitrary folders or newly invented vendor exceptions. */
function isSource(file) {
    return (
        /\.(?:[cm]?js|jsx|tsx?|html|css)$/i.test(file) &&
        !file
            .split('/')
            .some((part) => ['.git', 'node_modules', 'assets', 'backups', 'data'].includes(part))
    );
}

/** Apply the same architectural boundaries to disk files, staged blobs and CI checkouts. */
function violations(file, content) {
    const errors = [];
    const name = file.replace(/\\/g, '/');
    if (!isSource(name)) return errors;
    if (/^server\.[cm]?js$/i.test(name))
        errors.push('Root server entry points are forbidden; use js/server/index.js.');
    if (/\.(?:[cm]?js|jsx|tsx?)$/i.test(name) && !name.split('/').includes('js'))
        errors.push('JavaScript/TypeScript belongs in a logical js/ folder.');
    if (/\.html$/i.test(name) && !name.startsWith('html/')) errors.push('HTML belongs in html/.');
    if (/\.css$/i.test(name) && !name.startsWith('css/')) errors.push('CSS belongs in css/.');
    if (name.startsWith('js/vendor/') && !VENDORS.has(name))
        errors.push('New vendor exemptions are forbidden.');
    // Normalize checkout line endings; custom code cannot borrow an existing vendor exemption.
    if (
        VENDORS.has(name) &&
        createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex') !==
            VENDORS.get(name)
    )
        errors.push('Vendor contents changed; review the distribution and its pinned checksum.');
    if (!VENDORS.has(name)) {
        if (content.trimEnd().split(/\r?\n/).length > LIMITS.lines)
            errors.push('Exceeds 500 lines; split by responsibility.');
        if (Buffer.byteLength(content) > LIMITS.bytes)
            errors.push('Exceeds 40 KB; extract focused modules or assets.');
        if (
            /\.html$/i.test(name) &&
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>\s*\S[\s\S]*?<\/script>/i.test(content)
        )
            errors.push('Executable inline scripts belong in js/client/.');
    }
    if (/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{80}/i.test(content))
        errors.push('Embedded base64 images are forbidden.');
    return errors;
}

module.exports = { LIMITS, isSource, violations };
