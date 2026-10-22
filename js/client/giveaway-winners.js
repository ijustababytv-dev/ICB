(function () {
    // Plain ES5, XHR poll - same rules as every other Meld overlay page.
    // Shows every winner drawn tonight, newest first, most recent highlighted.
    var listEl = document.getElementById('list');
    var emptyEl = document.getElementById('empty');

    function prizeLabel(w) {
        // A custom prize name set on the dashboard (e.g. "Squishmallow Corgi")
        // overrides the generic wording (Baby, 2026-09-26).
        if (w.prizeLabel) return w.prizeLabel;
        if (w.prize === 'mystery-outfit') return 'Mystery Outfit';
        if (w.prize === 'plushie') return 'Plushie';
        return w.prize;
    }

    function prizeMedal(prize) {
        return prize === 'mystery-outfit' ? '🎁' : '🧸';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var titleEl = document.getElementById('title');
    function applyDisplay(d) {
        if (!d) {
            return;
        }
        if (typeof d.winnersTitle === 'string') {
            titleEl.textContent = d.winnersTitle;
            titleEl.style.display = d.winnersTitle ? '' : 'none';
        }
        if (typeof d.winnersEmptyMessage === 'string') {
            emptyEl.textContent = d.winnersEmptyMessage;
        }
    }

    function render(giveaway) {
        applyDisplay(giveaway.display);
        // Hide winners for the first few seconds so unicorn-jar.html can do the
        // big reveal before their name lands on this board.
        // unicorn-jar.html reveals the winner ~20 s before the draw song ends
        // (song is ~1:42, so the reveal lands ~82 s after the click). Baby 2026-09-26.
        var REVEAL_DELAY_MS = 83000;
        var nowMs = new Date().getTime();
        var all = giveaway.winners || [],
            visible = [];
        for (var v = 0; v < all.length; v++) {
            var at = Date.parse(all[v].at);
            if (isNaN(at) || nowMs - at >= REVEAL_DELAY_MS) visible.push(all[v]);
        }
        var winners = visible.reverse(); // newest first
        if (!winners.length) {
            listEl.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';

        var html = '';
        for (var i = 0; i < winners.length; i++) {
            var w = winners[i];
            html +=
                '<div class="row' +
                (i === 0 ? ' latest' : '') +
                '">' +
                '<span class="medal">' +
                prizeMedal(w.prize) +
                '</span>' +
                '<span class="who"><span class="name">' +
                escapeHtml(w.username) +
                '</span><br>' +
                '<span class="prize">' +
                escapeHtml(prizeLabel(w)) +
                '</span></span>' +
                '</div>';
        }
        listEl.innerHTML = html;
    }

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/giveaway/state?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4) return;
            if (x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.giveaway) {
                    lastGiveaway = d.giveaway;
                    render(d.giveaway);
                }
            } catch (e) {}
        };

        x.send();
    }

    var lastGiveaway = null;
    poll();
    setInterval(poll, 4000);
    // Re-check the reveal delay every second so a new winner appears right on time.
    setInterval(function () {
        if (lastGiveaway) render(lastGiveaway);
    }, 1000);
})();
