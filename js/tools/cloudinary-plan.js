'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.avif',
    '.bmp',
    '.tif',
    '.tiff',
    '.ico'
]);
const IMAGE_ROOTS = ['assets', 'images', 'docs'];

/** Recognize extensionless artwork without mistaking scripts or archives for images. */
function extensionlessFormat(bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
    if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
        return 'webp';
    return null;
}

/** Preserve project paths under icb; refuse ambiguous IDs instead of overwriting another file. */
function publicIdFor(relativePath, extension) {
    const stem = extension ? relativePath.slice(0, -extension.length) : relativePath;
    const segments = stem
        .split('/')
        .map((segment) => segment.replace(/[?&#\\%<>+\x00-\x1f]/g, '_').trim());
    if (
        segments.some(
            (segment) => !segment || segment === '.' || segment === '..' || /^v\d+$/.test(segment)
        )
    ) {
        throw new Error(`Unsupported image path: ${relativePath}`);
    }
    // A format suffix keeps foo.png, foo.jpg and extensionless foo distinct and stable across runs.
    const id = `icb/${segments.join('/')}--${extension ? extension.slice(1) : 'original'}`;
    if (id.length > 255) throw new Error(`Image path is too long: ${relativePath}`);
    return id;
}

/** Inventory only project artwork, including extensionless PNGs; never follow symlinks outside it. */
function buildPlan(root) {
    const plan = [];
    const seen = new Set();
    /** Visit ordinary files and directories; credentials, backups and generated test files are excluded. */
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || ['backups', 'node_modules'].includes(entry.name))
                continue;
            const file = path.join(directory, entry.name);
            // Downloaded copies of images/docs already have Cloudinary IDs; do not upload duplicates.
            if (
                path.relative(root, file).split(path.sep).join('/').toLowerCase() ===
                'assets/cloudinary'
            )
                continue;
            if (entry.isDirectory()) {
                visit(file);
                continue;
            }
            if (!entry.isFile()) continue;
            const extension = path.extname(entry.name).toLowerCase();
            if (extension && !IMAGE_EXTENSIONS.has(extension)) continue;
            const bytes = fs.readFileSync(file);
            const format = extension ? extension.slice(1) : extensionlessFormat(bytes);
            if (!format) continue;
            const source = path.relative(root, file).split(path.sep).join('/');
            const publicId = publicIdFor(source, extension);
            if (seen.has(publicId)) throw new Error(`Cloudinary ID collision: ${source}`);
            seen.add(publicId);
            plan.push({
                source,
                publicId,
                format,
                bytes: bytes.length,
                sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                md5: crypto.createHash('md5').update(bytes).digest('hex')
            });
        }
    }

    for (const name of IMAGE_ROOTS) {
        const directory = path.join(root, name);
        if (fs.existsSync(directory) && !fs.lstatSync(directory).isSymbolicLink()) visit(directory);
    }
    return plan.sort((a, b) => a.source.localeCompare(b.source));
}

/** Parse credentials without including a secret or a credential URL in any error. */
function parseCredentials(value) {
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'cloudinary:' ||
            !/^[a-z0-9][a-z0-9_-]*$/i.test(url.hostname) ||
            !url.username ||
            !url.password ||
            url.port ||
            url.search ||
            url.hash ||
            !['', '/'].includes(url.pathname)
        )
            throw new Error();
        return {
            cloudName: url.hostname,
            apiKey: decodeURIComponent(url.username),
            apiSecret: decodeURIComponent(url.password)
        };
    } catch {
        throw new Error(
            'Set a valid CLOUDINARY_URL in .env.cloudinary (Cloudinary Settings > API Keys).'
        );
    }
}

/** Sign upload parameters in the order required by Cloudinary; binary file data is sent separately. */
function signParameters(parameters, secret) {
    const serialized = Object.keys(parameters)
        .sort()
        .map((key) => `${key}=${parameters[key]}`)
        .join('&');
    return crypto
        .createHash('sha256')
        .update(serialized + secret)
        .digest('hex');
}

/** Accept only the expected asset with the original checksum and a Cloudinary HTTPS delivery URL. */
function verifiedRecord(item, response, cloudName) {
    let url;
    try {
        url = new URL(response.secure_url);
    } catch {
        throw new Error(`Missing delivery URL: ${item.source}`);
    }
    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'res.cloudinary.com' ||
        url.username ||
        url.password ||
        !url.pathname.startsWith(`/${cloudName}/image/upload/`)
    )
        throw new Error(`Unexpected delivery URL: ${item.source}`);
    if (
        response.public_id !== item.publicId ||
        response.resource_type !== 'image' ||
        response.bytes !== item.bytes ||
        response.etag !== item.md5
    ) {
        throw new Error(`Cloudinary image does not match the local original: ${item.source}`);
    }
    // Whitelist fields: upload responses can also contain account credentials and signatures.
    return {
        source: item.source,
        sha256: item.sha256,
        bytes: item.bytes,
        publicId: response.public_id,
        url: response.secure_url,
        assetId: response.asset_id,
        width: response.width,
        height: response.height,
        format: response.format
    };
}

/** Compare actual remote checksums, never modification times or a possibly stale local manifest. */
function compareImages(plan, remoteImages) {
    const remote = new Map(remoteImages.map((image) => [image.public_id, image]));
    return plan.map((item) => {
        const existing = remote.get(item.publicId);
        if (existing && !/^[a-f0-9]{32}$/i.test(existing.etag || '')) {
            throw new Error(`Cloudinary did not return a checksum: ${item.source}`);
        }
        const action = !existing
            ? 'new'
            : existing.etag === item.md5 && existing.bytes === item.bytes
            ? 'unchanged'
            : 'changed';
        return { ...item, action, existing };
    });
}

module.exports = {
    IMAGE_EXTENSIONS,
    buildPlan,
    extensionlessFormat,
    publicIdFor,
    parseCredentials,
    signParameters,
    verifiedRecord,
    compareImages
};
