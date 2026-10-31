'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { parseCredentials } = require('./cloudinary-plan');
const { listImages } = require('./cloudinary-sync');
const { assetFile, fingerprint, buildDownloadPlan } = require('./cloudinary-download-plan');

/** Use saved original spelling when available; downloads also work on a fresh checkout. */
function sourceRecords(root) {
    const file = path.join(root, 'data/cloudinary-upload-manifest.json');
    if (!fs.existsSync(file)) return new Map();
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(
            'Cannot read data/cloudinary-upload-manifest.json. Repair it before downloading.'
        );
    }
    if (!Array.isArray(manifest.images)) throw new Error('Invalid Cloudinary upload manifest.');
    return new Map(manifest.images.map((image) => [image.publicId, image.source]));
}

/** Stream binary bytes to a temporary file, refusing incomplete or unexpectedly large responses. */
async function receiveImage(item, temporary, request) {
    let response;
    try {
        response = await request(item.url, {
            redirect: 'error',
            signal: AbortSignal.timeout(120000)
        });
    } catch {
        throw new Error(`Cloudinary download connection failed: ${item.destination}`);
    }
    if (!response.ok)
        throw new Error(
            `Cloudinary download failed (HTTP ${response.status}): ${item.destination}`
        );
    const handle = await fs.promises.open(temporary, 'wx');
    const hash = crypto.createHash('md5');
    let bytes = 0;
    try {
        for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > item.bytes) throw new Error('Oversized download.');
            hash.update(chunk);
            await handle.writeFile(chunk);
        }
    } catch {
        throw new Error(`Interrupted or oversized image download: ${item.destination}`);
    } finally {
        await handle.close();
    }
    if (bytes !== item.bytes || hash.digest('hex') !== item.md5)
        throw new Error(`Downloaded image checksum or size mismatch: ${item.destination}`);
}

/** Preserve local edits made after planning, even when the remote image has already downloaded. */
function assertUnchanged(root, item) {
    const current = fingerprint(root, item.destination);
    if ((current?.sha256 || null) !== (item.local?.sha256 || null))
        throw new Error(
            `Local image changed during download; rerun comparison: ${item.destination}`
        );
}

/** Verify before replacement; keep a backup of changed originals and never delete local-only images. */
async function downloadImage(root, item, backupRun, request = fetch) {
    if (!['new', 'changed'].includes(item.action))
        throw new Error('Download requires a new or changed image.');
    assertUnchanged(root, item);
    const destination = assetFile(root, item.destination, true);
    const temporary = path.join(
        path.dirname(destination),
        `.icb-download-${crypto.randomUUID()}.tmp`
    );
    let backup = null;
    try {
        await receiveImage(item, temporary, request);
        assertUnchanged(root, item);
        if (item.local) {
            backup = `assets/backups/cloudinary-download/${backupRun}/${item.destination.slice(
                'assets/'.length
            )}`;
            const backupFile = assetFile(root, backup, true);
            fs.copyFileSync(destination, backupFile, fs.constants.COPYFILE_EXCL);
            assertUnchanged(root, item);
        }
        // A sibling rename publishes only a complete verified file; the old image survives any earlier failure.
        assetFile(root, item.destination);
        fs.renameSync(temporary, destination);
        return { destination: item.destination, backup };
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

/** Preview by default; --download pulls only new/changed ICB images and leaves Cloudinary untouched. */
async function main(args = process.argv.slice(2), options = {}) {
    if (args.length > 1 || args.some((arg) => !['--dry-run', '--download'].includes(arg)))
        throw new Error('Usage: node js/tools/cloudinary-download.js [--dry-run|--download]');
    const root = options.root || path.resolve(__dirname, '../..');
    const request = options.request || fetch;
    const envFile = path.join(root, '.env.cloudinary');
    const local = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
    const credentials = parseCredentials(local.CLOUDINARY_URL || process.env.CLOUDINARY_URL);
    const plan = buildDownloadPlan(
        root,
        await listImages(credentials, request),
        credentials.cloudName,
        sourceRecords(root)
    );
    const counts = { new: 0, changed: 0, unchanged: 0 };
    for (const item of plan) counts[item.action]++;
    console.info(
        `${plan.length} Cloudinary images: ${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged. Destination: assets/.`
    );
    if (!args.includes('--download')) {
        for (const item of plan.filter((image) => image.action !== 'unchanged'))
            console.info(`${item.action}: ${item.destination}`);
        console.info('Preview only. No local images were written.');
        return counts;
    }
    const backupRun = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID();
    let downloaded = 0;
    for (const item of plan) {
        if (item.action === 'unchanged') continue;
        const result = await downloadImage(root, item, backupRun, request);
        console.info(`${item.action}: ${result.destination}`);
        if (result.backup) console.info(`Previous local version: ${result.backup}`);
        downloaded++;
    }
    console.info(
        `Finished: ${downloaded} images downloaded and verified; ${counts.unchanged} identical files skipped.`
    );
    return counts;
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });

module.exports = { sourceRecords, downloadImage, main };
