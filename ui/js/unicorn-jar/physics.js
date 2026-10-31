// Physics for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
    // ------------------------------------------------------------------ setup
    jarState.init = function init(display) {
        jarState.settings = {
            jarSide: display.jarSide || 'right',
            unicornSize: display.unicornSize || 'medium'
        };
        jarState.showNames = display.showNames === true;
        jarState.magic = display.magic !== false;
        jarState.R = jarState.SIZE_R[jarState.settings.unicornSize] || 20;

        jarState.engine = jarState.Engine.create({ enableSleeping: true });
        jarState.engine.gravity.y = 1;
        jarState.engine.positionIterations = 8;
        jarState.engine.velocityIterations = 6;
        jarState.world = jarState.engine.world;

        var wallOpts = { isStatic: true, friction: 0.2, restitution: 0.2 };
        jarState.Composite.add(jarState.world, [
            jarState.Bodies.rectangle(
                jarState.W / 2,
                jarState.H + 100,
                jarState.W * 3,
                200,
                wallOpts
            ), // floor
            jarState.Bodies.rectangle(-100, jarState.H / 2, 200, jarState.H * 4, wallOpts), // left
            jarState.Bodies.rectangle(
                jarState.W + 100,
                jarState.H / 2,
                200,
                jarState.H * 4,
                wallOpts
            ), // right
            jarState.Bodies.rectangle(
                jarState.W / 2,
                -jarState.R * 8 - 100,
                jarState.W * 3,
                200,
                wallOpts
            ) // ceiling just above the screen (keeps the lottery mix in view)
        ]);

        // Jar art is drawn at scale js; everything below is measured in the
        // art's own pixels (1024x1536) and converted with P(x, y).
        var js = Math.min(
            (jarState.H * 0.62) / jarState.JAR_IMG_H,
            (jarState.W * 0.26) / jarState.JAR_IMG_W
        );
        var jarW = jarState.JAR_IMG_W * js;
        var t = Math.max(10, 30 * js);
        var cx;
        if (jarState.settings.jarSide === 'left') cx = jarState.W * 0.14;
        else if (jarState.settings.jarSide === 'center') cx = jarState.W / 2;
        else cx = jarState.W * 0.86;
        cx = Math.max(jarW / 2 + 20, Math.min(jarState.W - jarW / 2 - 20, cx));

        // The art's glass ends at y=1460; sit that on the bottom of the screen.
        var ox = cx - jarW / 2,
            oy = jarState.H - 1460 * js;
        function P(x, y) {
            return { x: ox + x * js, y: oy + y * js };
        }

        jarState.J = {
            s: js,
            ox: ox,
            oy: oy,
            cx: cx,
            w: jarW,
            h: jarState.JAR_IMG_H * js,
            t: t,
            left: P(13, 0).x,
            right: P(1011, 0).x,
            top: P(0, 13).y,
            bottom: jarState.H,
            // body cavity (below the shoulders)
            innerLeft: P(80, 0).x,
            innerRight: P(944, 0).x,
            bodyTop: P(0, 430).y,
            innerBottom: P(0, 1322).y,
            // neck opening, where drops go in
            mouthLeft: P(190, 0).x,
            mouthRight: P(834, 0).x,
            innerTop: P(0, 40).y,
            angle: 0
        };
        jarState.J.cols = Math.max(
            1,
            Math.floor((jarState.J.innerRight - jarState.J.innerLeft) / (2 * jarState.R))
        );
        jarState.J.rows = Math.max(
            1,
            Math.floor((jarState.J.innerBottom - jarState.J.bodyTop) / (2 * jarState.R))
        );
        jarState.J.capacity = jarState.J.cols * jarState.J.rows;
        // Tip toward the middle of the screen, pivoting on the bottom corner.
        jarState.J.tipDir = jarState.settings.jarSide === 'left' ? 1 : -1;
        jarState.J.pivot = jarState.J.tipDir > 0 ? P(964, 1460) : P(60, 1460);
        jarState.J.tipAngle = 1.68 * jarState.J.tipDir;

        // Walls follow the art: base, sides, shoulders, neck (mirrored).
        var jarOpts = { isStatic: true, friction: 0.05, restitution: 0.3 };
        function seg(x1, y1, x2, y2) {
            var a = P(x1, y1),
                b = P(x2, y2);
            var dx = b.x - a.x,
                dy = b.y - a.y,
                len = Math.sqrt(dx * dx + dy * dy);
            return jarState.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + t, t, {
                isStatic: true,
                angle: Math.atan2(dy, dx),
                friction: 0.05,
                restitution: 0.3
            });
        }

        var parts = [
            seg(80, 1337, 944, 1337), // base
            seg(64, 1330, 64, 430), // left side (inside the glass thickness)
            seg(64, 430, 170, 228), // left shoulder
            seg(170, 228, 170, 40), // left neck
            seg(960, 1330, 960, 430), // right side
            seg(960, 430, 854, 228), // right shoulder
            seg(854, 228, 854, 40) // right neck
        ];
        jarState.jar = jarState.Body.create({ parts: parts, isStatic: true });
        jarState.Composite.add(jarState.world, jarState.jar);

        // Park the cloud over the jar right away so it's visible from the very
        // first frame, not just after the first drop (Baby, 2026-09-26).
        jarState.cloud.inited = true;
        jarState.cloud.x = jarState.J.cx;
        jarState.cloud.y = Math.max(60, jarState.cloudW() * 0.28);
    };

    // --------------------------------------------------------------- unicorns
    // Small star/rainbow accent pieces (Baby, 2026-09-26): unlike the transient
    // sparkleAt() twinkles, these are real physics bodies that fall in and
    // STAY with the unicorns, in the jar or on the overflow floor, instead of
    // fading away. Reuses the exact same bodies[] / render pipeline as
    // unicorns (isInJar, removeUnicorn, clearAll, the MAX_BODIES cap all just
    // work), so only makeAccent() + drawAccent() + the spawn call below are new.
    jarState.makeAccent = function makeAccent(x, y) {
        var img = null,
            roll = Math.random();
        if (roll < 0.7 && jarState.FX.stars.length)
            img = jarState.FX.stars[Math.floor(Math.random() * jarState.FX.stars.length)];
        else if (jarState.FX.rainbow) img = jarState.FX.rainbow;
        if (!img) return null; // art not loaded yet - skip this one, not worth waiting for
        var ar = img === jarState.FX.rainbow ? jarState.R * 0.95 : jarState.R * 0.5; // stars half a unicorn; rainbows bigger (Baby 2026-09-26)
        var b = jarState.Bodies.circle(x, y, ar, {
            restitution: 0.45,
            friction: 0.03,
            frictionStatic: 0.3,
            frictionAir: 0.012,
            density: 0.0008,
            sleepThreshold: 45
        });
        jarState.Body.setAngle(b, Math.random() * Math.PI * 2);
        b.isAccent = true;
        b.accentImg = img;
        b.renderScale = 1;
        jarState.Composite.add(jarState.world, b);
        jarState.bodies.push(b);
        return b;
    };

    // Big moments (gift bombs, big hand-adds) get a handful of these that drop
    // in alongside the unicorns and settle into the pile for good.
    jarState.spawnAccentShower = function spawnAccentShower(added) {
        var n = Math.min(6, Math.max(2, Math.round(added / 5)));
        for (var i = 0; i < n; i++) {
            if (jarState.bodies.length >= jarState.MAX_BODIES) break;
            var intoJar = jarState.inJarCount() < jarState.J.capacity;
            var x = intoJar
                ? jarState.J.mouthLeft +
                  jarState.R +
                  Math.random() *
                      Math.max(1, jarState.J.mouthRight - jarState.J.mouthLeft - 2 * jarState.R)
                : jarState.overflowX();
            var b = jarState.makeAccent(x, jarState.cloud.y + jarState.R * 0.5);
            if (!b) break;
            jarState.Body.setVelocity(b, { x: (Math.random() - 0.5) * 2, y: 2 });
            jarState.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.3);
        }
    };

    jarState.makeUnicorn = function makeUnicorn(owner, x, y) {
        var b = jarState.Bodies.circle(x, y, jarState.R, {
            restitution: 0.45,
            friction: 0.03,
            frictionStatic: 0.3,
            frictionAir: 0.012,
            density: 0.0015,
            sleepThreshold: 45
        });
        jarState.Body.setAngle(b, Math.random() * Math.PI * 2);
        b.owner = owner;
        b.renderScale = 1;
        jarState.Composite.add(jarState.world, b);
        jarState.bodies.push(b);
        (jarState.owners[owner] = jarState.owners[owner] || []).push(b);
        return b;
    };

    jarState.removeUnicorn = function removeUnicorn(b) {
        jarState.Composite.remove(jarState.world, b);
        var i = jarState.bodies.indexOf(b);
        if (i >= 0) jarState.bodies.splice(i, 1);
        var list = jarState.owners[b.owner];
        if (list) {
            i = list.indexOf(b);
            if (i >= 0) list.splice(i, 1);
            if (!list.length) delete jarState.owners[b.owner];
        }
        if (jarState.winnerBody === b) jarState.winnerBody = null;
    };

    jarState.clearAll = function clearAll() {
        while (jarState.bodies.length) jarState.removeUnicorn(jarState.bodies[0]);
        jarState.owners = {};
        jarState.hiddenByOwner = {};
        jarState.queuedByOwner = {};
        jarState.dropQueue = [];
        jarState.flights = [];
        jarState.winnerBody = null;
    };

    jarState.toJarLocal = function toJarLocal(p) {
        var a = -jarState.J.angle,
            dx = p.x - jarState.J.pivot.x,
            dy = p.y - jarState.J.pivot.y;
        return {
            x: jarState.J.pivot.x + dx * Math.cos(a) - dy * Math.sin(a),
            y: jarState.J.pivot.y + dx * Math.sin(a) + dy * Math.cos(a)
        };
    };

    jarState.isInJar = function isInJar(b) {
        var p = jarState.toJarLocal(b.position);
        return (
            p.x > jarState.J.innerLeft &&
            p.x < jarState.J.innerRight &&
            p.y > jarState.J.innerTop - jarState.R &&
            p.y < jarState.J.innerBottom + jarState.R
        );
    };

    jarState.inJarCount = function inJarCount() {
        var n = 0;
        for (var i = 0; i < jarState.bodies.length; i++)
            if (jarState.isInJar(jarState.bodies[i])) n++;
        return n;
    };

    jarState.overflowX = function overflowX() {
        // Anywhere along the bottom of the screen except over the jar's mouth,
        // so the overflow spreads into an even layer instead of a single cone.
        var gapL = jarState.J.left - jarState.R * 1.5,
            gapR = jarState.J.right + jarState.R * 1.5;
        var free = Math.max(0, gapL - jarState.R) + Math.max(0, jarState.W - jarState.R - gapR);
        var pick = Math.random() * free;
        if (pick < gapL - jarState.R) return jarState.R + pick;
        return gapR + (pick - Math.max(0, gapL - jarState.R));
    };

    jarState.spawnDrop = function spawnDrop(owner) {
        if (jarState.bodies.length >= jarState.MAX_BODIES) {
            jarState.hiddenByOwner[owner] = (jarState.hiddenByOwner[owner] || 0) + 1;
            return;
        }
        var intoJar = jarState.inJarCount() < jarState.J.capacity;
        var x = jarState.magic
            ? jarState.dropPoint(intoJar)
            : intoJar
            ? jarState.J.mouthLeft +
              jarState.R +
              Math.random() *
                  Math.max(1, jarState.J.mouthRight - jarState.J.mouthLeft - 2 * jarState.R)
            : jarState.overflowX();
        // With magic on they tumble out of the cloud; otherwise from the top edge.
        var y = jarState.magic
            ? jarState.cloud.y + jarState.R * 0.5
            : -jarState.R * 2 - Math.random() * jarState.R * 3;
        var vx = (Math.random() - 0.5) * 2;
        if (x === null) {
            // Overflow out of the parked cloud: pick a spot on the floor, leave from
            // the cloud edge on that side, and aim the throw so it lands there.
            var target = jarState.overflowX(),
                cw2 = jarState.cloudW();
            var side = target < jarState.cloud.x ? -1 : 1;
            x = Math.max(
                jarState.R,
                Math.min(jarState.W - jarState.R, jarState.cloud.x + side * cw2 * 0.45)
            );
            var fallSteps = Math.sqrt((2 * Math.max(100, jarState.H - jarState.R - y)) / 0.28);
            vx = (target - x) / fallSteps;
            if (Math.abs(vx) < 6) vx = side * 6; // always clear the jar
        }
        var b = jarState.makeUnicorn(owner, x, y);
        jarState.Body.setVelocity(b, { x: vx, y: 2 });
        jarState.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.3);
        jarState.sparkleAt(x, y, 3);
    };

    // First load: lay everyone out instantly (jar first, then the floor) and
    // let physics settle it before anything is drawn - no 5-minute pour.
    jarState.placeInstantly = function placeInstantly(list) {
        var inJar = 0,
            i,
            owner,
            b;
        var floorSlots = [];
        for (var x = jarState.R; x <= jarState.W - jarState.R; x += 2 * jarState.R) {
            if (x > jarState.J.left - jarState.R && x < jarState.J.right + jarState.R) continue;
            floorSlots.push(x);
        }
        var floorIndex = 0;
        for (i = 0; i < list.length; i++) {
            owner = list[i];
            if (jarState.bodies.length >= jarState.MAX_BODIES) {
                jarState.hiddenByOwner[owner] = (jarState.hiddenByOwner[owner] || 0) + 1;
                continue;
            }
            if (inJar < jarState.J.capacity) {
                var col = inJar % jarState.J.cols,
                    row = Math.floor(inJar / jarState.J.cols);
                b = jarState.makeUnicorn(
                    owner,
                    jarState.J.innerLeft +
                        jarState.R +
                        col * 2 * jarState.R +
                        (Math.random() - 0.5) * jarState.R,
                    jarState.J.innerBottom -
                        jarState.R -
                        row * 2.2 * jarState.R -
                        Math.random() * jarState.R
                );
                inJar++;
            } else {
                var slotCol = floorIndex % floorSlots.length,
                    slotRow = Math.floor(floorIndex / floorSlots.length);
                b = jarState.makeUnicorn(
                    owner,
                    floorSlots[slotCol] + (Math.random() - 0.5) * jarState.R * 1.2,
                    jarState.H -
                        jarState.R -
                        slotRow * 2.3 * jarState.R -
                        Math.random() * jarState.R * 1.5
                );
                floorIndex++;
            }
        }
        // Let them tumble into a natural heap before the first frame is shown.
        for (i = 0; i < 360; i++) jarState.Engine.update(jarState.engine, 1000 / 60);
    };
})(window.ICBJar);
