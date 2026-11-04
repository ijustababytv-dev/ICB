'use strict';
const { createHash } = require('node:crypto');

const LIMITS = { lines: 500, bytes: 40 * 1024 };
const VENDORS = new Map([
    [
        'ui/js/vendor/matter.min.js',
        '72d30be0f579eb02ce1e0b6f9d359a4f392e6837e5a26ba8be5dbee7f88e24ae'
    ],
    [
        'ui/js/vendor/meld-firehose.js',
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
        errors.push('Root server entry points are forbidden; use local-server/src/index.js.');
    const scripts =
        /^(?:local-server\/(?:src|bridge|tools|test|desktop\/js)\/|cloud-server\/(?:src|tools|test)\/|ui\/(?:js|test)\/|tools\/|test\/)/;
    if (/\.(?:[cm]?js|jsx|tsx?)$/i.test(name) && !scripts.test(name))
        errors.push(
            'JavaScript/TypeScript belongs in logical js or component source/test/tools folders.'
        );
    if (/\.html$/i.test(name) && !/^ui\/(?:html|desktop)\//.test(name))
        errors.push('HTML belongs in ui/html/.');
    if (/\.css$/i.test(name) && !name.startsWith('ui/css/')) errors.push('CSS belongs in ui/css/.');
    if (
        /^ui\/js\//.test(name) &&
        !VENDORS.has(name) &&
        /\brequire\s*\(|\bimport\s*(?:\(|[\s\S]{0,100}?\bfrom\b)/.test(content)
    )
        errors.push('UI scripts must use HTTP DTOs, never Node/server imports.');
    if (name.startsWith('ui/js/vendor/') && !VENDORS.has(name))
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
            errors.push('Executable inline scripts belong in ui/js/.');
    }
    if (/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{80}/i.test(content))
        errors.push('Embedded base64 images are forbidden.');
    return errors;
}

module.exports = { LIMITS, isSource, violations };
