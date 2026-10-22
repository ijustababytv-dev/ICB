/** ICBSpriteJarAnimation keeps related operations together and reads shared state at call time. */
window.ICBSpriteJarAnimation = function ICBSpriteJarAnimation(context) {
    function sparkle(x, y, n, spread) {
        var ch = ['✦', '✧', '★', '♥', '✨'];
        for (var i = 0; i < n; i++)
            (function () {
                var e = document.createElement('div');
                e.className = 'spark';
                e.textContent = ch[Math.floor(Math.random() * ch.length)];
                e.style.left = x + 'px';
                e.style.top = y + 'px';
                e.style.color = ['#fff', '#ffd34d', '#ff8fd8', '#b8f0ff'][i % 4];
                context.fly.appendChild(e);
                setTimeout(function () {
                    var a = Math.random() * Math.PI * 2,
                        d = spread * (0.4 + Math.random() * 0.8);
                    e.style.left = x + Math.cos(a) * d + 'px';
                    e.style.top = y + Math.sin(a) * d + 'px';
                    e.style.opacity = '0';
                    e.style.transform =
                        'scale(' +
                        (0.5 + Math.random()) +
                        ') rotate(' +
                        Math.random() * 180 +
                        'deg)';
                }, 20);
                setTimeout(function () {
                    if (e.parentNode) e.parentNode.removeChild(e);
                }, 1000);
            })();
    }

    function rectOf(el) {
        var r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }

    function next() {
        context.busy = false;
        if (!context.queue.length) return;
        context.busy = true;
        play(context.queue.shift());
    }

    function play(ev) {
        if (ev.kind === 'turn') {
            var id = ev.sprite || context.stepId(ev.dir || 1);
            if (context.propped()) {
                context.turnTo(
                    id,
                    function () {
                        next();
                    },
                    ev.dir < 0
                );
                return;
            }
            context.curId = id;
            var sp = context.spriteOf(id);
            if (!sp) return next();
            context.drawLeft(sp, null, null);
            context.drawRight(context.stats, id, 0);
            context.caption('');
            context.openBook();
            context.closeLater(context.S.bookSec * 1000);
            return;
        }
        var s = context.spriteOf(ev.sprite);
        if (!s) return next();
        if (context.propped() && !context.shownOpen()) {
            if (context.S.catchOpens || ev.kind === 'peek') {
                context.tempOpen = true;
                context.fit();
                setTimeout(function () {
                    play(ev);
                }, 650);
                return;
            } // the book swings open for the catch
            if (ev.kind !== 'catch') return next();
        }
        if (context.propped() && context.shownOpen() && context.curId !== s.id) {
            context.turnTo(s.id, function () {
                play2(ev, s);
            });
            return;
        }
        context.curId = s.id;
        play2(ev, s);
    }

    function play2(ev, s) {
        if (ev.stats) context.stats = ev.stats;
        var vi = context.vinfo(ev.variant);
        if (ev.kind === 'catch') {
            context.drawLeft(s, ev, ev.variant);
            context.drawRight(
                context.stats,
                s.id,
                !ev.test && s.caught.indexOf(ev.variant) >= 0 ? 1 : 0
            );
            context.caption('');
            context.openBook();
            var slot = context.slotEl(ev.variant);
            if (slot) slot.className += ' target';
            setTimeout(function () {
                flyIn(s, ev, slot);
            }, 750);
            return;
        }
        context.drawLeft(s, ev, null);
        context.drawRight(context.stats, s.id, 0);
        context.openBook();
        if (ev.kind === 'already') {
            var sl = context.slotEl(ev.variant);
            if (sl) sl.className += ' pulse';
            context.caption(
                '<b>' +
                    context.esc(s.name) +
                    ' ' +
                    context.esc(vi[0]) +
                    '</b> is already in the book!'
            );
        } else if (ev.kind === 'undo') {
            context.drawLeft(
                {
                    name: s.name,
                    rarity: s.rarity,
                    img: s.img,
                    art: s.art,
                    variants: s.variants,
                    caught: s.caught.concat([ev.variant])
                },
                ev,
                null
            );
            context.drawRight(context.stats, s.id, 0);
            setTimeout(function () {
                var su = context.slotEl(ev.variant);
                if (su) su.className += ' peel';
            }, 500);
            context.caption(
                'Sticker peeled off: ' + context.esc(s.name) + ' ' + context.esc(vi[0])
            );
        } else if (ev.kind === 'unknown') {
            context.caption(
                'Which ' +
                    context.esc(s.name) +
                    '? ' +
                    s.variants
                        .map(function (v) {
                            return context.vinfo(v)[0];
                        })
                        .join(' · ')
            );
        } else context.caption('');
        context.closeLater(context.S.bookSec * 1000);
    }

    function flyIn(s, ev, slot) {
        var bk = context.bodies[s.id + '|' + ev.variant] ? s.id + '|' + ev.variant : s.id,
            b = context.bodies[bk],
            start,
            size,
            art = context.artOf(s, ev.variant);
        var jr = context.jar.getBoundingClientRect(),
            ir = context.inner.getBoundingClientRect(),
            up,
            toy = null;
        if (context.isFloor()) {
            if (b) b = null;
            toy = context.toys[s.id + '|' + ev.variant] || context.toys[s.id];
            var fr = context.floorEl.getBoundingClientRect();
            if (toy) {
                start = { x: fr.left + toy.x, y: fr.top + toy.y - toy.sz / 2 };
                size = toy.sz;
                toy.hidden = true;
                toy.el.style.visibility = 'hidden';
            } else {
                start = { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
                size = window.innerHeight * 0.085 * (context.S.toySize / 100);
            }
            up = { x: start.x, y: start.y - window.innerHeight * 0.16 };
        } else {
            if (b) {
                b.hold = true;
                start = { x: ir.left + b.x, y: ir.top + b.y };
                size = b.r * 2.2;
                b.el.style.visibility = 'hidden';
            } else {
                start = { x: jr.left + jr.width / 2, y: ir.top + ir.height * 0.6 };
                size = ir.width * 0.3;
            }
            context.shake(ir.height * 0.6);
            up = { x: jr.left + jr.width / 2, y: jr.top - jr.height * 0.12 };
        }
        var tgt =
            slot && context.shownOpen()
                ? rectOf(slot.querySelector('.spot'))
                : rectOf(context.shownOpen() ? context.book : context.$('shut'));
        var endSize = slot ? tgt.w * 0.84 : size;
        var f = document.createElement('div');
        f.className = 'flyer' + (ev.variant === 'Gold' && !art ? ' gold' : '');
        f.innerHTML = '<img src="' + context.esc(art || s.img) + '" alt="">';
        context.fly.appendChild(f);
        var t0 = null,
            T1 = 650,
            T2 = 1150,
            lastSpark = 0;
        var ctrl = { x: (up.x + tgt.x) / 2, y: Math.min(up.y, tgt.y) - window.innerHeight * 0.22 };
        function place(x, y, sz, rot) {
            f.style.width = f.style.height = sz + 'px';
            f.style.transform = f.style.webkitTransform =
                'translate(' + (x - sz / 2) + 'px,' + (y - sz / 2) + 'px) rotate(' + rot + 'deg)';
        }

        function ease(t) {
            return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        }

        function step(ts) {
            if (t0 === null) t0 = ts;
            var t = ts - t0,
                x,
                y,
                sz,
                rot;
            if (t < T1) {
                var k = 1 - Math.pow(1 - t / T1, 3);
                x = start.x + (up.x - start.x) * k;
                y = start.y + (up.y - start.y) * k;
                sz = size * (1 + 0.6 * k);
                rot = Math.sin(t / 90) * 8;
            } else if (t < T1 + T2) {
                var u = ease((t - T1) / T2),
                    a = 1 - u;
                x = a * a * up.x + 2 * a * u * ctrl.x + u * u * tgt.x;
                y = a * a * up.y + 2 * a * u * ctrl.y + u * u * tgt.y;
                sz = size * 1.6 + (endSize - size * 1.6) * u;
                rot = 360 * u;
            } else {
                land();
                return;
            }
            place(x, y, sz, rot);
            if (ts - lastSpark > 90) {
                lastSpark = ts;
                sparkle(x, y, 2, size * 0.5);
            }
            requestAnimationFrame(step);
        }

        function land() {
            if (f.parentNode) f.parentNode.removeChild(f);
            if (b) {
                b.hold = false;
                b.el.style.visibility = '';
                b.x = context.inner.clientWidth / 2;
                b.y = -b.r * 2;
                b.vy = 0;
            }
            if (toy) {
                toy.hidden = false;
                if (!(context.S.leaveCaught && !ev.test)) {
                    toy.el.style.visibility = '';
                    context.toyAnim(toy, 'drop', 950);
                }
            }
            delete context.pinned[s.id + '|' + ev.variant];
            delete context.pinned[s.id];
            context.jarKey = '';
            context.floorKey = '';
            context.syncJar();
            context.syncFloor(); // leaves the jar now if "caught stickers leave" is on
            var live = context.spriteOf(s.id) || s;
            context.drawLeft(
                {
                    name: s.name,
                    rarity: s.rarity,
                    img: s.img,
                    art: s.art,
                    variants: s.variants,
                    caught:
                        live.caught.indexOf(ev.variant) >= 0
                            ? live.caught
                            : live.caught.concat([ev.variant])
                },
                ev,
                null
            );
            var sl = context.slotEl(ev.variant);
            if (sl) sl.className += ' stick';
            context.drawRight(context.stats, s.id, 0);
            sparkle(tgt.x, tgt.y, 16, tgt.w * 1.1);
            var isBase = ev.variant === s.variants[0] && context.S.baseCelebrate;
            if (isBase && !ev.complete)
                setTimeout(function () {
                    sparkle(tgt.x, tgt.y, 26, tgt.w * 1.8);
                }, 250);
            context.caption(
                ev.complete
                    ? '⭐ <b>' + context.esc(s.name) + '</b> page complete! ⭐'
                    : isBase
                    ? '✨ New sprite: <b>' + context.esc(s.name) + '</b>! ✨'
                    : '<b>' +
                      context.esc(s.name) +
                      ' ' +
                      context.esc(context.vinfo(ev.variant)[0]) +
                      '</b> sticker! ' +
                      ev.have +
                      ' / ' +
                      ev.of
            );
            if (ev.complete)
                setTimeout(function () {
                    var r = rectOf(context.$('pl'));
                    sparkle(r.x, r.y, 30, r.w * 0.7);
                }, 400);
            context.closeLater(context.S.bookSec * 1000);
        }

        requestAnimationFrame(step);
    }

    return { sparkle: sparkle, rectOf: rectOf, next: next, play: play, play2: play2, flyIn: flyIn };
};
