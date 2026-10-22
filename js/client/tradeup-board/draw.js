/** ICBTradeupDraw keeps related operations together and reads shared state at call time. */
window.ICBTradeupDraw = function ICBTradeupDraw(context) {
    function wakeAll() {
        for (var i = 0; i < context.bodies.length; i++)
            if (context.bodies[i]) context.Sleeping.set(context.bodies[i], false);
    }

    function setPhase(p, now) {
        context.phase = p;
        context.phaseStart = now;
    }

    function rotateJarToward(target, frac) {
        context.J.angle += (target - context.J.angle) * frac;
        context.Body.setAngle(context.jar, context.J.angle);
    }

    function spillJar() {
        var mx = Math.sin(context.J.angle),
            my = -Math.cos(context.J.angle);
        for (var i = 0; i < context.bodies.length; i++) {
            var b = context.bodies[i];
            if (!b || b === context.winnerBody) continue;
            if (context.isInJar(b) && Math.random() < 0.5) {
                context.Sleeping.set(b, false);
                var sp = 6 + Math.random() * 7;
                context.Body.setVelocity(b, {
                    x: mx * sp + (Math.random() - 0.5) * 3,
                    y: my * sp - (2 + Math.random() * 4)
                });
            }
        }
    }

    function lotteryMix(now, k) {
        for (var i = 0; i < context.bodies.length; i++) {
            var b = context.bodies[i];
            if (!b || b === context.winnerBody || b.collisionFilter.mask === 0) continue;
            context.Sleeping.set(b, false);
            var vx =
                b.velocity.x +
                Math.sin(b.position.y * 0.005 + now * 0.0021 + b.id) * 0.9 * k +
                (Math.random() - 0.5) * 0.8 * k;
            var vy =
                b.velocity.y +
                Math.cos(b.position.x * 0.005 + now * 0.0017 + b.id * 0.7) * 0.9 * k +
                (Math.random() - 0.5) * 0.8 * k;
            if (b.position.y > context.H - context.R * 3.5 && Math.random() < 0.12 * k)
                vy = -(10 + Math.random() * 12);
            var sp = Math.sqrt(vx * vx + vy * vy),
                max = 20;
            if (sp > max) {
                vx *= max / sp;
                vy *= max / sp;
            }
            context.Body.setVelocity(b, { x: vx, y: vy });
        }
    }

    function startFlight(b, ex, ey, dur, onDone) {
        context.flights.push({
            b: b,
            t0: Date.now(),
            dur: dur,
            sx: b.position.x,
            sy: b.position.y,
            ex: ex,
            ey: ey,
            onDone: onDone
        });
    }

    function ease(p) {
        return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    }

    function updateFlights(now) {
        for (var i = context.flights.length - 1; i >= 0; i--) {
            var f = context.flights[i],
                t = Math.min(1, (now - f.t0) / f.dur),
                e = ease(t);
            context.Body.setStatic(f.b, true);
            context.Body.setPosition(f.b, {
                x: f.sx + (f.ex - f.sx) * e,
                y: f.sy + (f.ey - f.sy) * e - Math.sin(e * Math.PI) * 90
            });
            if (t >= 1) {
                context.flights.splice(i, 1);
                if (f.onDone) f.onDone();
            }
        }
    }

    function release(b) {
        b.collisionFilter.mask = 0;
    }

    function restore(b) {
        b.collisionFilter.mask = context.DEFAULT_FILTER_MASK;
        context.Body.setStatic(b, false);
    }

    function abortDraw() {
        setPhase('idle', Date.now());
        context.engine.gravity.y = 1;
        if (context.winnerBody) {
            restore(context.winnerBody);
            context.winnerBody = null;
        }
        context.flights = [];
        rotateJarToward(0, 1);
        wakeAll();
    }

    function updateDraw(now) {
        if (context.phase === 'idle') return;
        var t = now - context.phaseStart;

        if (context.phase === 'tip') {
            rotateJarToward(context.J.tipAngle, t < context.TIP_MS ? 0.09 : 1);
            if (t > context.TIP_MS * 0.6) spillJar();
            if (t > context.TIP_MS) {
                context.engine.gravity.y = 0.35;
                setPhase('mix', now);
            }
            return;
        }

        if (context.phase === 'mix') {
            spillJar();
            lotteryMix(now, 0.8 + 0.4 * Math.min(1, t / 1500));
            if (t > context.MIX_MS) setPhase('settle', now);
            return;
        }

        if (context.phase === 'settle') {
            context.engine.gravity.y += (1 - context.engine.gravity.y) * 0.08;
            rotateJarToward(0, t < context.UPRIGHT_MS ? 0.09 : 1);
            wakeAll();
            if (t > context.UPRIGHT_MS) {
                // Find the picked body and float it up center-screen with a banner.
                var picked = context.pendingReveal;
                context.pendingReveal = null;
                var b =
                    picked != null && context.bodies[picked.position]
                        ? context.bodies[picked.position]
                        : null;
                if (b) {
                    context.winnerBody = b;
                    release(b);
                    var self = { bannerAt: 0 };
                    context.winnerBanner = {
                        item: picked.item,
                        kind: picked.kind,
                        bannerAt: now + context.RISE_MS
                    };
                    startFlight(
                        b,
                        context.W / 2,
                        context.H * 0.32,
                        context.RISE_MS,
                        function () {}
                    );
                }
                setPhase('reveal', now);
            }
            return;
        }

        if (context.phase === 'reveal') {
            // Holds here (winner elevated, banner showing) until the server's
            // spinSeq changes again - onState() below drives the next transition.
            return;
        }
    }

    return {
        wakeAll: wakeAll,
        setPhase: setPhase,
        rotateJarToward: rotateJarToward,
        spillJar: spillJar,
        lotteryMix: lotteryMix,
        startFlight: startFlight,
        ease: ease,
        updateFlights: updateFlights,
        release: release,
        restore: restore,
        abortDraw: abortDraw,
        updateDraw: updateDraw
    };
};
