'use strict';
const assert = require('node:assert');
const { json } = require('./e2e-harness');
/** Verify skin standard behavior against the isolated test server. */
async function verifySkinStandard() {
    let result;
    result = await json('/api/tracker-skin-standard');
    assert.equal(result.response.status, 200);
    const skin = result.payload.trackerSkinStandard;
    assert.equal(skin.master.width, 2048, 'Tracker skin master width must be 2048.');
    assert.equal(skin.master.height, 768, 'Tracker skin master height must be 768.');
    assert.equal(skin.master.aspectRatio, '8:3', 'Tracker skin aspect ratio must be 8:3.');
    assert.ok(
        Math.abs(skin.master.width / skin.master.height - 8 / 3) < 1e-9,
        'Master dimensions must actually be 8:3.'
    );
    assert.equal(skin.scaling.preserveAspectRatio, true, 'Skins must always scale proportionally.');
    // The live value is drawn by ICB at runtime; a number baked into the
    // artwork can never update and would contradict the live tracker.
    assert.equal(
        skin.structure.valueBox.bakedIntoArtwork,
        false,
        'The tracker value must never be baked into skin artwork.'
    );
    assert.equal(
        skin.structure.valueBox.mustBeBlankInArtwork,
        true,
        'The value box must be blank in skin artwork.'
    );
    assert.match(skin.structure.valueBox.position, /underneath the resource title/i);
    assert.equal(skin.structure.resourceTitle.required, true);

    // Confirmed card geometry, from Baby's Tracker Card Master Template
    // (Measurements & Scales), 2026-08-14. Every tracker skin must match this
    // exactly so one resource card can swap for another with no repositioning.
    assert.equal(
        skin.referenceZones.status,
        'confirmed',
        'Card geometry is confirmed, not provisional.'
    );
    assert.equal(skin.card.cornerRadius, 64, 'Card corner radius must be 64.');
    assert.deepEqual(
        {
            x: skin.referenceZones.safeArea.x,
            y: skin.referenceZones.safeArea.y,
            width: skin.referenceZones.safeArea.width,
            height: skin.referenceZones.safeArea.height
        },
        { x: 64, y: 64, width: 1920, height: 640 },
        'Safe area must be 64,64 1920x640.'
    );
    assert.deepEqual(
        {
            x: skin.referenceZones.titleZone.x,
            y: skin.referenceZones.titleZone.y,
            width: skin.referenceZones.titleZone.width,
            height: skin.referenceZones.titleZone.height
        },
        { x: 128, y: 96, width: 1792, height: 260 },
        'Title zone must be 128,96 1792x260.'
    );
    assert.deepEqual(
        {
            x: skin.referenceZones.valueBoxZone.x,
            y: skin.referenceZones.valueBoxZone.y,
            width: skin.referenceZones.valueBoxZone.width,
            height: skin.referenceZones.valueBoxZone.height
        },
        { x: 448, y: 392, width: 1152, height: 280 },
        'Value box zone must be 448,392 1152x280.'
    );
    assert.equal(skin.structure.valueBox.mustNotBeMovedOrResized, true);

    // Internal consistency: the stated zones must actually agree with each
    // other and sit inside the canvas. Catches a hand-edit that moves one
    // number without updating the rest.
    const zone = (z) => ({
        ...z,
        right: z.x + z.width,
        bottom: z.y + z.height,
        centerX: z.x + z.width / 2
    });

    const safeArea = zone(skin.referenceZones.safeArea);
    const titleZone = zone(skin.referenceZones.titleZone);
    const valueBoxZone = zone(skin.referenceZones.valueBoxZone);
    for (const [name, z] of [
        ['title', titleZone],
        ['valueBox', valueBoxZone]
    ]) {
        assert.ok(
            z.x >= safeArea.x && z.right <= safeArea.right,
            `${name} zone must sit inside the safe area horizontally.`
        );
        assert.ok(
            z.y >= safeArea.y && z.bottom <= safeArea.bottom,
            `${name} zone must sit inside the safe area vertically.`
        );
        assert.equal(
            z.centerX,
            skin.master.width / 2,
            `${name} zone must be horizontally centred on x=1024.`
        );
    }
    assert.ok(
        valueBoxZone.y > titleZone.bottom,
        'The value box must sit below the title, not overlap it.'
    );
    assert.equal(
        valueBoxZone.y - titleZone.bottom,
        skin.derivedSpacing.titleBottomToValueBoxTop,
        'derivedSpacing must match the actual zone coordinates.'
    );
    assert.equal(
        skin.master.height - valueBoxZone.bottom,
        skin.derivedSpacing.valueBoxBottomToCanvasBottom
    );
    assert.equal(valueBoxZone.x, skin.derivedSpacing.valueBoxSideMargins.left);
    assert.equal(
        skin.master.width - valueBoxZone.right,
        skin.derivedSpacing.valueBoxSideMargins.right
    );

    // Per-skin registry. Each card declares its own value box, measured from
    // the real artwork, because image generation cannot hit pixel targets
    // reliably. ICB renders the live value into whichever card is showing.
    const skins = skin.skins;
    assert.equal(skins.model, 'per-skin-value-box');
    assert.equal(skin.structure.valueBox.perSkin, true);
    assert.ok(
        Array.isArray(skins.cards) && skins.cards.length >= 16,
        'Skin registry must list every card.'
    );
    const slugs = new Set();
    const mappedResources = new Map();
    for (const card of skins.cards) {
        assert.ok(
            card.slug && !slugs.has(card.slug),
            `Skin slug must be present and unique: ${card.slug}`
        );
        slugs.add(card.slug);
        assert.ok(
            card.file && card.displayName,
            `Skin ${card.slug} needs a file and display name.`
        );
        assert.equal(
            card.canvas.width,
            skin.master.width,
            `Skin ${card.slug} must use the master canvas width.`
        );
        assert.equal(
            card.canvas.height,
            skin.master.height,
            `Skin ${card.slug} must use the master canvas height.`
        );
        const vb = card.valueBox;
        assert.ok(vb && vb.width > 0 && vb.height > 0, `Skin ${card.slug} needs a real value box.`);
        assert.ok(vb.x >= 0 && vb.y >= 0, `Skin ${card.slug} value box must sit on the canvas.`);
        assert.ok(
            vb.x + vb.width <= card.canvas.width,
            `Skin ${card.slug} value box overflows the canvas width.`
        );
        assert.ok(
            vb.y + vb.height <= card.canvas.height,
            `Skin ${card.slug} value box overflows the canvas height.`
        );
        assert.equal(card.hasAlpha, true, `Skin ${card.slug} must have transparency for Meld.`);
        if (card.resource) {
            assert.ok(
                !mappedResources.has(card.resource),
                `Resource ${card.resource} is mapped to two skins.`
            );
            mappedResources.set(card.resource, card.slug);
        }
    }
    // Every resource the server actually tracks must have a skin to render into.
    for (const resource of ['amber', 'essence', 'sweetLeaf']) {
        assert.ok(
            mappedResources.has(resource),
            `Tracked resource ${resource} has no skin mapped.`
        );
    }

    result = await json('/api/diagnostics');
    assert.equal(result.payload.trackerSkinStandard.width, 2048);
    assert.equal(result.payload.trackerSkinStandard.height, 768);
    assert.equal(result.payload.trackerSkinStandard.aspectRatio, '8:3');
    assert.equal(result.payload.trackerSkinStandard.valueBoxBakedIntoArtwork, false);
}

module.exports = { verifySkinStandard };
