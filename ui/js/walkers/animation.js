/** ICBWalkerAnimation keeps related operations together and reads shared state at call time. */
window.ICBWalkerAnimation = function ICBWalkerAnimation(context) {
    function animOn(id) {
        var a = context.settings.anims && context.settings.anims[id];
        return a ? a.on !== false : true;
    }

    function animOften(id) {
        var a = context.settings.anims && context.settings.anims[id];
        return a ? Math.max(1, Number(a.often) || 1) : 1;
    }

    function pickStyle(current) {
        var pool = [],
            total = 0,
            i;
        for (i = 0; i < context.MOVES.length; i++)
            if (animOn(context.MOVES[i])) {
                pool.push(context.MOVES[i]);
                total += animOften(context.MOVES[i]);
            }
        if (!pool.length) return 'glide'; // everything off: just slide along calmly
        if (pool.length > 1 && current) total -= 0; // (keeps weights simple)
        var r = Math.random() * total;
        for (i = 0; i < pool.length; i++) {
            r -= animOften(pool[i]);
            if (r <= 0) return pool[i];
        }
        return pool[0];
    }

    function actionById(id) {
        for (var i = 0; i < context.ACTIONS.length; i++)
            if (context.ACTIONS[i].id === id) return context.ACTIONS[i];
        return null;
    }

    function pickAction() {
        var total = 0,
            i;
        for (i = 0; i < context.ACTIONS.length; i++)
            if (animOn(context.ACTIONS[i].id)) total += animOften(context.ACTIONS[i].id);
        if (!total) return null; // every trick switched off
        var r = Math.random() * total;
        for (i = 0; i < context.ACTIONS.length; i++) {
            if (!animOn(context.ACTIONS[i].id)) continue;
            r -= animOften(context.ACTIONS[i].id);
            if (r <= 0) return context.ACTIONS[i];
        }
        return null;
    }

    function startAction(w, t, forced) {
        var a = forced || pickAction();
        if (!a) {
            w.nextActionAt = t + nextGap();
            return;
        }
        w.action = a.id;
        w.actionStart = t;
        w.actionUntil = t + context.rand(a.ms[0], a.ms[1]);
        if (a.id === 'turn') w.dir = -w.dir;
        if (a.id === 'sparkle') context.sparkle(w);
        if (a.id === 'hearts') context.hearts(w);
        if (a.id === 'nap') w.zzz.className = 'zzz show';
    }

    function nextGap() {
        var g = (context.settings.trickGap || 8) * 1000;
        return context.rand(g * 0.5, g * 1.5);
    }

    function startEntrance(w, style) {
        var t = context.now();
        w.dropStart = 0;
        w.popStart = 0;
        w.floatDownStart = 0;
        if (style === 'pop') {
            w.popStart = t;
            setTimeout(function () {
                context.sparkle(w);
            }, 250);
        } else if (style === 'floatdown') {
            w.floatDownStart = t;
        } else if (style === 'slide') {
            w.x = w.x < context.W / 2 ? -context.settings.size : context.W + context.settings.size;
            w.dir = w.x < 0 ? 1 : -1;
            w.entering = true;
        } else {
            w.dropStart = t;
            setTimeout(function () {
                context.sparkle(w);
            }, 450);
        }
    }

    function startExit(w) {
        w.leaving = true;
        w.action = null;
        w.exitStart = context.now();
        w.exitStyle = context.settings.exitStyle || 'walk';
        w.dir = w.x < context.W / 2 ? -1 : 1;
        w.zzz.className = 'zzz show';
        if (w.exitStyle === 'poof')
            setTimeout(function () {
                context.sparkle(w);
            }, 1200);
    }

    function nameLift(w) {
        return context.settings.namePosition === 'above' ? w.plate.offsetHeight + 6 : 0;
    }

    function frame() {
        var t = context.now(),
            dt = context.lastT ? Math.min(3, (t - context.lastT) / 16.67) : 1;
        context.lastT = t;
        var size = context.settings.size,
            afkMs = context.settings.afkMinutes * 60000;
        var GROUND =
            context.settings.namePosition === 'below' ? context.GROUND_BELOW : context.GROUND_ABOVE;
        for (var key in context.walkers) {
            if (!context.walkers.hasOwnProperty(key)) continue;
            var w = context.walkers[key];

            // Sleepy after afkMinutes: Zzz, face the nearest edge, walk off.
            if (!w.leaving && t - w.lastMsg > afkMs) startExit(w);

            // Switch movement style now and then (or right away if it was turned off).
            if (!w.floaty && (t > w.nextStyleAt || !animOn(w.style))) {
                w.style = pickStyle(w.style);
                w.nextStyleAt = t + context.rand(8000, 20000);
            }
            var style = w.floaty ? 'float' : w.style;

            var moving = true,
                speedMul = 1,
                lift = 0,
                rot = 0,
                scale = 1,
                wiggleX = 0;
            if (w.entering) {
                if (w.x > context.MIN_X + 40 && w.x < context.MAX_X - 40) w.entering = false;
            } else if (!w.leaving) {
                if (!w.action && t > w.nextActionAt) startAction(w, t);
                if (w.action) {
                    var p = Math.min(
                        1,
                        (t - w.actionStart) / Math.max(1, w.actionUntil - w.actionStart)
                    );
                    var A = w.action;
                    if (A === 'pause' || A === 'sparkle' || A === 'hearts') moving = false;
                    else if (A === 'bighop' || A === 'hop')
                        lift = Math.sin(p * Math.PI) * size * 0.55;
                    else if (A === 'spin') {
                        moving = false;
                        rot = p * 360;
                    } else if (A === 'flip') {
                        lift = Math.sin(p * Math.PI) * size * 0.75;
                        rot = -p * 360;
                    } else if (A === 'twirljump') {
                        moving = false;
                        lift = Math.sin(p * Math.PI) * size * 0.65;
                        rot = p * 720;
                    } else if (A === 'bounce') {
                        moving = false;
                        lift = Math.abs(Math.sin(p * Math.PI * 3)) * size * 0.3;
                    } else if (A === 'dance') {
                        moving = false;
                        rot = Math.sin(p * Math.PI * 10) * 14;
                        wiggleX = Math.sin(p * Math.PI * 5) * size * 0.08;
                        lift = Math.abs(Math.sin(p * Math.PI * 10)) * size * 0.06;
                    } else if (A === 'zoomies') speedMul = 3.6;
                    else if (A === 'rainbow') {
                        speedMul = 2.4;
                        if (!w.lastTrail || t - w.lastTrail > 45) {
                            w.lastTrail = t;
                            w.wantTrail = true;
                        }
                    } else if (A === 'grow') {
                        moving = false;
                        scale = 1 + 0.4 * Math.sin(p * Math.PI);
                    } else if (A === 'nap') moving = false;
                    else if (A === 'trot') speedMul = 2.2;
                    if (t >= w.actionUntil) {
                        if (A === 'nap' && !w.leaving) w.zzz.className = 'zzz';
                        w.action = null;
                        w.nextActionAt = t + nextGap();
                    }
                }
            }
            if (w.leaving) speedMul = 0.8;
            if (w.dropStart) {
                // arriving: fall in from above and land
                var dp = (t - w.dropStart) / 600;
                if (dp >= 1) w.dropStart = 0;
                else {
                    lift = Math.max(lift, (1 - dp) * (1 - dp) * size * 2.2);
                    moving = false;
                }
            }
            if (w.popStart) {
                // arriving: grow out of nothing with a little overshoot
                var pp = (t - w.popStart) / 500;
                if (pp >= 1) w.popStart = 0;
                else {
                    scale *= pp < 0.7 ? (pp / 0.7) * 1.15 : 1.15 - ((pp - 0.7) / 0.3) * 0.15;
                    moving = false;
                }
            }
            if (w.floatDownStart) {
                // arriving: drift down slowly, swaying
                var fp = (t - w.floatDownStart) / 2200;
                if (fp >= 1) w.floatDownStart = 0;
                else {
                    lift = Math.max(lift, (1 - fp) * size * 3.5);
                    rot = Math.sin(fp * Math.PI * 4) * 10;
                    moving = false;
                }
            }
            var exitFade = 1;
            if (w.leaving && w.exitStyle && w.exitStyle !== 'walk') {
                var ep = (t - w.exitStart) / 1000;
                moving = false;
                if (w.exitStyle === 'floataway') {
                    if (ep > 1) {
                        lift = (ep - 1) * (ep - 1) * size * 1.6;
                        rot = Math.sin(ep * 3) * 8;
                        exitFade = Math.max(0, 1 - (ep - 1) / 2.5);
                    }
                } else if (w.exitStyle === 'poof') {
                    if (ep > 1.2) {
                        scale *= Math.max(0, 1 - (ep - 1.2) / 0.35);
                        exitFade = scale;
                    }
                }
                if (exitFade <= 0.01) {
                    context.removeWalker(w);
                    continue;
                }
            }

            var styleMul =
                style === 'glide'
                    ? 1.15
                    : style === 'trot'
                    ? 1.7
                    : style === 'waddle'
                    ? 0.65
                    : style === 'skip'
                    ? 1.2
                    : style === 'float'
                    ? 0.9
                    : 1;
            if (w.action !== 'zoomies' && w.action !== 'rainbow') speedMul *= styleMul;
            if (moving) {
                w.x += w.dir * 1.4 * w.speed * context.settings.speed * speedMul * dt;
                w.phase += 0.22 * context.settings.speed * speedMul * dt;
                // Edge: turn around (unless arriving or leaving).
                if (!w.entering && !w.leaving) {
                    if (w.x > context.MAX_X) {
                        w.x = context.MAX_X;
                        w.dir = -1;
                    }
                    if (w.x < context.MIN_X) {
                        w.x = context.MIN_X;
                        w.dir = 1;
                    }
                }
            }
            var bob = 0,
                tilt = 0,
                squashOk = false;
            if (style === 'hop') {
                bob = moving ? Math.abs(Math.sin(w.phase)) * size * 0.12 : 0;
                squashOk = true;
            } else if (style === 'glide') {
                bob = 0;
                tilt = moving ? 5 : 0;
            } else if (style === 'trot') {
                bob = moving ? Math.abs(Math.sin(w.phase * 1.3)) * size * 0.05 : 0;
                squashOk = true;
            } else if (style === 'waddle') {
                bob = moving ? Math.abs(Math.sin(w.phase)) * size * 0.03 : 0;
                tilt = moving ? Math.sin(w.phase) * 9 : 0;
            } else if (style === 'skip') {
                // two small hops, then a big one
                var beat = Math.floor(w.phase / Math.PI) % 3;
                bob = moving ? Math.abs(Math.sin(w.phase)) * size * (beat === 2 ? 0.3 : 0.1) : 0;
                tilt = moving ? 4 : 0;
                squashOk = true;
            }
            if (style === 'float') {
                // hover above the ground, drifting gently up and down
                w.floatPhase = (w.floatPhase || context.rand(0, 6.28)) + 0.035 * dt;
                bob = size * 0.28 + Math.sin(w.floatPhase) * size * 0.09;
                tilt = Math.sin(w.floatPhase * 0.7) * 6 * (moving ? 1 : 0.5);
                lift *= 0.6; // a big "hop" becomes a swoop upward
            }

            if (w.leaving && (w.x < -size * 1.5 || w.x > context.W + size * 1.5)) {
                context.removeWalker(w);
                continue;
            }

            // Position the whole walker; flip ONLY the picture.
            var bw = size * 1.15,
                bh = size;
            w.body.style.width = bw + 'px';
            w.body.style.height = bh + 'px';
            w.el.style.width = bw + 'px';
            w.el.style.height = bh + 'px';
            w.el.style.transform =
                'translate(' +
                (w.x - bw / 2 + wiggleX).toFixed(1) +
                'px,' +
                (GROUND - bh - bob - lift).toFixed(1) +
                'px)';
            if (w.wantTrail) {
                w.wantTrail = false;
                context.trailDot(w, GROUND - bh - bob - lift);
            }
            var squash = squashOk && moving && bob < size * 0.02 ? ' scaleY(0.94)' : '';
            if (scale !== 1) squash += ' scale(' + scale.toFixed(3) + ')';
            w.el.style.opacity = exitFade < 1 ? exitFade.toFixed(2) : '';
            if (tilt && !rot) rot = tilt;
            var faceLeft = w.dir < 0 !== !!context.settings.artFacesLeft; // mirror only when the art faces the other way
            w.body.style.transform =
                'scaleX(' +
                (faceLeft ? -1 : 1) +
                ')' +
                (rot ? ' rotate(' + (faceLeft ? -rot : rot) + 'deg)' : '') +
                squash;

            w.renderY = GROUND - bh - bob - lift;
            w.zzz.style.marginBottom = nameLift(w) + 'px';
            if (w.bubble && t > w.bubbleUntil) context.hideBubble(w);
        }
        context.layoutBubbles();

        // Now and then a random unicorn shares a reminder.
        var everyMs = context.settings.reminderEveryMinutes * 60000;
        if (
            everyMs > 0 &&
            context.settings.reminders.length &&
            t - context.lastReminder > everyMs
        ) {
            context.lastReminder = t;
            var pool = [];
            for (var k in context.walkers)
                if (
                    context.walkers.hasOwnProperty(k) &&
                    !context.walkers[k].leaving &&
                    !context.walkers[k].bubble
                )
                    pool.push(context.walkers[k]);
            if (pool.length)
                context.say(
                    pool[Math.floor(Math.random() * pool.length)],
                    [
                        {
                            t: 'text',
                            v: context.settings.reminders[
                                Math.floor(Math.random() * context.settings.reminders.length)
                            ]
                        }
                    ],
                    true
                );
        }
        requestAnimationFrame(frame);
    }

    return {
        animOn: animOn,
        animOften: animOften,
        pickStyle: pickStyle,
        actionById: actionById,
        pickAction: pickAction,
        startAction: startAction,
        nextGap: nextGap,
        startEntrance: startEntrance,
        startExit: startExit,
        nameLift: nameLift,
        frame: frame
    };
};
