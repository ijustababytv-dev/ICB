'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const {
    buildPlan,
    parseCredentials,
    signParameters,
    verifiedRecord,
    compareImages
} = require('./cloudinary-plan');

/** Read Cloudinary metadata without exposing credentials or provider error bodies. */
async function readMetadata(credentials, route, body, request) {
    let response;
    try {
        response = await request(
            `https://api.cloudinary.com/v1_1/${credentials.cloudName}/${route}`,
            {
                method: body ? 'POST' : 'GET',
                body: body ? JSON.stringify(body) : undefined,
                redirect: 'error',
                signal: AbortSignal.timeout(30000),
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${Buffer.from(
                        `${credentials.apiKey}:${credentials.apiSecret}`
                    ).toString('base64')}`
                }
            }
        );
    } catch {
        throw new Error('Cloudinary comparison failed: connection error. No images were uploaded.');
    }
    if (!response.ok)
        throw new Error(
            `Cloudinary comparison failed (HTTP ${response.status}). Check credentials and API quota.`
        );
    try {
        return await response.json();
    } catch {
        throw new Error('Invalid Cloudinary comparison response.');
    }
}

/** Follow both listing and search pagination without allowing another project into the inventory. */
async function readPages(credentials, search, request) {
    const images = [];
    const cursors = new Set();
    let cursor;
    do {
        const parameters = search
            ? {
                  expression: 'resource_type:image AND type:upload AND public_id:icb/*',
                  max_results: 500
              }
            : { prefix: 'icb/', max_results: '500' };
        if (cursor) parameters.next_cursor = cursor;
        const page = await readMetadata(
            credentials,
            search
                ? 'resources/search'
                : `resources/image/upload?${new URLSearchParams(parameters)}`,
            search ? parameters : undefined,
            request
        );
        if (
            !Array.isArray(page.resources) ||
            page.resources.some((item) => !item.public_id?.startsWith('icb/'))
        ) {
            throw new Error('Unexpected Cloudinary image listing.');
        }
        images.push(...page.resources);
        cursor = page.next_cursor;
        if (cursor && cursors.has(cursor))
            throw new Error('Repeated Cloudinary pagination cursor.');
        if (cursor) cursors.add(cursor);
    } while (cursor);
    return images;
}

/** Hash a delivered original when it is too recent for Cloudinary's checksum search index. */
async function checksumOriginal(image, cloudName, request) {
    let url;
    try {
        url = new URL(image.secure_url);
    } catch {
        throw new Error('Missing Cloudinary original URL.');
    }
    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'res.cloudinary.com' ||
        url.username ||
        url.password ||
        !url.pathname.startsWith(`/${cloudName}/image/upload/`)
    )
        throw new Error('Unexpected Cloudinary original URL.');
    let response;
    try {
        response = await request(url.toString(), {
            redirect: 'error',
            signal: AbortSignal.timeout(120000)
        });
    } catch {
        throw new Error(`Cannot compare Cloudinary original: ${image.public_id}`);
    }
    if (!response.ok)
        throw new Error(
            `Cannot compare Cloudinary original (HTTP ${response.status}): ${image.public_id}`
        );
    const hash = crypto.createHash('md5');
    let bytes = 0;
    for await (const chunk of response.body) {
        hash.update(chunk);
        bytes += chunk.length;
    }
    if (bytes !== image.bytes)
        throw new Error(`Cloudinary original size mismatch: ${image.public_id}`);
    return hash.digest('hex');
}

/** Combine the authoritative inventory with indexed checksums, downloading originals when indexing lags. */
async function listImages(credentials, request = fetch) {
    const images = await readPages(credentials, false, request);
    if (!images.length) return images;
    // The ordinary listing omits checksums. Search supplies them in batches, avoiding one API call per file.
    const indexed = new Map(
        (await readPages(credentials, true, request)).map((item) => [item.public_id, item])
    );
    const results = [];
    for (const current of images) {
        const candidate = indexed.get(current.public_id);
        if (
            candidate &&
            candidate.asset_id === current.asset_id &&
            candidate.version === current.version &&
            /^[a-f0-9]{32}$/i.test(candidate.etag || '')
        ) {
            results.push({ ...current, etag: candidate.etag });
        } else {
            // Resource detail responses omit checksums too. Hash the current version's original bytes instead.
            results.push({
                ...current,
                etag: await checksumOriginal(current, credentials.cloudName, request)
            });
        }
    }
    return results;
}

/** Send original bytes only for new/changed files; replacement is limited to a matched project ID. */
async function uploadImage(root, item, credentials, request = fetch) {
    if (!['new', 'changed'].includes(item.action))
        throw new Error(`Upload requires a new or changed image: ${item.source}`);
    const bytes = fs.readFileSync(path.join(root, item.source));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
        throw new Error(`Image changed after inventory: ${item.source}`);
    }
    const parameters = {
        asset_folder: path.posix.dirname(item.publicId),
        display_name: path.posix.basename(item.source),
        overwrite: item.action === 'changed' ? 'true' : 'false',
        invalidate: 'true',
        public_id: item.publicId,
        tags: 'icb',
        timestamp: String(Math.floor(Date.now() / 1000))
    };
    const body = new FormData();
    for (const [key, value] of Object.entries(parameters)) body.set(key, value);
    body.set('api_key', credentials.apiKey);
    body.set('signature', signParameters(parameters, credentials.apiSecret));
    body.set('file', new Blob([bytes]), path.posix.basename(item.source));
    let response;
    try {
        response = await request(
            `https://api.cloudinary.com/v1_1/${credentials.cloudName}/image/upload`,
            {
                method: 'POST',
                body,
                redirect: 'error',
                signal: AbortSignal.timeout(120000)
            }
        );
    } catch {
        throw new Error(`Cloudinary connection failed: ${item.source}. Rerunning is safe.`);
    }
    if (!response.ok) {
        // Do not echo raw provider errors: signature failures may include credential-related details.
        throw new Error(
            `Cloudinary upload failed (HTTP ${response.status}): ${item.source}. Check credentials, quota and file limits.`
        );
    }
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error(`Invalid Cloudinary response: ${item.source}`);
    }
    return verifiedRecord(item, result, credentials.cloudName);
}

