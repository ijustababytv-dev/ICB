// Ocean Fish overlay: the four wave layers and the gold sparkles (ES5 for Meld).
// Loaded before /js/client/ocean-fish.js, which draws them every frame.
window.ICBOceanFish = window.ICBOceanFish || {};

/**
 * Build the wave drawing helpers for one canvas. `view` supplies the current canvas size and the
 * latest settings (wave speed/height, gold trim) so resizes and dashboard changes apply live.
 */
window.ICBOceanFish.createWaves = function (ctx, view) {
    var st = view.state;

    var layers = [
        {
            baseY: 0.72,
            amplitude: 38,
            freq: 0.004,
            speed: 0.007,
            phase: 0,
            gradient: ['#102558', '#143c7b', '#184c8a'],
            crestColor: 'rgba(215, 235, 255, 0.45)',
            gold: '#d8ab3e'
        },
        {
            baseY: 0.78,
            amplitude: 44,
            freq: 0.0055,
            speed: 0.012,
            phase: 2.1,
            gradient: ['#0f356d', '#13719c', '#1ba3a9'],
            crestColor: 'rgba(235, 248, 255, 0.65)',
            gold: '#f0c653'
        },
        {
            baseY: 0.84,
            amplitude: 40,
            freq: 0.0068,
            speed: 0.017,
            phase: 4.4,
            gradient: ['#0f4886', '#149cb2', '#39dec9'],
            crestColor: 'rgba(255, 255, 255, 0.85)',
            gold: '#ffd868'
        },
        {
            baseY: 0.9,
            amplitude: 30,
            freq: 0.009,
            speed: 0.024,
            phase: 1.2,
            gradient: ['#146a9e', '#29c0b7', '#7beede'],
            crestColor: '#ffffff',
            gold: '#ffea9f'
        }
    ];

    /** Height of a wave layer at x for animation tick t (two sine waves plus a slow swell). */
    function getWaveY(x, layer, t) {
        var spd = st() ? st().waveSpeed : 1;
        var hgt = st() ? st().waveHeight : 1;
        var baseY = view.height() * layer.baseY;
        var amp = layer.amplitude * hgt;
        var sin1 = Math.sin(x * layer.freq + t * layer.speed * spd + layer.phase);
        var sin2 = Math.cos(x * layer.freq * 2.1 - t * layer.speed * spd * 0.8);
        var swell = Math.sin(x * 0.002 + t * 0.006) * (amp * 0.35);
        return baseY + (sin1 * 0.75 + sin2 * 0.25) * amp + swell;
    }

    /** Fill one wave layer with its gradient, plus the gold trim and white crest when enabled. */
    function drawLayer(layer, t) {
        var step = 6;
        ctx.beginPath();
        ctx.moveTo(0, view.height());
        for (var x = 0; x <= view.width() + step; x += step) ctx.lineTo(x, getWaveY(x, layer, t));
        ctx.lineTo(view.width(), view.height());
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, view.height() * layer.baseY - 40, 0, view.height());
        grad.addColorStop(0, layer.gradient[2]);
        grad.addColorStop(0.35, layer.gradient[1]);
        grad.addColorStop(1, layer.gradient[0]);
        ctx.fillStyle = grad;
        ctx.fill();

        if (st() && st().gold) {
            ctx.save();
            ctx.beginPath();
            for (var x2 = 0; x2 <= view.width() + step; x2 += step) {
                var y = getWaveY(x2, layer, t);
                x2 === 0 ? ctx.moveTo(x2, y) : ctx.lineTo(x2, y);
            }
            ctx.lineWidth = 2.4;
            ctx.strokeStyle = layer.gold;
            ctx.shadowColor = 'rgba(255, 215, 0, 0.45)';
            ctx.shadowBlur = 6;
            ctx.stroke();

            ctx.beginPath();
            for (var x3 = 0; x3 <= view.width() + step; x3 += step * 2) {
                var y2 = getWaveY(x3, layer, t) + Math.sin(x3 * 0.04 + t * 0.08) * 3;
                x3 === 0 ? ctx.moveTo(x3, y2) : ctx.lineTo(x3, y2);
            }
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = layer.crestColor;
            ctx.shadowBlur = 0;
            ctx.stroke();
            ctx.restore();
        }
    }

    /** Draw one twinkling four-point sparkle; alpha fades it in and out. */
    function drawSparkle(x, y, r, alpha) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = '#fff7cf';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffe484';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - r * 2.2, y);
        ctx.lineTo(x + r * 2.2, y);
        ctx.moveTo(x, y - r * 2.2);
        ctx.lineTo(x, y + r * 2.2);
        ctx.stroke();
        ctx.restore();
    }

    return { layers: layers, getWaveY: getWaveY, drawLayer: drawLayer, drawSparkle: drawSparkle };
};
