/** ICBWalkerAppearance keeps related operations together and reads shared state at call time. */
window.ICBWalkerAppearance = function ICBWalkerAppearance(context) {
    function say(w, parts, isReminder) {
        if (w.bubble && w.bubble.parentNode) w.bubble.parentNode.removeChild(w.bubble);
        var b = document.createElement('div');
        b.className = 'bubble' + (isReminder ? ' reminder' : '');
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p.t === 'emote' && p.url) {
                var im = document.createElement('img');
                im.className = 'emote';
                im.src = p.url;
                im.alt = p.name || '';
                b.appendChild(im);
            } else if (p.v) {
                b.appendChild(document.createTextNode(p.v));
            }
        }
        if (!b.childNodes.length) return;
        w.el.appendChild(b);
        w.bubble = b;
        w.lastBubbleAt = context.now();
        w.bubbleUntil = context.now() + context.settings.bubbleSeconds * 1000;
        setTimeout(function () {
            b.className += ' show';
        }, 20);
    }

    function hideBubble(w) {
        var b = w.bubble;
        if (!b) return;
        w.bubble = null;
        b.className = b.className.replace(' show', '');
        setTimeout(function () {
            if (b.parentNode) b.parentNode.removeChild(b);
        }, 260);
    }

    function sparkle(w) {
        for (var i = 0; i < 6; i++) {
            var s = document.createElement('div');
            s.className = 'spark';
            s.appendChild(
                document.createTextNode(['✨', '💖', '⭐', '🌈'][Math.floor(Math.random() * 4)])
            );
            s.style.left = context.settings.size * 0.5 + context.rand(-30, 30) + 'px';
            s.style.bottom = context.settings.size * context.rand(0.3, 0.9) + 'px';
            s.style.setProperty('--dx', context.rand(-40, 40) + 'px');
            w.el.appendChild(s);
            (function (node) {
                setTimeout(function () {
                    if (node.parentNode) node.parentNode.removeChild(node);
                }, 1200);
            })(s);
        }
    }

    function hearts(w) {
        for (var i = 0; i < 5; i++)
            (function (i) {
                setTimeout(function () {
                    if (!w.el.parentNode) return;
                    var h = document.createElement('div');
                    h.className = 'heart';
                    h.appendChild(
                        document.createTextNode(
                            ['💖', '💗', '💕', '💜'][Math.floor(Math.random() * 4)]
                        )
                    );
                    h.style.left = context.settings.size * 0.5 + context.rand(-25, 25) + 'px';
                    h.style.bottom = context.settings.size * 0.8 + 'px';
                    h.style.setProperty('--dx', context.rand(-50, 50) + 'px');
                    w.el.appendChild(h);
                    setTimeout(function () {
                        if (h.parentNode) h.parentNode.removeChild(h);
                    }, 1900);
                }, i * 220);
            })(i);
    }

    function trailDot(w, y) {
        var d = document.createElement('div');
        d.className = 'trail';
        w.trailI = ((w.trailI || 0) + 1) % context.RAINBOW.length;
        d.style.background = context.RAINBOW[w.trailI];
        d.style.left = w.x - 13 - w.dir * context.settings.size * 0.45 + 'px';
        d.style.top = y + context.settings.size * 0.55 + 'px';
        context.stage.appendChild(d);
        setTimeout(function () {
            if (d.parentNode) d.parentNode.removeChild(d);
        }, 950);
    }

    function outline(width, color) {
        if (!width) return 'none';
        var out = [],
            steps = 16;
        for (var i = 0; i < steps; i++) {
            var a = (i / steps) * Math.PI * 2;
            out.push(
                (Math.cos(a) * width).toFixed(2) +
                    'px ' +
                    (Math.sin(a) * width).toFixed(2) +
                    'px 0 ' +
                    color
            );
        }
        return out.join(',');
    }

    function applyLook() {
        var s = context.settings;
        var key = [
            s.namePosition,
            s.nameFont,
            s.nameSize,
            s.nameColor,
            s.nameBold,
            s.nameOutlineColor,
            s.nameOutlineWidth,
            s.nameBackground,
            s.nameBgColor,
            s.chatTextSize
        ].join('|');
        if (key === context.lookKey) return;
        context.lookKey = key;
        var font =
            '"' + (s.nameFont || 'Baloo 2') + '", "Comic Sans MS", "Trebuchet MS", sans-serif';
        var css =
            '.walker .name{font-family:' +
            font +
            ';font-size:' +
            (s.nameSize || 22) +
            'px;font-weight:' +
            (s.nameBold === false ? 600 : 900) +
            ';color:' +
            (s.nameColor || '#fff') +
            ';';
        if (s.namePosition === 'below') css += 'top:100%;bottom:auto;margin-top:4px;';
        else css += 'bottom:100%;top:auto;margin-bottom:6px;';
        if (s.namePosition === 'hidden') css += 'display:none;';
        if (s.nameBackground)
            css +=
                'padding:4px 12px 5px;border-radius:999px;background:' +
                (s.nameBgColor || '#782896') +
                ';border:2px solid rgba(255,255,255,.75);text-shadow:' +
                outline(Math.min(2, s.nameOutlineWidth || 0), s.nameOutlineColor || '#3a1446') +
                ';';
        else
            css +=
                'padding:0;background:none;border:0;text-shadow:' +
                outline(s.nameOutlineWidth || 0, s.nameOutlineColor || '#3a1446') +
                ';';
        css += '}';
        css += '.bubble{font-size:' + (s.chatTextSize || 22) + 'px;}';
        context.lookStyle.textContent = css;
    }

    function layoutBubbles() {
        var list = [],
            k;
        for (k in context.walkers)
            if (context.walkers.hasOwnProperty(k) && context.walkers[k].bubble)
                list.push(context.walkers[k]);
        list.sort(function (a, b) {
            return a.lastBubbleAt - b.lastBubbleAt;
        });
        var placed = [];
        for (var i = 0; i < list.length; i++) {
            var w = list[i],
                b = w.bubble,
                bw = b.offsetWidth,
                bh = b.offsetHeight;
            var half = bw / 2,
                shift = 0;
            if (w.x - half < 10) shift = 10 - (w.x - half);
            else if (w.x + half > context.W - 10) shift = context.W - 10 - (w.x + half);
            var left = w.x - half + shift,
                right = left + bw;
            var baseBottom = w.renderY - 14 - context.nameLift(w); // where the bubble's bottom edge sits (stage y)
            var bottom = baseBottom,
                moved = true,
                guard = 0;
            while (moved && guard++ < 20) {
                moved = false;
                for (var j = 0; j < placed.length; j++) {
                    var p = placed[j];
                    if (
                        left < p.right + 6 &&
                        right > p.left - 6 &&
                        bottom > p.top - 6 &&
                        bottom - bh < p.bottom + 6
                    ) {
                        bottom = p.top - 8;
                        moved = true;
                    }
                }
            }
            placed.push({ left: left, right: right, top: bottom - bh, bottom: bottom });
            b.style.marginLeft = shift + 'px';
            b.style.marginBottom = 14 + context.nameLift(w) + (baseBottom - bottom) + 'px';
            b.style.setProperty('--tail', Math.max(14, Math.min(bw - 14, half - shift)) + 'px');
        }
    }

    return {
        say: say,
        hideBubble: hideBubble,
        sparkle: sparkle,
        hearts: hearts,
        trailDot: trailDot,
        outline: outline,
        applyLook: applyLook,
        layoutBubbles: layoutBubbles
    };
};
