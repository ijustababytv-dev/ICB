// Ocean Fish overlay: the built-in teal and gold fish, drawn in code (ES5 for Meld).
// Loaded before /js/client/ocean-fish.js.
window.ICBOceanFish = window.ICBOceanFish || {};

/** Draw the built-in fish once on a 270x150 canvas, facing right, and return it as a picture URL. */
window.ICBOceanFish.makeDefaultFish = function () {
    var c = document.createElement('canvas');
    c.width = 270;
    c.height = 150;
    var g = c.getContext('2d');
    g.lineJoin = 'round';

    /** Outline the current path in gold at width w. */
    var goldStroke = function (w) {
        g.lineWidth = w;
        g.strokeStyle = '#f0c653';
        g.stroke();
    };

    // Tail
    g.beginPath();
    g.moveTo(72, 75);
    g.quadraticCurveTo(38, 38, 8, 18);
    g.quadraticCurveTo(26, 75, 8, 132);
    g.quadraticCurveTo(38, 112, 72, 75);
    g.closePath();
    var tg = g.createLinearGradient(8, 0, 72, 0);
    tg.addColorStop(0, '#7beede');
    tg.addColorStop(1, '#149cb2');
    g.fillStyle = tg;
    g.fill();
    goldStroke(3);

    // Dorsal fin
    g.beginPath();
    g.moveTo(118, 36);
    g.quadraticCurveTo(148, 2, 192, 30);
    g.quadraticCurveTo(160, 32, 150, 44);
    g.closePath();
    g.fillStyle = '#29c0b7';
    g.fill();
    goldStroke(2.5);

    // Belly fin
    g.beginPath();
    g.moveTo(140, 112);
    g.quadraticCurveTo(150, 140, 176, 140);
    g.quadraticCurveTo(168, 122, 172, 110);
    g.closePath();
    g.fillStyle = '#29c0b7';
    g.fill();
    goldStroke(2);

    // Body
    g.beginPath();
    g.moveTo(62, 75);
    g.bezierCurveTo(92, 22, 196, 16, 254, 72);
    g.bezierCurveTo(196, 132, 92, 128, 62, 75);
    g.closePath();
    var bg = g.createLinearGradient(0, 22, 0, 128);
    bg.addColorStop(0, '#13719c');
    bg.addColorStop(0.45, '#39dec9');
    bg.addColorStop(1, '#eafff9');
    g.fillStyle = bg;
    g.fill();

    // Scales
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(255, 234, 159, 0.55)';
    g.lineWidth = 1.4;
    for (var row = 0; row < 5; row++) {
        for (var col = 0; col < 7; col++) {
            var sx = 96 + col * 16 + (row % 2) * 8;
            var sy = 44 + row * 15;
            g.beginPath();
            g.arc(sx, sy, 8, -Math.PI / 2, Math.PI / 2);
            g.stroke();
        }
    }
    g.restore();

    g.beginPath();
    g.moveTo(62, 75);
    g.bezierCurveTo(92, 22, 196, 16, 254, 72);
    g.bezierCurveTo(196, 132, 92, 128, 62, 75);
    g.closePath();
    goldStroke(3.2);

    // Gill
    g.beginPath();
    g.arc(196, 72, 26, -Math.PI * 0.35, Math.PI * 0.35);
    goldStroke(2.5);

    // Eye
    g.beginPath();
    g.arc(224, 62, 10, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    goldStroke(2);
    g.beginPath();
    g.arc(226, 62, 5.5, 0, Math.PI * 2);
    g.fillStyle = '#0a0f24';
    g.fill();
    g.beginPath();
    g.arc(228, 59, 2, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();

    return c.toDataURL('image/png');
};
