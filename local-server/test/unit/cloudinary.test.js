'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    buildPlan,
    publicIdFor,
    parseCredentials,
    signParameters,
    verifiedRecord,
    compareImages
} = require('../../tools/cloudinary-plan');
const {
    uploadImage,
    listImages,
    checksumOriginal,
    saveManifest
} = require('../../tools/cloudinary-sync');
const credentials = { cloudName: 'test-cloud', apiKey: 'test-key', apiSecret: 'test-secret' };

/** Make isolated fixture files, never using or changing the user's actual artwork. */
function fixture(t, files = { 'assets/card.png': 'original pixels' }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-cloudinary-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return root;
}

/** Provide the relevant fields of a genuine Cloudinary response without live credentials. */
function remote(item, overrides = {}) {
    return {
        public_id: item.publicId,
        resource_type: 'image',
        version: 1,
        etag: item.md5,
        bytes: item.bytes,
        asset_id: 'fixture-asset',
        width: 2048,
        height: 768,
        format: item.format,
        secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${item.publicId}.png`,
        ...overrides
    };
}

test('inventory includes project images and extensionless PNGs, excluding scripts, secrets and backups', (t) => {
    const root = fixture(t, {
        'assets/cards/card.PNG': 'pixels',
        'assets/screens/extensionless': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        'assets/screens/not-an-image': 'some text',
        'assets/run.js': 'script',
        'assets/music.mp3': 'audio',
        'assets/.secret.png': 'secret',
        'assets/backups/old.png': 'old',
        'backups/card.png': 'old',
        '.env.cloudinary': 'credential',
        'images/extracted.png': 'image',
        'docs/template.svg': '<svg/>',
        'data/private.png': 'private'
    });
    assert.deepEqual(
        buildPlan(root).map((item) => item.source),
        [
            'assets/cards/card.PNG',
            'assets/screens/extensionless',
            'docs/template.svg',
            'images/extracted.png'
        ]
    );
});

test('IDs preserve folders and distinguish formats and extensionless files with the same name', (t) => {
    const root = fixture(t, {
        'assets/card.png': 'png',
        'assets/card.jpg': 'jpg',
        'assets/card': Buffer.from([255, 216, 255, 0]),
        'assets/other/card.png': 'other'
    });
    const plan = buildPlan(root);
    assert.equal(new Set(plan.map((item) => item.publicId)).size, 4);
    assert.equal(
        publicIdFor('assets/screens/BE RIGHT BACK.PNG', '.png'),
        'icb/assets/screens/BE RIGHT BACK--png'
    );
    assert.throws(() => publicIdFor('../private.png', '.png'), /Unsupported/);
});

test('filename normalization collisions stop before uploading', (t) => {
    const root = fixture(t, { 'assets/a+b.png': 'one', 'assets/a_b.png': 'two' });
    assert.throws(() => buildPlan(root), /collision/);
});

test('comparison uploads new or changed content and skips identical files', (t) => {
    const root = fixture(t, {
        'assets/new.png': 'new',
        'assets/changed.png': 'change',
        'assets/same.png': 'same'
    });
    const plan = buildPlan(root);
    const results = compareImages(plan, [
        remote(plan[0], { etag: '0'.repeat(32) }),
        remote(plan[2]),
        { public_id: 'icb/cloud-only', etag: '1'.repeat(32), bytes: 100 }
    ]);
    assert.deepEqual(
        results.map((item) => [item.source, item.action]),
        [
            ['assets/changed.png', 'changed'],
            ['assets/new.png', 'new'],
            ['assets/same.png', 'unchanged']
        ]
    );
    assert.equal(results.length, plan.length, 'cloud-only files never become delete operations');
});

test('comparison trusts current Cloudinary checksums even if file lengths match', (t) => {
    const [item] = buildPlan(fixture(t));
    assert.equal(
        compareImages([item], [remote(item, { etag: 'f'.repeat(32) })])[0].action,
        'changed'
    );
    assert.throws(() => compareImages([item], [remote(item, { etag: undefined })]), /checksum/);
});

test('credential parsing decodes credentials and keeps malformed secrets out of errors', () => {
    assert.deepEqual(
        parseCredentials('cloudinary://test-key:test%2Dsecret@test-cloud'),
        credentials
    );
    for (const value of [
        undefined,
        '',
        'test-secret',
        'https://test-key:test-secret@test-cloud',
        'cloudinary://test-key:test-secret@test-cloud/elsewhere'
    ]) {
        assert.throws(
            () => parseCredentials(value),
            (error) => !error.message.includes('test-secret')
        );
    }
});

test('signature is independent of parameter order and changes with upload intent', () => {
    const original = signParameters({ timestamp: '1', overwrite: 'false' }, 'test-secret');
    assert.equal(original, signParameters({ overwrite: 'false', timestamp: '1' }, 'test-secret'));
    assert.notEqual(original, signParameters({ timestamp: '1', overwrite: 'true' }, 'test-secret'));
    assert.match(original, /^[a-f0-9]{64}$/);
});

test('verified records reject wrong content or delivery URLs and omit credentials', (t) => {
    const [item] = buildPlan(fixture(t));
    const record = verifiedRecord(
        item,
        remote(item, { api_key: 'test-key', signature: 'private' }),
        'test-cloud'
    );
    assert.equal(record.source, item.source);
    assert.equal(record.sha256, item.sha256);
    assert.equal(record.api_key, undefined);
    assert.equal(record.signature, undefined);
    for (const patch of [
        { etag: 'bad' },
        { bytes: 0 },
        { public_id: 'another' },
        { resource_type: 'raw' },
        { secure_url: 'https://example.com/file.png' },
        { secure_url: 'http://res.cloudinary.com/test-cloud/image/upload/a' }
    ]) {
        assert.throws(() => verifiedRecord(item, remote(item, patch), 'test-cloud'));
    }
});

test('listing retrieves every page and obtains checksums in a batch', async () => {
    const requests = [];
    const first = { public_id: 'icb/one', asset_id: 'one', version: 1 };
    const second = { public_id: 'icb/two', asset_id: 'two', version: 1 };
    const result = await listImages(credentials, async (address, options) => {
        const url = new URL(address);
        if (url.pathname.endsWith('/search')) {
            assert.equal(
                JSON.parse(options.body).expression,
                'resource_type:image AND type:upload AND public_id:icb/*'
            );
            return {
                ok: true,
                json: async () => ({
                    resources: [first, second].map((item) => ({ ...item, etag: 'a'.repeat(32) }))
                })
            };
        }
        requests.push(url);
        assert.equal(url.searchParams.get('prefix'), 'icb/');
        assert.equal(url.searchParams.get('max_results'), '500');
        return {
            ok: true,
            json: async () =>
                requests.length === 1
                    ? { resources: [first], next_cursor: 'second-page' }
                    : { resources: [second] }
        };
    });
    assert.equal(requests[1].searchParams.get('next_cursor'), 'second-page');
    assert.equal(result.length, 2);
    assert.equal(result[0].etag, 'a'.repeat(32));
});

test('stale search checksums are replaced by hashing the current original', async (t) => {
    const root = fixture(t);
    const [item] = buildPlan(root);
    const current = remote(item, { version: 2 });
    let downloads = 0;
    const result = await listImages(credentials, async (address) => {
        const url = new URL(address);
        if (url.hostname === 'res.cloudinary.com') {
            downloads++;
            return new Response(fs.readFileSync(path.join(root, item.source)));
        }
        const data = url.pathname.endsWith('/search')
            ? { resources: [{ ...current, version: 1, etag: 'a'.repeat(32) }] }
            : { resources: [current] };
        return { ok: true, json: async () => data };
    });
    assert.equal(downloads, 1);
    assert.equal(result[0].etag, item.md5);
});

test('original comparison rejects outside URLs, missing files and truncated downloads', async (t) => {
    const [item] = buildPlan(fixture(t));
    await assert.rejects(
        checksumOriginal(
            remote(item, { secure_url: 'https://example.com/image' }),
            'test-cloud',
            async () => assert.fail('must not contact an outside host')
        ),
        /Unexpected/
    );
    await assert.rejects(
        checksumOriginal(remote(item), 'test-cloud', async () => new Response('', { status: 404 })),
        /HTTP 404/
    );
    await assert.rejects(
        checksumOriginal(remote(item), 'test-cloud', async () => new Response('short')),
        /size mismatch/
    );
});

test('listing fails safely for rejected access, invalid pages and repeated cursors', async () => {
    await assert.rejects(
        listImages(credentials, async () => ({ ok: false, status: 401 })),
        /HTTP 401/
    );
    await assert.rejects(
        listImages(credentials, async () => ({
            ok: true,
            json: async () => ({ resources: null })
        })),
        /listing/
    );
    await assert.rejects(
        listImages(credentials, async () => ({
            ok: true,
            json: async () => ({ resources: [], next_cursor: 'repeat' })
        })),
        /Repeated/
    );
});

test('uploads use original binary files, preserve folders, and replace only changed images', async (t) => {
    const root = fixture(t);
    const [item] = buildPlan(root);
    for (const action of ['new', 'changed']) {
        const record = await uploadImage(
            root,
            { ...item, action },
            credentials,
            async (url, options) => {
                assert.equal(url, 'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
                assert.equal(
                    options.body.get('overwrite'),
                    action === 'changed' ? 'true' : 'false'
                );
                assert.equal(options.body.get('asset_folder'), 'icb/assets');
                assert.equal(options.body.get('invalidate'), 'true');
                assert.deepEqual(
                    Buffer.from(await options.body.get('file').arrayBuffer()),
                    fs.readFileSync(path.join(root, item.source))
                );
                return { ok: true, json: async () => remote(item) };
            }
        );
        assert.equal(record.sha256, item.sha256);
    }
    await assert.rejects(
        uploadImage(root, { ...item, action: 'unchanged' }, credentials),
        /requires a new or changed/
    );
});

test('changed local files and provider failures do not produce successful manifest records', async (t) => {
    const root = fixture(t);
    const [item] = buildPlan(root);
    await assert.rejects(
        uploadImage(root, { ...item, action: 'new' }, credentials, async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'test-secret' })
        })),
        (error) => error.message.includes('HTTP 400') && !error.message.includes('test-secret')
    );
    fs.writeFileSync(path.join(root, item.source), 'edited after inventory');
    await assert.rejects(
        uploadImage(root, { ...item, action: 'new' }, credentials, async () =>
            assert.fail('must fail before network access')
        ),
        /changed after inventory/
    );
});

test('manifest writes complete JSON and replaces previous checkpoints', (t) => {
    const root = fixture(t, {});
    const file = path.join(root, 'data/cloudinary-upload-manifest.json');
    saveManifest(file, { images: [1] });
    saveManifest(file, { images: [1, 2] });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { images: [1, 2] });
    assert.equal(fs.existsSync(`${file}.tmp`), false);
});
