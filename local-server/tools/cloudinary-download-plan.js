'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { IMAGE_EXTENSIONS, publicIdFor } = require('./cloudinary-plan');

/** Reject paths that Windows could reinterpret, including traversal and device filenames. */
function validateRelative(source) {
    if (
        typeof source !== 'string' ||
        source
            .split('/')
            .some(
                (part) =>
                    !part ||
                    part.startsWith('.') ||
                    /[<>:"\\|?*\x00-\x1f]/.test(part) ||
                    /[. ]$/.test(part) ||
                    part.length > 255 ||
                    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
            )
    )
        throw new Error('Unsafe Cloudinary destination path.');
    return source;
}

/** Recover uploader paths without a manifest; its display name preserves filename spelling. */
function originalSource(image, records = new Map()) {
    const match = /^icb\/(assets|images|docs)\/(.+)--([a-z0-9]+)$/.exec(image.public_id || '');
    if (!match || (match[3] !== 'original' && !IMAGE_EXTENSIONS.has('.' + match[3])))
        throw new Error(
            'Unrecognized ICB image ID. Download expects images from the ICB uploader.'
        );
    let source = `${match[1]}/${match[2]}${match[3] === 'original' ? '' : '.' + match[3]}`;
    const recorded = records.get(image.public_id);
    const displayed =
        typeof image.display_name === 'string' && !/[\/\\]/.test(image.display_name)
            ? path.posix.dirname(source) + '/' + image.display_name
            : null;
    for (const candidate of [recorded, displayed]) {
        if (!candidate) continue;
        validateRelative(candidate);
        if (
            publicIdFor(candidate, path.posix.extname(candidate).toLowerCase()) === image.public_id
        ) {
            source = candidate;
            break;
        }
    }
    validateRelative(source);
    if (!/^(assets|images|docs)\//.test(source)) throw new Error('Unexpected image root.');
    return source;
}

/** Keep original assets paths; other project images become excluded mirror copies under assets. */
function destinationFor(source) {
    validateRelative(source);
    if (
        source.split('/').some((part) => part.toLowerCase() === 'backups') ||
        /^assets\/cloudinary(?:\/|$)/i.test(source)
    )
        throw new Error('Cloudinary image uses a reserved download directory.');
    return source.startsWith('assets/') ? source : 'assets/cloudinary/' + source;
}

/** Walk every existing component without following links; optionally create ordinary directories. */
function assetFile(root, destination, createParents = false) {
    validateRelative(destination);
    if (!destination.startsWith('assets/')) throw new Error('Downloads must stay inside assets.');
    const parts = destination.split('/');
    let file = path.resolve(root);
    for (let i = 0; i < parts.length; i++) {
        file = path.join(file, parts[i]);
        const directory = i < parts.length - 1;
        let stat;
        try {
            stat = fs.lstatSync(file);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            if (directory && createParents) fs.mkdirSync(file);
            continue;
        }
        if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
            throw new Error(`Unsafe destination or linked path: ${destination}`);
    }
    return file;
}

/** Read local content for comparison and to catch edits made while a download is in progress. */
function fingerprint(root, destination) {
    const file = assetFile(root, destination);
    if (!fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file);
    return {
        bytes: bytes.length,
        md5: crypto.createHash('md5').update(bytes).digest('hex'),
        sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
}

/** Only download originals from this account; never follow arbitrary metadata URLs or redirects. */
function downloadUrl(image, cloudName) {
    let url;
    try {
        url = new URL(image.secure_url);
    } catch {
        throw new Error('Missing Cloudinary original URL.');
    }
    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'res.cloudinary.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith(`/${cloudName}/image/upload/`)
    )
        throw new Error('Unexpected Cloudinary original URL.');
    return url.toString();
}

/** Validate the entire inventory before writes; compare contents, not timestamps or file lengths alone. */
function buildDownloadPlan(root, images, cloudName, records = new Map()) {
    const seen = new Set();
    const plan = images.map((image) => {
        if (
            image.resource_type !== 'image' ||
            !IMAGE_EXTENSIONS.has('.' + image.format) ||
            !Number.isSafeInteger(image.bytes) ||
            image.bytes <= 0 ||
            !/^[a-f0-9]{32}$/i.test(image.etag || '')
        )
            throw new Error('Invalid Cloudinary image metadata or checksum.');
        const destination = destinationFor(originalSource(image, records));
        const key = destination.normalize('NFC').toLowerCase();
        if (seen.has(key)) throw new Error(`Download destination collision: ${destination}`);
        seen.add(key);
        const local = fingerprint(root, destination);
        return {
            destination,
            url: downloadUrl(image, cloudName),
            bytes: image.bytes,
            md5: image.etag.toLowerCase(),
            local,
            action: !local
                ? 'new'
                : local.md5 === image.etag.toLowerCase() && local.bytes === image.bytes
                ? 'unchanged'
                : 'changed'
        };
    });
    for (const key of seen) {
        const parts = key.split('/');
        while (parts.pop() && parts.length) {
            if (seen.has(parts.join('/'))) throw new Error('Download file/directory collision.');
        }
    }
    return plan.sort((a, b) => a.destination.localeCompare(b.destination));
}

module.exports = {
    originalSource,
    destinationFor,
    assetFile,
    fingerprint,
    downloadUrl,
    buildDownloadPlan
};
