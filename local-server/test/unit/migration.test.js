'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildPlan } = require('../../tools/cloudinary-plan');
const root = path.resolve(__dirname, '../../..');

test('launchers and npm select the relocated entry points without a root server stub', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).scripts;
    assert.equal(scripts.start, 'node local-server/src/index.js');
    assert.match(
        fs.readFileSync(path.join(root, 'start-icb-clean.bat'), 'utf8'),
        /local-server\\src\\index.js/
    );
    assert.match(
        fs.readFileSync(path.join(root, 'start-palia-bridge.bat'), 'utf8'),
        /local-server\\bridge\\palia-log-bridge.js/
    );
    assert.match(
        fs.readFileSync(path.join(root, 'start-desktop-widgets.bat'), 'utf8'),
        /local-server\\desktop/
    );
    assert.equal(fs.existsSync(path.join(root, 'server.js')), false);
    assert.equal(fs.existsSync(path.join(root, 'js/server/index.js')), false);
});

test('relocated UI artwork retains its existing Cloudinary ID and physical source path', (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-image-move-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    fs.mkdirSync(path.join(temp, 'ui/images/embedded'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'ui/images/embedded/card.png'), 'fixture');
    const [image] = buildPlan(temp);
    assert.equal(image.publicId, 'icb/images/embedded/card--png');
    assert.equal(image.source, 'images/embedded/card.png');
    assert.equal(image.localSource, 'ui/images/embedded/card.png');
});
