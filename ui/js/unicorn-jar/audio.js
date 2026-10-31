// Audio for the unicorn jar overlay. The server remains the authority on winners and counts.
(function (jarState) {
    jarState.mixMsFor = function mixMsFor() {
        return Math.max(
            jarState.MIN_MIX_MS,
            jarState.songMs -
                jarState.REVEAL_BEFORE_END_MS -
                jarState.RAIN_MS -
                jarState.COUNTDOWN_MS -
                jarState.RISE_MS
        );
    };

    jarState.playSound = function playSound(a) {
        try {
            a.volume = 1;
            a.currentTime = 0;
            var pr = a.play();
            if (pr && pr.catch) pr.catch(function () {});
        } catch (e) {}
    };

    jarState.fadeOut = function fadeOut(a, ms) {
        if (jarState.audioFade) clearInterval(jarState.audioFade);
        var start = Date.now();
        jarState.audioFade = setInterval(function () {
            var p = (Date.now() - start) / ms;
            try {
                a.volume = Math.max(0, 1 - p);
            } catch (e) {}
            if (p >= 1) {
                clearInterval(jarState.audioFade);
                jarState.audioFade = null;
                try {
                    a.pause();
                    a.volume = 1;
                } catch (e) {}
            }
        }, 50);
    };

    // Called every frame: as the draw song nears its natural end, ease the
    // volume down so it fades out slowly instead of stopping abruptly.
    jarState.songFadeTick = function songFadeTick() {
        try {
            if (jarState.drawAudio.paused || jarState.audioFade) return;
            var d = jarState.drawAudio.duration;
            if (!isFinite(d) || d <= 0) return;
            var left = (d - jarState.drawAudio.currentTime) * 1000;
            jarState.drawAudio.volume =
                left < jarState.SONG_FADE_MS
                    ? Math.max(0, Math.min(1, left / jarState.SONG_FADE_MS))
                    : 1;
        } catch (e) {}
    };
})(window.ICBJar);
