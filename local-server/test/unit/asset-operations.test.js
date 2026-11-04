'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../../src/config');
const feed = require('../../src/cloud/state-feed');
const { prepareOperation } = require('../../src/assets/operations');
const { writeImage } = require('../../src/assets/uploads');

test('local artwork removal waits for cloud commit and moves originals into recoverable storage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-assets-'));
    const original = config.APP_DIR;
    const oldView = feed.view;
    config.APP_DIR = root;
    try {
        const folder = path.join(root, 'assets/aniimo');
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, 'sample.png');
        fs.writeFileSync(file, 'original');
        feed.view = () => ({ roster: [{ id: 'sample', image: 'sample.png' }] });

        const pending = prepareOperation(
            '/api/aniimo/image',
            'POST',
            { id: 'sample', remove: true },
            writeImage
        );
        assert.equal(fs.readFileSync(file, 'utf8'), 'original');
        // A stale/rejected command simply discards these callbacks; the active file remains.
        assert.equal(pending.length, 1);
        pending[0]();
        assert.equal(fs.existsSync(file), false);
        const retained = fs.readdirSync(path.join(folder, '_removed'));
        assert.equal(retained.length, 1);
        assert.equal(
            fs.readFileSync(path.join(folder, '_removed', retained[0]), 'utf8'),
            'original'
        );
        assert.throws(
            () => writeImage('../escape', 'data:image/png;base64,aGVsbG8=', 'bad'),
            /contents/
        );
        const bytes = Buffer.from('89504e470d0a1a0a01020304', 'hex');
        const picture = writeImage(
            'aniimo',
            'data:image/png;base64,' + bytes.toString('base64'),
            'Sample'
        );
        assert.deepEqual(fs.readFileSync(path.join(root, picture)), bytes);
        assert.equal(picture.includes('base64'), false);
    } finally {
        config.APP_DIR = original;
        feed.view = oldView;
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'icb-assets-')));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
