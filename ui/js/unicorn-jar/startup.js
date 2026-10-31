// Startup for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
    // Full-screen Meld overlay (add it as a 1920x1080 layer covering the whole
    // canvas). Every fluffy unicorn in the giveaway drops into a glass jar;
    // once the jar is full, extra unicorns pile up along the bottom of the
    // screen. When a winner is drawn on the dashboard, the jar tips over,
    // everything bounces like lottery balls, the winner's unicorn floats up
    // with their name, then the jar stands back up and refills.
    //
    // IMPORTANT: ICB picks the winner (fair, weighted by unicorns) the moment
    // the dashboard button is pressed. This page only animates the result.
    //
    // Plain ES5 + XHR polling, same rules as every other Meld overlay here.
    // Physics: Matter.js 0.20.0 (MIT), served locally as matter.min.js.
    jarState.M = Matter;
    jarState.Engine = jarState.M.Engine;
    jarState.Bodies = jarState.M.Bodies;
    jarState.Body = jarState.M.Body;
    jarState.Composite = jarState.M.Composite;
    jarState.Sleeping = jarState.M.Sleeping;

    jarState.canvas = document.getElementById('c');

    jarState.ctx = jarState.canvas.getContext('2d');

    jarState.W = window.innerWidth || 1920;
    jarState.H = window.innerHeight || 1080;

    jarState.canvas.width = jarState.W;

    jarState.canvas.height = jarState.H;

    jarState.UNI = new Image();

    jarState.UNI.src = '/images/embedded/0335559507566291.png';

    jarState.UNI_ASPECT = 219 / 240;

    // UNICORN_COIN112 art, trimmed

    // Baby's jar art (assets/resources). Both are 1024x1536. Unicorns are
    // drawn BETWEEN the two panels: back panel, then unicorns, then front.
    // JAR_FRONT.png currently has a checkerboard painted into it instead of
    // real transparency, so it would cover the unicorns. The page checks the
    // top-left corner pixel: if it's see-through the real front panel is
    // used; if not, the back panel is reused as a softer glass layer in front.
    // Re-export JAR_FRONT.png with real transparency and it switches over by
    // itself on the next layer reload.
    jarState.JAR_IMG_W = 1024;
    jarState.JAR_IMG_H = 1536;

    jarState.FRONT_FALLBACK_ALPHA = 0.55;

    jarState.JAR_BACK = new Image();
    jarState.JAR_FRONT = new Image();

    jarState.frontUsable = false;

    jarState.JAR_BACK.src = 'assets/resources/JAR_BACK.png';

    jarState.JAR_FRONT.onload = function () {
        try {
            var probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            var pc = probe.getContext('2d');
            pc.drawImage(jarState.JAR_FRONT, 4, 4, 1, 1, 0, 0, 1, 1);
            jarState.frontUsable = pc.getImageData(0, 0, 1, 1).data[3] < 20;
        } catch (e) {
            jarState.frontUsable = false;
        }
    };

    jarState.JAR_FRONT.src = 'assets/resources/JAR_FRONT.png';

    jarState.SIZE_R = { small: 14, medium: 20, large: 28 };

    jarState.MAX_BODIES = 900;

    // beyond this, unicorns still count - just not drawn
    jarState.TIP_MS = 1300;
    jarState.SHAKE_MS = 3800;
    jarState.RISE_MS = 1200;
    jarState.BANNER_MS = 6500;
    jarState.UPRIGHT_MS = 1300;

    // Lottery drawing (Baby, 2026-09-25): cloud rains EVERY unicorn on file,
    // the screen mixes like a lottery machine, 10-second countdown, reveal.
    // Baby (2026-09-27): the whole song should play and the winner should be
    // revealed right as it ends, instead of cutting it off ~23s in. So the
    // "mix" stretch (the swirling lottery-machine part) is no longer a fixed
    // length - it stretches to fill whatever's left of the song once the
    // rain, countdown and rise are accounted for. See mixMsFor() below.
    jarState.RAIN_MS = 6000;
    jarState.COUNTDOWN_MS = 10000;
    jarState.GATHER_MS = 2600;

    jarState.DRAW_JAR_ONLY = true;

    jarState.MIN_MIX_MS = 5000;

    // floor, in case the song is short or hasn't loaded yet
    // Baby (2026-09-26, later): reveal the winner about 20 s BEFORE the song
    // ends, then let the song keep playing to the very end and fade out slowly.
    jarState.REVEAL_BEFORE_END_MS = 20000;

    jarState.SONG_FADE_MS = 8000;

    // the last 8 s of the song fade gently to silence

    // Optional sound (MP3s in assets/sounds). Missing files are simply silent.
    //   draw song  - plays from the moment the cloud appears until the reveal
    //                banner ends (loops if it's shorter), then fades out
    //   winner.mp3 - optional sting played once when the winner is revealed
    // Baby's song, straight from assets/resources (name URL-encoded for the spaces/brackets).
    jarState.DRAW_SONG =
        'assets/resources/' +
        encodeURIComponent('Pink Fluffy Unicorns Dancing on Rainbows (Trap Remix).mp3');

    jarState.drawAudio = new Audio(jarState.DRAW_SONG);

    jarState.drawAudio.preload = 'auto';

    jarState.drawAudio.loop = false;

    // Actual length of the song above (measured), used to time the drawing so
    // the winner is revealed right as it ends. If the browser reports a real
    // duration once the file loads, that takes over instead.
    jarState.DEFAULT_SONG_MS = 101720;

    jarState.songMs = jarState.DEFAULT_SONG_MS;

    jarState.drawAudio.addEventListener('loadedmetadata', function () {
        if (isFinite(jarState.drawAudio.duration) && jarState.drawAudio.duration > 5)
            jarState.songMs = Math.round(jarState.drawAudio.duration * 1000);
    });

    jarState.winnerAudio = new Audio('assets/sounds/winner.mp3');

    jarState.winnerAudio.preload = 'auto';

    jarState.audioFade = null;

    jarState.drawAudio.addEventListener('ended', function () {
        try {
            jarState.drawAudio.volume = 1;
        } catch (e) {}
    });

    jarState.DEFAULT_FILTER_MASK = 0xffffffff;

    jarState.FONT = '"Baloo 2","Comic Sans MS","Trebuchet MS",sans-serif';

    jarState.settings = null;

    jarState.engine = null;
    jarState.world = null;
    jarState.jar = null;

    jarState.R = 20;
    jarState.J = {};

    jarState.bodies = [];

    jarState.owners = {};

    // username -> [bodies]
    jarState.hiddenByOwner = {};

    // username -> count not drawn (over MAX_BODIES)
    jarState.queuedByOwner = {};

    // username -> count waiting to drop
    jarState.dropQueue = [];

    jarState.lastDropAt = 0;

    jarState.totalEntries = 0;

    jarState.lastWinnerCount = null;

    jarState.lastTestSeq = 0;

    jarState.drawQueue = [];

    jarState.phase = 'idle';
    jarState.phaseStart = 0;
    jarState.current = null;

    jarState.flights = [];

    jarState.confetti = [];

    jarState.winnerBody = null;

    jarState.lastShakeAt = 0;

    jarState.refillEndsAt = 0;

    // ------------------------------------------------------------ magic FX
    // Baby's art in assets/resources: a cloud the unicorns fall out of, stars
    // that sparkle down with every unicorn, and a rainbow for big moments.
    // All decoration only - none of it touches the physics or the counts.
    // Images are pre-shrunk once so drawing hundreds of stars stays cheap.
    jarState.magic = true;

    jarState.FX = { cloud: null, rainbow: null, stars: [] };

    jarState.loadFx('cloud', 'assets/resources/CLOUD_01.png', 520);

    jarState.loadFx('rainbow', 'assets/resources/RAINBOW_01.png', 260);

    jarState.loadFx('stars', 'assets/resources/STAR_PINK.png', 96);

    jarState.loadFx('stars', 'assets/resources/STAR_BLUE.png', 96);

    jarState.loadFx('stars', 'assets/resources/STAR_YELLOW.png', 96);

    jarState.cloud = { x: 0, y: 90, alpha: 0, dir: 1, lastUse: 0, inited: false };

    jarState.rainbow = { alpha: 0, until: 0, x: 0, y: 0, w: 0 };

    jarState.sparks = [];

    // falling stars + tiny twinkles
    jarState.MAX_SPARKS = 320;

    // Full rolled-over counts per viewer (what the drawing uses) and the
    // latest state, kept so the jar can be put back after a drawing.
    jarState.fullTotals = {};
    jarState.lastG = null;
    jarState.rainList = [];
    jarState.rainStartedAt = 0;
    jarState.rainSpawned = 0;

    // Extra glass sheen over the unicorns when the real front panel is used:
    // the back panel's walls redrawn faintly on top so the contents look like
    // they're behind curved glass, not pasted in front of it. 0 = off.
    jarState.FRONT_SHEEN_ALPHA = window.__sheen !== undefined ? window.__sheen : 0.3;

    // Each viewer's name is printed on their unicorns. The label is drawn once
    // per name into a small canvas and reused every frame (fast even with
    // hundreds of unicorns). Names stay upright while the unicorns tumble.
    // Long names shrink a little, then get cut off with "..." so they fit.
    jarState.showNames = false;

    jarState.labelCache = {};

    // Test hook for the dashboard-less preview (harmless on stream).
    window.__jar = {
        state: function () {
            return {
                bodies: jarState.bodies.length,
                inJar: jarState.settings ? jarState.inJarCount() : 0,
                capacity: jarState.J.capacity,
                phase: jarState.phase,
                angle: jarState.J.angle,
                total: jarState.totalEntries,
                queued: jarState.dropQueue.length,
                soundPlaying: !jarState.drawAudio.paused,
                soundTime: Math.round(jarState.drawAudio.currentTime * 10) / 10,
                soundVolume: jarState.drawAudio.volume,
                songMs: jarState.songMs,
                mixMs: jarState.current ? jarState.current.mixMs : jarState.mixMsFor(),
                isTest: jarState.current ? !!jarState.current.isTest : false
            };
        }
    };

    jarState.poll();

    setInterval(jarState.poll, 1000);

    requestAnimationFrame(jarState.frame);
})(window.ICBJar);
