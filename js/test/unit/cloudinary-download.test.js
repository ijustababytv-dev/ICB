'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPlan } = require('../../tools/cloudinary-plan');
const { originalSource, buildDownloadPlan } = require('../../tools/cloudinary-download-plan');
const { sourceRecords, downloadImage, main } = require('../../tools/cloudinary-download');

/** Create a disposable project; test images never touch the operator's files or account. */
function fixture(t, files = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-download-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return root;
}

/** Build consistent remote metadata whose original content can be verified independently. */
function remote(id = 'icb/assets/card--png', content = 'remote pixels', overrides = {}) {
    return {
        public_id: id,
        resource_type: 'image',
        format: 'png',
        version: 1,
        asset_id: id,
        bytes: Buffer.byteLength(content),
        etag: crypto.createHash('md5').update(content).digest('hex'),
        secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${id}.png`,
        ...overrides
    };
}

/** Emulate inventory, checksum search and binary delivery; any write to Cloudinary fails the test. */
function provider(images, contents, deliveries = []) {
    return async (address, options) => {
        const url = new URL(address);
        assert.equal(options.redirect, 'error');
        if (url.hostname === 'api.cloudinary.com') {
            const search = url.pathname.endsWith('/resources/search');
            assert.ok(search || url.pathname.endsWith('/resources/image/upload'));
            assert.equal(options.method, search ? 'POST' : 'GET');
            return Response.json({ resources: images });
        }
        assert.equal(url.hostname, 'res.cloudinary.com');
        assert.equal(options.headers, undefined, 'credentials never accompany image downloads');
        deliveries.push(url.href);
        return new Response(contents[url.href]);
    };
}

test('all uploaded project roots map inside assets, preserving subfolders and extensionless images', (t) => {
    const root = fixture(t);
    const images = [
        remote('icb/assets/cards/Card--png', 'pixels', { display_name: 'Card.PNG' }),
        remote('icb/assets/screens/wait--original'),
        remote('icb/images/embedded/art--png'),
        remote('icb/docs/template--png')
    ];
    assert.deepEqual(
        buildDownloadPlan(root, images, 'test-cloud').map((i) => i.destination),
        [
            'assets/cards/Card.PNG',
            'assets/cloudinary/docs/template.png',
            'assets/cloudinary/images/embedded/art.png',
            'assets/screens/wait'
        ]
    );
    assert.equal(
        fs.existsSync(path.join(root, 'assets')),
        false,
        'planning creates no directories'
    );
});

test('manifest and matching display names recover original spelling without trusting mismatched paths', (t) => {
    const root = fixture(t, {
        'data/cloudinary-upload-manifest.json': JSON.stringify({
            images: [{ publicId: 'icb/assets/a_b--png', source: 'assets/a+b.PNG' }]
        })
    });
    const image = remote('icb/assets/a_b--png');
    assert.equal(originalSource(image, sourceRecords(root)), 'assets/a+b.PNG');
    assert.equal(originalSource({ ...image, display_name: 'a+b.PNG' }), 'assets/a+b.PNG');
    assert.equal(originalSource({ ...image, display_name: 'unrelated.png' }), 'assets/a_b.png');
    assert.equal(sourceRecords(fixture(t)).size, 0);
    fs.writeFileSync(path.join(root, 'data/cloudinary-upload-manifest.json'), 'broken');
    assert.throws(() => sourceRecords(root), /Cannot read/);
});

test('download planning rejects traversal, Windows aliases, reserved folders, and unsupported IDs', (t) => {
    const root = fixture(t);
    for (const id of [
        'outside/assets/card--png',
        'icb/private/card--png',
        'icb/assets/../escape--png',
        'icb/assets/a\\escape--png',
        'icb/assets/C:/escape--png',
        'icb/assets/CON--png',
        'icb/assets/LPT1--png',
        'icb/assets/space /card--png',
        'icb/assets/a./card--png',
        'icb/assets/card--js',
        'icb/assets/backups/card--png',
        'icb/assets/cloudinary/card--png'
    ])
        assert.throws(() => buildDownloadPlan(root, [remote(id)], 'test-cloud'), id);
    assert.equal(fs.existsSync(path.join(root, 'assets')), false);
});

test('invalid metadata and external, credential-bearing or redirected URLs fail before writes', (t) => {
    const root = fixture(t);
    for (const override of [
        { resource_type: 'raw' },
        { format: 'exe' },
        { bytes: -1 },
        { bytes: 1.5 },
        { etag: null },
        { secure_url: 'https://example.com/image.png' },
        { secure_url: 'http://res.cloudinary.com/test-cloud/image/upload/a.png' },
        { secure_url: 'https://user:password@res.cloudinary.com/test-cloud/image/upload/a.png' },
        { secure_url: 'https://res.cloudinary.com/other/image/upload/a.png' },
        {
            secure_url:
                'https://res.cloudinary.com/test-cloud/image/upload/a.png?redirect=elsewhere'
        }
    ])
        assert.throws(() =>
            buildDownloadPlan(root, [remote(undefined, undefined, override)], 'test-cloud')
        );
});

test('case-insensitive, duplicate, and file/directory destination collisions stop the entire plan', (t) => {
    const root = fixture(t);
    for (const pair of [
        ['icb/assets/card--png', 'icb/assets/CARD--png'],
        ['icb/assets/card--png', 'icb/assets/card--png'],
        ['icb/assets/card--png', 'icb/assets/card.png/child--png']
    ])
        assert.throws(
            () =>
                buildDownloadPlan(
                    root,
                    pair.map((id) => remote(id)),
                    'test-cloud'
                ),
            /collision/
        );
});

test('junctions or symlinks cannot redirect downloads outside assets', (t) => {
    const root = fixture(t, { 'assets/keep.png': 'local' });
    const outside = fixture(t);
    fs.symlinkSync(outside, path.join(root, 'assets/linked'), 'junction');
    assert.throws(
        () => buildDownloadPlan(root, [remote('icb/assets/linked/card--png')], 'test-cloud'),
        /linked/
    );
    assert.deepEqual(fs.readdirSync(outside), []);
    const linkedRoot = fixture(t);
    fs.symlinkSync(outside, path.join(linkedRoot, 'assets'), 'junction');
    assert.throws(() => buildDownloadPlan(linkedRoot, [remote()], 'test-cloud'), /linked/);
});

test('comparison uses content hashes, skips identical images, and never deletes local-only files', (t) => {
    const root = fixture(t, {
        'assets/same.png': 'same',
        'assets/changed.png': 'abcd',
        'assets/local-only.png': 'keep'
    });
    const plan = buildDownloadPlan(
        root,
        [
            remote('icb/assets/same--png', 'same'),
            remote('icb/assets/changed--png', 'wxyz'),
            remote('icb/assets/new--png', 'new')
        ],
        'test-cloud'
    );
    assert.deepEqual(
        plan.map((i) => i.action),
        ['changed', 'new', 'unchanged']
    );
    assert.equal(fs.readFileSync(path.join(root, 'assets/local-only.png'), 'utf8'), 'keep');
});

test('upload inventory excludes download mirrors and backup copies, including Windows folder casing', (t) => {
    const root = fixture(t, {
        'assets/card.png': 'original',
        'assets/Cloudinary/images/card.png': 'mirror',
        'assets/backups/cloudinary-download/old/card.png': 'backup'
    });
    assert.deepEqual(
        buildPlan(root).map((item) => item.source),
        ['assets/card.png']
    );
});

test('verified binary downloads restore missing files and back up changed local originals', async (t) => {
    const content = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
    const root = fixture(t, { 'assets/card.png': 'local original' });
    const [item] = buildDownloadPlan(root, [remote(undefined, content)], 'test-cloud');
    const result = await downloadImage(root, item, 'test-run', async () => new Response(content));
    assert.deepEqual(fs.readFileSync(path.join(root, item.destination)), content);
    assert.equal(fs.readFileSync(path.join(root, result.backup), 'utf8'), 'local original');
    assert.deepEqual(fs.readdirSync(path.join(root, 'assets')).sort(), ['backups', 'card.png']);
    const [missing] = buildDownloadPlan(
        root,
        [remote('icb/assets/new/card--png', content)],
        'test-cloud'
    );
    const restored = await downloadImage(
        root,
        missing,
        'test-run',
        async () => new Response(content)
    );
    assert.equal(restored.backup, null);
    assert.deepEqual(fs.readFileSync(path.join(root, missing.destination)), content);
});

test('failed, truncated, oversized and corrupt responses preserve the old image and remove partial files', async (t) => {
    const root = fixture(t, { 'assets/card.png': 'local original' });
    const [item] = buildDownloadPlan(root, [remote(undefined, 'four')], 'test-cloud');
    for (const request of [
        async () => new Response('provider secret', { status: 403 }),
        async () => {
            throw new Error('provider secret');
        },
        async () => new Response('x'),
        async () => new Response('oversized'),
        async () => new Response('fake'),
        async () =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array([1]));
                        controller.error(new Error('provider secret'));
                    }
                })
            )
    ]) {
        await assert.rejects(downloadImage(root, item, 'failed-run', request), (error) => {
            assert.ok(!error.message.includes('provider secret'));
            return true;
        });
        assert.equal(fs.readFileSync(path.join(root, item.destination), 'utf8'), 'local original');
        assert.deepEqual(fs.readdirSync(path.join(root, 'assets')), ['card.png']);
    }
});

test('local edits during downloads survive, and unchanged images cannot trigger downloads', async (t) => {
    const root = fixture(t, { 'assets/card.png': 'local original' });
    const [item] = buildDownloadPlan(root, [remote()], 'test-cloud');
    await assert.rejects(
        downloadImage(root, item, 'test-run', async () => {
            fs.writeFileSync(path.join(root, item.destination), 'edited while downloading');
            return new Response('remote pixels');
        }),
        /changed during download/
    );
    assert.equal(
        fs.readFileSync(path.join(root, item.destination), 'utf8'),
        'edited while downloading'
    );
    assert.deepEqual(fs.readdirSync(path.join(root, 'assets')), ['card.png']);
    await assert.rejects(
        downloadImage(root, { ...item, action: 'unchanged' }, 'test-run'),
        /requires/
    );
});

test('preview writes nothing; a complete download rerun skips all identical originals', async (t) => {
    const root = fixture(t, {
        '.env.cloudinary': 'CLOUDINARY_URL=cloudinary://test-key:test-secret@test-cloud'
    });
    const images = [remote(), remote('icb/images/embedded/art--png', 'other pixels')];
    const deliveries = [];
    const request = provider(
        images,
        {
            [images[0].secure_url]: 'remote pixels',
            [images[1].secure_url]: 'other pixels'
        },
        deliveries
    );
    assert.deepEqual(await main(['--dry-run'], { root, request }), {
        new: 2,
        changed: 0,
        unchanged: 0
    });
    assert.equal(fs.existsSync(path.join(root, 'assets')), false);
    assert.equal(deliveries.length, 0);
    await main(['--download'], { root, request });
    assert.equal(deliveries.length, 2);
    assert.deepEqual(await main(['--download'], { root, request }), {
        new: 0,
        changed: 0,
        unchanged: 2
    });
    assert.equal(deliveries.length, 2);
    assert.deepEqual(
        buildPlan(root).map((i) => i.source),
        ['assets/card.png'],
        'mirror copies never upload under duplicate IDs'
    );
    await assert.rejects(main(['--unknown'], { root, request }), /Usage/);
});
