(function () {
    var BASE = window.location.protocol + '//' + window.location.host;
    var lastKey = '';
    var cfg = {};
    var ssTimer = null; // slideshow interval timer
    var ssDelayTimer = null; // delay before slideshow starts
    var ssPool = []; // sprites to cycle through
    var ssIndex = 0;
    var ssActive = false;
    var ssLoading = false;
    var ssGeneration = 0; // ignore in-flight work after an operator stops or changes the slideshow
    var interruptTimer = null;

    /* ---- fire static + flash effects ---- */
    function doStatic() {
        var n = document.getElementById('noise');
        // remove and re-create the element to guarantee the animation restarts
        var parent = n.parentNode;
        var clone = n.cloneNode(true);
        clone.className = 'on';
        clone.style.opacity = '1';
        clone.style.animation = 'static .08s steps(4) 3';
        parent.replaceChild(clone, n);
    }

    /** Restart the catch flash even when the same image element was already animating. */
    function doFlash() {
        var img = document.getElementById('sprite-img');
        var parent = img.parentNode;
        var clone = img.cloneNode(true);
        clone.className = 'flash';
        clone.style.animation = 'catchFlash .5s ease-out';
        parent.replaceChild(clone, img);
    }

    /** Play the two visual transitions for a changed sprite. */
    function doEffects() {
        doStatic();
        doFlash();
    }

    /* ---- apply server settings ---- */
    function applySettings(s) {
        if (!s) return;
        cfg = s;
        document.getElementById('tv').style.display = s.visible === false ? 'none' : '';

        var idle = document.getElementById('idle');
        if (idle.style.display !== 'none') {
            idle.style.opacity = s.idleBars === false ? '0' : '1';
        }

        var c = document.getElementById('content');
        c.classList.remove('pos-top', 'pos-bottom', 'pos-overlay');
        c.classList.add('pos-' + (s.textPos || 'bottom'));

        var tw = document.getElementById('text-wrap');
        tw.style.transform = 'scale(' + (s.textSize || 100) / 100 + ')';

        var img = document.getElementById('sprite-img');
        var iScale = (s.imgSize || 100) / 100;
        img.style.maxWidth = Math.round(58 * iScale) + '%';
        img.style.maxHeight = Math.round(52 * iScale) + '%';
    }

    /* ---- show a sprite on screen ---- */
    function showSprite(name, variant, rarity, imgUrl, withEffects) {
        var key = name + '|' + variant;
        var isNew = key !== lastKey;
        lastKey = key;

        document.getElementById('idle').style.display = 'none';
        document.getElementById('interrupt').classList.remove('show');
        var c = document.getElementById('content');
        c.style.display = '';

        c.className = c.className.replace(/rarity-\S+/g, '').trim();
        if (cfg.showRarity !== false && rarity) c.classList.add('rarity-' + rarity.toLowerCase());
        c.classList.remove('pos-top', 'pos-bottom', 'pos-overlay');
        c.classList.add('pos-' + (cfg.textPos || 'bottom'));

        var nameEl = document.getElementById('sprite-name');
        nameEl.textContent = name;
        nameEl.style.display = cfg.showName === false ? 'none' : '';

        var varEl = document.getElementById('sprite-variant');
        varEl.textContent = variant || '';
        varEl.style.display = cfg.showVariant === false ? 'none' : '';

        var img = document.getElementById('sprite-img');
        if (imgUrl) {
            img.src = imgUrl;
            img.style.display = '';
        } else img.style.display = 'none';

        if ((isNew || withEffects) && withEffects !== false) doEffects();
    }

    /* ---- go to idle bars ---- */
    function goIdle() {
        document.getElementById('content').style.display = 'none';
        document.getElementById('interrupt').classList.remove('show');
        document.getElementById('ss-counter').style.display = 'none';
        var idle = document.getElementById('idle');
        idle.style.display = '';
        idle.style.opacity = cfg.idleBars !== false ? '1' : '0';
        document.getElementById('idle-label').textContent = 'AWAITING SIGNAL';
        lastKey = '';
    }

    /* ======== SLIDESHOW ======== */

    /** Cancel every delayed transition and invalidate requests before returning to manual display. */
    function stopSlideshow() {
        ssGeneration++;
        ssActive = false;
        ssLoading = false;
        if (interruptTimer) {
            clearTimeout(interruptTimer);
            interruptTimer = null;
        }
        if (ssTimer) {
            clearInterval(ssTimer);
            ssTimer = null;
        }
        if (ssDelayTimer) {
            clearTimeout(ssDelayTimer);
            ssDelayTimer = null;
        }
        document.getElementById('ss-counter').style.display = 'none';
        document.getElementById('interrupt').classList.remove('show');
    }

    /** Optionally show the operator's broadcast message before the first slide. */
    function showInterrupt(cb) {
        if (!cfg.ssShowInterrupt) {
            cb();
            return;
        }
        doStatic();

        document.getElementById('idle').style.display = 'none';
        document.getElementById('content').style.display = 'none';

        var intEl = document.getElementById('interrupt');
        document.getElementById('int-msg').textContent =
            cfg.ssMessage || 'WE INTERRUPT THIS BROADCAST...';
        document.getElementById('int-sub').textContent =
            cfg.ssSubMessage || 'HAVE YOU SEEN THESE SPRITES?';
        intEl.classList.add('show');

        interruptTimer = setTimeout(function () {
            interruptTimer = null;
            intEl.classList.remove('show');
            cb();
        }, 3000);
    }

    /** Cycle the current pool in order, wrapping at its end and showing the slide count. */
    function ssShowNext() {
        if (!ssPool.length) {
            stopSlideshow();
            goIdle();
            return;
        }
        ssIndex = ssIndex % ssPool.length;
        var sp = ssPool[ssIndex];
        var imgUrl = sp.variantImg || sp.img || '';
        if (imgUrl && !/^https?:\/\//i.test(imgUrl)) imgUrl = BASE + imgUrl;
        showSprite(sp.name, sp.variant, sp.rarity, imgUrl, true);

        var counter = document.getElementById('ss-counter');
        counter.textContent = ssIndex + 1 + ' / ' + ssPool.length;
        counter.style.display = '';

        ssIndex++;
    }

    /** Load the selected pool; stale responses cannot restart a stopped slideshow. */
    function startSlideshow() {
        if (ssActive || ssLoading || !cfg.slideshow) return;
        ssLoading = true;
        var generation = ssGeneration;
        // fetch the slideshow sprites from the server
        getJson('/api/sprite-tv/slideshow', function (d) {
            if (generation !== ssGeneration || !cfg.slideshow) return;
            ssLoading = false;
            if (!d.ok || !d.sprites || !d.sprites.length) return;
            ssPool = d.sprites;
            ssIndex = 0;
            ssActive = true;

            showInterrupt(function () {
                ssShowNext();
                ssTimer = setInterval(function () {
                    if (!ssActive) return;
                    doStatic();
                    ssShowNext();
                }, (cfg.ssInterval || 5) * 1000);
            });
        });
    }

    /** Wait the configured delay; clear the timer handle so empty pools can retry on a later poll. */
    function scheduleSlideshow() {
        stopSlideshow();
        if (!cfg.slideshow) return;
        var delay = (cfg.ssDelay || 8) * 1000;
        ssDelayTimer = setTimeout(function () {
            ssDelayTimer = null;
            startSlideshow();
        }, delay);
    }

    /* ---- process full sprite-tv payload ---- */
    function processPayload(d) {
        if (!d || !d.ok) return;
        var previous = [cfg.ssPool, cfg.ssDelay, cfg.ssInterval, cfg.ssShowInterrupt].join('|');
        applySettings(d.settings);

        // Slideshow mode: start with idle bars, then cycle sprites
        if (cfg.slideshow) {
            if (
                previous !==
                [cfg.ssPool, cfg.ssDelay, cfg.ssInterval, cfg.ssShowInterrupt].join('|')
            )
                stopSlideshow();
            if (!ssActive && !ssDelayTimer && !ssLoading) {
                goIdle();
                scheduleSlideshow();
            }
            return;
        }

        stopSlideshow();
        // Normal mode: show the display sprite or idle
        if (d.display) {
            var imgUrl = d.display.variantImg || d.display.img || '';
            if (imgUrl && !/^https?:\/\//i.test(imgUrl)) imgUrl = BASE + imgUrl;
            showSprite(d.display.name, d.display.variant, d.display.rarity, imgUrl);
        } else {
            goIdle();
        }
    }

    /** Keep the last rendered frame on request failure; Meld overlays use ES5 XHR polling. */
    function getJson(route, done) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', BASE + route, true);
        xhr.timeout = 5000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status !== 200) return done({ ok: false });
            var data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (error) {
                return done({ ok: false });
            }
            done(data);
        };

        xhr.send();
    }

    /** Refresh the display without connecting a second server or depending on SSE in Meld. */
    function poll() {
        getJson('/api/sprite-tv', processPayload);
    }

    poll();
    setInterval(poll, 2000);
})();
