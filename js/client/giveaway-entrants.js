(function () {
    // Plain ES5, XHR poll - same rules as every other Meld overlay page in
    // this project. Shows the top entrants by total tickets, refreshed every
    // few seconds from ICB's giveaway state.

    // =====================================================================
    // Board wording is edited from the dashboard (giveaway-control.html >
    // "Board text") and arrives with every state poll. The values below
    // are only fallbacks shown for the first second before ICB answers.
    // =====================================================================

    // The big heading at the top of the board.
    var BOARD_TITLE = '🦄 Giveaway Entrants 🦄';

    // Shown instead of the list when nobody has entered yet.
    var EMPTY_MESSAGE = 'No entries yet — chat, sub, gift, or cheer to get in!';

    // How many viewers show on the board at once (highest fluffy-unicorn count first).
    var MAX_ROWS = 10;

    // Rotating reminder line under the title. Add, remove, or reword lines
    // freely - as many or as few as you want, one per line.
    var TICKER_MESSAGES = [
        'Chat every 10 min = 1 fluffy unicorn, all night long!',
        'Sub = 2 fluffy unicorns a month. Gift a sub = 4 fluffy unicorns EACH!',
        '100 bits = 1 fluffy unicorn (250 bits = 2 fluffy unicorns)',
        'Plushie drawings every ~30 min - you can win more than once!',
        'Mystery Outfit drawing every hour - one per person per night!'
    ];
    var UNI_ICON = '/images/embedded/0335559507566291.png';
    var tickerIndex = 0;
    var tickerEl = document.getElementById('ticker');
    var listEl = document.getElementById('list');
    var emptyEl = document.getElementById('empty');
    var titleEl = document.getElementById('title');

    titleEl.textContent = BOARD_TITLE;
    emptyEl.textContent = EMPTY_MESSAGE;

    function applyDisplay(d) {
        if (!d) {
            return;
        }
        if (typeof d.entrantsTitle === 'string') {
            titleEl.textContent = d.entrantsTitle;
            titleEl.style.display = d.entrantsTitle ? '' : 'none';
        }
        if (typeof d.emptyMessage === 'string') {
            emptyEl.textContent = d.emptyMessage;
        }
        if (typeof d.maxRows === 'number' && d.maxRows > 0) {
            MAX_ROWS = d.maxRows;
        }
        if (d.tickerMessages && typeof d.tickerMessages.length === 'number') {
            var changed = d.tickerMessages.join('\n') !== TICKER_MESSAGES.join('\n');
            TICKER_MESSAGES = d.tickerMessages.slice(0);
            if (changed) {
                tickerIndex = 0;
                tickTicker();
            }
        }
    }

    function tickTicker() {
        if (!TICKER_MESSAGES.length) {
            tickerEl.textContent = '';
            tickerEl.style.display = 'none';
            return;
        }
        tickerEl.style.display = '';
        tickerEl.textContent = TICKER_MESSAGES[tickerIndex % TICKER_MESSAGES.length];
        tickerIndex++;
    }

    tickTicker();
    setInterval(tickTicker, 5000);

    function totalTickets(e) {
        return (
            (e.chatTickets || 0) +
            (e.subTickets || 0) +
            (e.giftTickets || 0) +
            (e.bitsTickets || 0) +
            (e.manualTickets || 0)
        );
    }

    function render(giveaway) {
        applyDisplay(giveaway.display);
        var entrants = [];
        var map = giveaway.entrants || {};
        for (var key in map) {
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                var e = map[key];
                var t = totalTickets(e);
                if (t > 0) entrants.push({ username: e.username || key, tickets: t });
            }
        }
        entrants.sort(function (a, b) {
            return b.tickets - a.tickets;
        });
        entrants = entrants.slice(0, MAX_ROWS);

        if (!entrants.length) {
            listEl.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';

        var html = '';
        for (var i = 0; i < entrants.length; i++) {
            var row = entrants[i];
            html +=
                '<div class="row' +
                (i === 0 ? ' top1' : '') +
                '">' +
                '<span class="rank">' +
                (i + 1) +
                '</span>' +
                '<span class="name">' +
                escapeHtml(row.username) +
                '</span>' +
                '<span class="tickets"><img class="uni-icon" src="' +
                UNI_ICON +
                '" alt="">' +
                row.tickets +
                '<small>' +
                (row.tickets === 1 ? ' unicorn' : ' unicorns') +
                '</small></span>' +
                '</div>';
        }
        listEl.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function poll() {
        var x = new XMLHttpRequest();
        x.open('GET', '/api/giveaway/state?_=' + new Date().getTime(), true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4) return;
            if (x.status !== 200) return;
            try {
                var d = JSON.parse(x.responseText);
                if (d && d.giveaway) render(d.giveaway);
            } catch (e) {}
        };

        x.send();
    }

    poll();
    setInterval(poll, 4000);
})();