/** Persist only verified public asset metadata, using a sibling temporary file to avoid partial JSON. */
function saveManifest(file, manifest) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n');
    fs.renameSync(temporary, file);
}

/** Compare first; only --upload writes to Cloudinary. Every run reads the current remote inventory. */
async function main(args = process.argv.slice(2)) {
    if (
        args.some((arg) => !['--upload', '--dry-run', '--inventory'].includes(arg)) ||
        args.length > 1
    ) {
        throw new Error('Usage: node js/tools/cloudinary-sync.js [--dry-run|--upload|--inventory]');
    }
    const root = path.resolve(__dirname, '../..');
    const plan = buildPlan(root);
    const total = plan.reduce((sum, item) => sum + item.bytes, 0);
    console.info(
        `${plan.length} images; ${(total / 1024 / 1024).toFixed(
            2
        )} MiB; destination: icb/ with project folders preserved.`
    );
    if (args.includes('--inventory')) {
        console.info('Preview only. No network requests or uploads.');
        return;
    }
    const envFile = path.join(root, '.env.cloudinary');
    const local = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
    const credentials = parseCredentials(local.CLOUDINARY_URL || process.env.CLOUDINARY_URL);
    const comparison = compareImages(plan, await listImages(credentials));
    const counts = { new: 0, changed: 0, unchanged: 0 };
    for (const item of comparison) counts[item.action]++;
    console.info(`${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged.`);
    if (!args.includes('--upload')) {
        for (const item of comparison.filter((image) => image.action !== 'unchanged'))
            console.info(`${item.action}: ${item.source}`);
        console.info('Comparison only. No images were uploaded.');
        return;
    }
    const file = path.join(root, 'data/cloudinary-upload-manifest.json');
    const manifest = { cloudName: credentials.cloudName, syncedAt: null, images: [] };
    // Remote checksums make retries safe even when a previous run stopped before saving its manifest.
    for (const item of comparison) {
        const record =
            item.action === 'unchanged'
                ? verifiedRecord(item, item.existing, credentials.cloudName)
                : await uploadImage(root, item, credentials);
        manifest.images.push(record);
        manifest.syncedAt = new Date().toISOString();
        saveManifest(file, manifest);
        if (item.action !== 'unchanged')
            console.info(
                `[${manifest.images.length}/${plan.length}] ${item.action}: ${item.source}`
            );
    }
    console.info(
        `Finished: ${manifest.images.length} verified images. Manifest: data/cloudinary-upload-manifest.json`
    );
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });

module.exports = { listImages, checksumOriginal, uploadImage, saveManifest, main };
