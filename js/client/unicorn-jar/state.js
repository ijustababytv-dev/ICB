// State for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
    // Bring the drawn unicorns in line with ICB's counts.
    jarState.applyState = function applyState(g, first) {
        var want = {},
            total = 0,
            key,
            e,
            n;
        // The jar shows only unicorns earned this stream (g.jar.counts); everyone's
        // full rolled-over count still decides the drawings on the server.
        if (g.jar && g.jar.counts) {
            for (key in g.jar.counts) {
                if (!Object.prototype.hasOwnProperty.call(g.jar.counts, key)) continue;
                n = g.jar.counts[key];
                if (n > 0) {
                    want[key] = n;
                    total += n;
                }
            }
        } else {
            var map = g.entrants || {};
            for (key in map) {
                if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
                e = map[key];
                n =
                    (e.chatTickets || 0) +
                    (e.subTickets || 0) +
                    (e.giftTickets || 0) +
                    (e.bitsTickets || 0) +
                    (e.manualTickets || 0);
                if (n > 0) {
                    want[e.username || key] = n;
                    total += n;
                }
            }
        }
        jarState.totalEntries = total;
        if (total === 0) {
            if (jarState.bodies.length || jarState.dropQueue.length) jarState.clearAll();
            return;
        }

        // Remove extras (queued first, then hidden, then drawn).
        var names = {},
            o;
        for (o in jarState.owners) names[o] = true;
        for (o in jarState.queuedByOwner) names[o] = true;
        for (o in jarState.hiddenByOwner) names[o] = true;
        for (o in names) {
            var have =
                (jarState.owners[o] ? jarState.owners[o].length : 0) +
                (jarState.queuedByOwner[o] || 0) +
                (jarState.hiddenByOwner[o] || 0);
            var extra = have - (want[o] || 0);
            while (extra > 0 && jarState.queuedByOwner[o]) {
                var qi = jarState.dropQueue.lastIndexOf(o);
                if (qi >= 0) jarState.dropQueue.splice(qi, 1);
                jarState.queuedByOwner[o]--;
                extra--;
            }
            while (extra > 0 && jarState.hiddenByOwner[o]) {
                jarState.hiddenByOwner[o]--;
                extra--;
            }
            while (extra > 0 && jarState.owners[o] && jarState.owners[o].length) {
                var victim = jarState.owners[o][jarState.owners[o].length - 1];
                if (victim === jarState.winnerBody) break;
                jarState.removeUnicorn(victim);
                extra--;
            }
        }

        // Add what's missing.
        var toPlace = [],
            added = 0;
        for (o in want) {
            var has =
                (jarState.owners[o] ? jarState.owners[o].length : 0) +
                (jarState.queuedByOwner[o] || 0) +
                (jarState.hiddenByOwner[o] || 0);
            for (var k = has; k < want[o]; k++) {
                if (first) toPlace.push(o);
                else {
                    jarState.dropQueue.push(o);
                    jarState.queuedByOwner[o] = (jarState.queuedByOwner[o] || 0) + 1;
                    added++;
                }
            }
        }
        if (!first && added >= 5) {
            jarState.triggerRainbow(3500 + Math.min(4000, added * 60)); // transient sparkle burst
            jarState.spawnAccentShower(added); // + a few stars/rainbows that fall in and stay
        }
        if (first && toPlace.length) {
            // Shuffle so the jar isn't sorted by viewer.
            for (var s = toPlace.length - 1; s > 0; s--) {
                var r = Math.floor(Math.random() * (s + 1));
                var tmp = toPlace[s];
                toPlace[s] = toPlace[r];
                toPlace[r] = tmp;
            }
            jarState.placeInstantly(toPlace);
        }
    };

    // ------------------------------------------------------------------- loop
    jarState.frame = function frame() {
        jarState.songFadeTick();
        var now = Date.now();
        if (jarState.settings) {
            if (jarState.phase === 'idle' && jarState.dropQueue.length) {
                var interval = jarState.dropQueue.length > 40 ? 25 : 70;
                if (now - jarState.lastDropAt > interval) {
                    jarState.lastDropAt = now;
                    var o = jarState.dropQueue.shift();
                    jarState.queuedByOwner[o] = Math.max(0, (jarState.queuedByOwner[o] || 0) - 1);
                    jarState.spawnDrop(o);
                }
            }
            jarState.updateCloud(now);
            jarState.updateDraw(now);
            jarState.updateFlights(now);
            jarState.Engine.update(jarState.engine, 1000 / 60);
        }
        jarState.render(now);
        requestAnimationFrame(jarState.frame);
    };

    // ------------------------------------------------------------------- data
    jarState.onState = function onState(g) {
        var d = g.display || {};
        if (!jarState.settings) {
            jarState.init(d);
            jarState.applyState(g, true);
            jarState.lastWinnerCount = (g.winners || []).length;
            jarState.lastTestSeq = (g.testDraw && g.testDraw.seq) || 0;
            jarState.lastG = g;
            return;
        }
        jarState.showNames = d.showNames === true;
        jarState.magic = d.magic !== false;
        if (
            (d.jarSide && d.jarSide !== jarState.settings.jarSide) ||
            (d.unicornSize && d.unicornSize !== jarState.settings.unicornSize) ||
            jarState.scaleOf(d.jarScale, 0.5, 1.5) !== jarState.settings.jarScale ||
            jarState.scaleOf(d.cloudScale, 0.5, 2) !== jarState.settings.cloudScale ||
            jarState.scaleOf(d.unicornScale, 0.5, 2) !== jarState.settings.unicornScale
        ) {
            window.location.reload();
            return;
        }
        var winners = g.winners || [];
        if (winners.length > jarState.lastWinnerCount) {
            for (var i = jarState.lastWinnerCount; i < winners.length; i++)
                jarState.drawQueue.push({
                    username: winners[i].username,
                    prize: winners[i].prize,
                    prizeLabel: winners[i].prizeLabel
                });
        } else if (winners.length < jarState.lastWinnerCount) {
            jarState.abortDraw();
        }
        jarState.lastWinnerCount = winners.length;
        // Baby (2026-09-27): the "Test" button on the dashboard - runs the same
        // show but always picks IJustABabyTv, without ever touching winners,
        // entrants, or the activity log, so demos never leak into anything real.
        var td = g.testDraw || {};
        if ((td.seq || 0) > jarState.lastTestSeq) {
            jarState.drawQueue.push({
                username: 'IJustABabyTv',
                prize: td.prize || 'plushie',
                prizeLabel: d.currentPrizeLabel || '',
                isTest: true
            });
        }
        jarState.lastTestSeq = td.seq || 0;
        jarState.lastG = g;
        jarState.fullTotals = {};
        var ents = g.entrants || {};
        if (g.pool && g.pool.counts) ents = {}; // check-in on: only people who chatted today
        for (var pk in g.pool && g.pool.counts ? g.pool.counts : {}) {
            if (Object.prototype.hasOwnProperty.call(g.pool.counts, pk))
                jarState.fullTotals[pk] = g.pool.counts[pk];
        }
        for (var key in ents) {
            if (!Object.prototype.hasOwnProperty.call(ents, key)) continue;
            var en = ents[key],
                tot =
                    (en.chatTickets || 0) +
                    (en.subTickets || 0) +
                    (en.giftTickets || 0) +
                    (en.bitsTickets || 0) +
                    (en.manualTickets || 0);
            if (tot > 0) jarState.fullTotals[en.username || key] = tot;
        }
        // During a drawing the screen holds everyone's unicorns; the jar is put
        // back to this stream's count when the show ends.
        if (jarState.phase === 'idle' && !jarState.drawQueue.length) jarState.applyState(g, false);
    };

    jarState.poll = function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/giveaway/state?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4 || x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.giveaway) jarState.onState(d.giveaway);
            } catch (e) {}
        };

        x.send();
    };
})(window.ICBJar);
