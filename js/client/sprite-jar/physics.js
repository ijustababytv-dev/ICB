/** ICBSpriteJarPhysics keeps related operations together and reads shared state at call time. */
window.ICBSpriteJarPhysics = function ICBSpriteJarPhysics(context) {
    function isFloor() {
        return context.S && context.S.mode === 'floor';
    }

    function fit() {
        var W = window.innerWidth,
            H = window.innerHeight;
        if (!W || !H || !context.S) return;
        context.stage.className = context.S.visible ? '' : 'hidden';
        var custom = !!context.S.jarUrl,
            back = custom ? context.S.jarUrl : context.S.jarBack;
        if (context.$('jarBack').getAttribute('src') !== back) context.$('jarBack').src = back;
        context.$('jarFront').style.display = custom ? 'none' : '';
        if (!custom && context.$('jarFront').getAttribute('src') !== context.S.jarFront)
            context.$('jarFront').src = context.S.jarFront;
        var img = context.$('jarBack'),
            ar = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1.5;
        var jw = (W * context.S.jarW) / 100,
            jh = jw * ar;
        context.jar.style.left = (W * context.S.jarX) / 100 + 'px';
        context.jar.style.top = (H * context.S.jarY) / 100 + 'px';
        context.jar.style.width = jw + 'px';
        context.jar.style.height = jh + 'px';
        context.inner.style.left = (jw * context.S.inL) / 100 + 'px';
        context.inner.style.top = (jh * context.S.inT) / 100 + 'px';
        context.inner.style.width = (jw * context.S.inW) / 100 + 'px';
        context.inner.style.height = (jh * context.S.inH) / 100 + 'px';
        context.$('jarCount').style.top = jh + W * 0.004 + 'px';
        var bw = (W * (context.propped() ? context.S.pbW : context.S.bookW)) / 100;
        context.book.style.width = bw + 'px';
        context.book.style.fontSize = bw / 60 + 'px';
        if (context.propped()) {
            // leaning on the floor at the left, always showing
            var bh = context.book.offsetHeight || bw * 0.56;
            context.book.style.left = (W * context.S.pbX) / 100 + 'px';
            context.book.style.top = H - (H * context.S.pbB) / 100 - bh + 'px';
            context.book.style.transform = context.book.style.webkitTransform =
                'perspective(90em) rotateX(' +
                context.S.pbLean +
                'deg) rotate(' +
                context.S.pbTilt +
                'deg)' +
                (context.alive ? ' translateY(-1.2em) scale(1.06)' : '') +
                (context.shownOpen() ? '' : ' scale(.5,1) translateX(-30%)');
            context.placeShut(W, H, bw, bh);
        } else {
            context.book.style.left = (W * context.S.bookX) / 100 + 'px';
            context.book.style.top = (H * context.S.bookY) / 100 + 'px';
            context.book.style.transform = context.book.style.webkitTransform = '';
            context.placeShut(W, H, bw, 0);
        }
        context.bookClass();
        context.$('ribbon').innerHTML =
            (context.S.bookTheme === 'spooky' ? '☾ ' : '') +
            context.esc(context.S.title || 'Sprite Sticker Book') +
            '<small>' +
            context.esc(context.season) +
            '</small>';
        context.jar.style.display = isFloor() ? 'none' : '';
        context.floorEl.style.display = isFloor() ? 'block' : 'none';
        var fL = context.S.floorL;
        if (context.propped() && context.S.avoidBook && context.S.pbX < 30)
            fL = Math.max(fL, context.S.pbX + context.S.pbW + 0.5); // toys stay clear of the book only if she turns that on (2026-10-19: she wants them under it)
        var fl = (W * fL) / 100,
            fr = (W * Math.max(context.S.floorR, context.S.floorL + 5)) / 100,
            fh = (H * context.S.floorH) / 100;
        context.floorEl.style.left = fl + 'px';
        context.floorEl.style.width = fr - fl + 'px';
        context.floorEl.style.height = fh + 'px';
        context.floorEl.style.top = H - (H * context.S.floorB) / 100 - fh + 'px';
        sizeBodies();
    }

    function hash(str, salt) {
        var h = 2166136261 ^ salt;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h * 16777619) >>> 0;
        }
        return h / 4294967296;
    }

    function syncFloor() {
        var sd = (context.S.mixSeed || 0) * 97,
            list = inJar(),
            key =
                'm' +
                sd +
                list
                    .map(function (t) {
                        return t.key + t.img + (t.done ? '*' : '');
                    })
                    .join('|') +
                '#' +
                context.floorEl.clientWidth +
                'x' +
                context.floorEl.clientHeight +
                '@' +
                context.S.toySize;
        if (key === context.floorKey) return;
        context.floorKey = key;
        var W = context.floorEl.clientWidth,
            H = context.floorEl.clientHeight;
        if (!W || !H) {
            context.floorKey = '';
            return;
        }
        var size = window.innerHeight * 0.085 * (context.S.toySize / 100),
            keep = {},
            pts = [],
            i,
            j,
            it;
        for (i = 0; i < list.length; i++)
            pts.push({ t: list[i], o: hash(list[i].key, 1 + sd), y: hash(list[i].key, 2 + sd) });
        pts.sort(function (a, b) {
            return a.o - b.o;
        }); // spread evenly left to right, in a shuffled order
        for (i = 0; i < pts.length; i++)
            pts[i].x = (i + 0.15 + 0.7 * hash(pts[i].t.key, 5 + sd)) / Math.max(1, pts.length);
        var minD = Math.min(0.5, (size * 0.8) / W),
            ar = W / Math.max(1, H);
        for (it = 0; it < 12; it++)
            for (i = 0; i < pts.length; i++)
                for (j = i + 1; j < pts.length; j++) {
                    var a = pts[i],
                        b = pts[j],
                        dx = b.x - a.x,
                        dy = (b.y - a.y) / ar,
                        d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                    if (d < minD) {
                        var o = (minD - d) / 2,
                            nx = dx / d,
                            ny = dy / d;
                        a.x -= nx * o;
                        b.x += nx * o;
                        a.y -= ny * o * ar;
                        b.y += ny * o * ar;
                        a.x = Math.max(0, Math.min(1, a.x));
                        b.x = Math.max(0, Math.min(1, b.x));
                        a.y = Math.max(0, Math.min(1, a.y));
                        b.y = Math.max(0, Math.min(1, b.y));
                    }
                }
        for (i = 0; i < pts.length; i++) {
            var p = pts[i],
                t = p.t,
                toy = context.toys[t.key];
            keep[t.key] = 1;
            if (!toy) {
                var el = document.createElement('div');
                el.innerHTML = '<div class="in"><img alt=""></div>';
                context.floorEl.appendChild(el);
                toy = context.toys[t.key] = { el: el, img: el.getElementsByTagName('img')[0] };
            }
            if (toy.img.getAttribute('src') !== t.img) toy.img.src = t.img;
            var depth = 0.82 + p.y * 0.3,
                sz = size * depth * ((t.base ? context.S.baseToy : 100) / 100); // base sprites bigger on the floor
            var r = hash(t.key, 3 + sd),
                rot = (r - 0.5) * 50;
            if (hash(t.key, 4 + sd) < 0.12) rot = (r < 0.5 ? -1 : 1) * (70 + r * 20); // a few tipped over
            toy.x = p.x * (W - sz) + sz / 2;
            toy.y = sz * 0.15 + p.y * (H - sz * 0.15); // y = where it touches the floor
            toy.sz = sz;
            toy.el.className =
                'toy' +
                (t.done ? ' done' : '') +
                (/ mixing/.test(toy.el.className) ? ' mixing' : '');
            toy.el.style.width = toy.el.style.height = sz + 'px';
            toy.el.style.zIndex = String(10 + Math.round(p.y * 100));
            toy.el.style.transform = toy.el.style.webkitTransform =
                'translate(' +
                (toy.x - sz / 2).toFixed(1) +
                'px,' +
                (toy.y - sz).toFixed(1) +
                'px) rotate(' +
                rot.toFixed(1) +
                'deg)';
            toy.el.style.visibility = toy.hidden ? 'hidden' : '';
        }
        for (var k in context.toys)
            if (context.toys.hasOwnProperty(k) && !keep[k] && !context.toys[k].hidden) {
                if (context.toys[k].el.parentNode)
                    context.toys[k].el.parentNode.removeChild(context.toys[k].el);
                delete context.toys[k];
            }
    }

    function mixUp() {
        if (!isFloor()) {
            shake(context.inner.clientHeight * 1.4);
            setTimeout(function () {
                shake(context.inner.clientHeight * 1.2);
            }, 450);
            return;
        }
        for (var k in context.toys)
            if (context.toys.hasOwnProperty(k))
                (function (t) {
                    var d = Math.round(Math.random() * 350);
                    t.el.style.transitionDelay = t.el.style.webkitTransitionDelay = d + 'ms';
                    t.el.className =
                        t.el.className.replace(/ (wiggle|drop|mixing)/g, '') + ' mixing';
                    setTimeout(function () {
                        t.el.className = t.el.className.replace(' mixing', '');
                        t.el.style.transitionDelay = t.el.style.webkitTransitionDelay = '';
                    }, 1900 + d);
                })(context.toys[k]);
        context.floorKey = ''; // the new seed arrives in the same poll and syncFloor moves everyone with the transition
    }

    function toyAnim(toy, cls, ms) {
        var e = toy.el,
            base = e.className.replace(/ (wiggle|drop)/g, '');
        e.className = base;
        void e.offsetWidth;
        e.className = base + ' ' + cls;
        setTimeout(function () {
            e.className = e.className.replace(' ' + cls, '');
        }, ms);
    }

    function inJar() {
        var out = [];
        for (var i = 0; i < context.roster.length; i++) {
            var s = context.roster[i],
                full = s.caught.length === s.variants.length,
                any = false;
            if (context.S.jarHolds !== 'sprites')
                for (var j = 0; j < s.variants.length; j++) {
                    var v = s.variants[j],
                        a = context.artOf(s, v),
                        k = s.id + '|' + v;
                    if (!a) continue;
                    any = true;
                    var got = s.caught.indexOf(v) >= 0;
                    if (context.S.leaveCaught && got && !context.pinned[k]) continue;
                    out.push({ key: k, id: s.id, variant: v, img: a, done: got, base: j === 0 });
                }
            if (any || !s.img) continue;
            if (
                (context.S.removeComplete || context.S.leaveCaught) &&
                full &&
                !context.pinned[s.id]
            )
                continue;
            out.push({ key: s.id, id: s.id, variant: '', img: s.img, done: full, base: true });
        }
        return out;
    }

    function radius() {
        var n = Math.max(1, inJar().length),
            a = context.inner.clientWidth * context.inner.clientHeight;
        var r = Math.sqrt((a * 0.5) / (n * Math.PI)) * (context.S.spriteSize / 100);
        return Math.max(6, Math.min(r, context.inner.clientWidth / 3));
    }

    function sizeBodies() {
        var r = radius();
        for (var k in context.bodies)
            if (context.bodies.hasOwnProperty(k)) {
                context.bodies[k].r = r;
                context.bodies[k].el.style.width = context.bodies[k].el.style.height =
                    r * 2.2 + 'px';
            }
    }

    function syncJar() {
        var list = inJar(),
            key = list
                .map(function (s) {
                    return s.key + s.img + (s.done ? '*' : '');
                })
                .join('|');
        context.$('jarCount').textContent = context.stats
            ? context.stats.done + ' / ' + context.stats.total + ' stickers'
            : '';
        if (key === context.jarKey) return;
        context.jarKey = key;
        var keep = {};
        for (var i = 0; i < list.length; i++) {
            var s = list[i],
                b = context.bodies[s.key];
            keep[s.key] = 1;
            if (!b) {
                var el = document.createElement('div');
                el.className = 'js';
                el.innerHTML = '<img alt="">';
                context.inner.appendChild(el);
                b = context.bodies[s.key] = {
                    id: s.key,
                    el: el,
                    x: Math.random() * context.inner.clientWidth,
                    y: -Math.random() * context.inner.clientHeight * 0.6,
                    vx: (Math.random() - 0.5) * 60,
                    vy: 0,
                    rot: (Math.random() - 0.5) * 30,
                    r: 10
                };
            }
            if (b.el.firstChild.getAttribute('src') !== s.img) b.el.firstChild.src = s.img;
            b.el.className = 'js' + (s.done ? ' done' : '');
        }
        for (var k in context.bodies)
            if (context.bodies.hasOwnProperty(k) && !keep[k] && !context.bodies[k].hold) {
                if (context.bodies[k].el.parentNode)
                    context.bodies[k].el.parentNode.removeChild(context.bodies[k].el);
                delete context.bodies[k];
            }
        sizeBodies();
    }

    function shake(power) {
        for (var k in context.bodies)
            if (context.bodies.hasOwnProperty(k)) {
                context.bodies[k].vx += (Math.random() - 0.5) * power;
                context.bodies[k].vy -= Math.random() * power * 0.8;
            }
    }

    function physics(dt) {
        var W = context.inner.clientWidth,
            H = context.inner.clientHeight,
            list = [],
            k,
            i,
            j,
            g = H * 2.2;
        for (k in context.bodies)
            if (context.bodies.hasOwnProperty(k)) list.push(context.bodies[k]);
        for (i = 0; i < list.length; i++) {
            var b = list[i];
            if (b.hold) continue;
            b.vy += g * dt;
            b.vx *= 0.995;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
        }
        for (var it = 0; it < 4; it++) {
            for (i = 0; i < list.length; i++)
                for (j = i + 1; j < list.length; j++) {
                    var a = list[i],
                        c = list[j];
                    if (a.hold || c.hold) continue;
                    var dx = c.x - a.x,
                        dy = c.y - a.y,
                        d = Math.sqrt(dx * dx + dy * dy) || 0.01,
                        m = a.r + c.r;
                    if (d < m) {
                        var o = (m - d) / 2,
                            nx = dx / d,
                            ny = dy / d;
                        a.x -= nx * o;
                        a.y -= ny * o;
                        c.x += nx * o;
                        c.y += ny * o;
                        var rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
                        if (rv < 0) {
                            var imp = -rv * 0.6;
                            a.vx -= imp * nx;
                            a.vy -= imp * ny;
                            c.vx += imp * nx;
                            c.vy += imp * ny;
                        }
                    }
                }
            for (i = 0; i < list.length; i++) {
                var q = list[i];
                if (q.hold) continue;
                if (q.x < q.r) {
                    q.x = q.r;
                    q.vx = Math.abs(q.vx) * 0.4;
                }
                if (q.x > W - q.r) {
                    q.x = W - q.r;
                    q.vx = -Math.abs(q.vx) * 0.4;
                }
                if (q.y > H - q.r) {
                    q.y = H - q.r;
                    q.vy = -Math.abs(q.vy) * 0.25;
                    q.vx *= 0.9;
                }
                if (q.y < q.r - H * 0.1 && it === 3) {
                    q.y = Math.max(q.y, q.r - H * 0.1);
                }
            }
        }
        for (i = 0; i < list.length; i++) {
            var p = list[i];
            if (p.hold) continue;
            p.rot += p.vx * dt * 0.6;
            p.rot *= 0.97;
            var sz = p.r * 2.2;
            p.el.style.transform = p.el.style.webkitTransform =
                'translate(' +
                (p.x - sz / 2).toFixed(1) +
                'px,' +
                (p.y - sz / 2).toFixed(1) +
                'px) rotate(' +
                p.rot.toFixed(1) +
                'deg)';
        }
    }

    return {
        isFloor: isFloor,
        fit: fit,
        hash: hash,
        syncFloor: syncFloor,
        mixUp: mixUp,
        toyAnim: toyAnim,
        inJar: inJar,
        radius: radius,
        sizeBodies: sizeBodies,
        syncJar: syncJar,
        shake: shake,
        physics: physics
    };
};
