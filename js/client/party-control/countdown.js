/** Party countdown and check-in timing controls. Loaded before the page startup script. */
function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

function toLocalInput(ms) {
    var d = new Date(ms);
    return (
        d.getFullYear() +
        '-' +
        pad2(d.getMonth() + 1) +
        '-' +
        pad2(d.getDate()) +
        'T' +
        pad2(d.getHours()) +
        ':' +
        pad2(d.getMinutes())
    );
}

function cdIn(min) {
    $('startAt').value = toLocalInput(Date.now() + min * 60000);
    syncTime();
}

function fromTime(hh, mm) {
    var d = new Date();
    d.setHours(hh, mm || 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
}

function atTime(hh) {
    $('startTime').value = pad2(hh) + ':00';
    $('startAt').value = toLocalInput(fromTime(hh, 0));
}

function syncTime() {
    var v = $('startAt').value;
    $('startTime').value = v ? v.slice(11, 16) : '';
}

function saveCountdown() {
    var v = $('startAt').value;
    if (!v) {
        toast('Pick when the party starts');
        return;
    }
    var ms = new Date(v).getTime();
    if (!(ms > 0)) {
        toast("That time doesn't look right");
        return;
    }
    act(
        '/api/party/event',
        { id: cur, startAt: ms, warnMin: Number($('warnMin').value) || 10 },
        'Countdown set ⏰'
    );
}

function clearCountdown() {
    $('startAt').value = '';
    act('/api/party/event', { id: cur, startAt: null }, 'Countdown stopped');
}

function resetCheckins() {
    if (!confirm("Clear everyone's sign-in for this event?")) return;
    act('/api/party/event', { id: cur, resetCheckins: true }, 'Sign-ins cleared');
}

function cdText() {
    if (!A) return;
    var e = ev(),
        el = $('cdLive');
    if (!e.startAt) {
        el.textContent = '— not running';
        return;
    }
    var left = Math.round((e.startAt - (Date.now() + (A.skew || 0))) / 1000);
    if (left <= 0) {
        el.innerHTML =
            '— <span class="cdl">🎉 party started</span> · ' +
            e.checkedIn +
            ' / ' +
            e.filled +
            ' signed in';
        return;
    }
    var h = Math.floor(left / 3600),
        m = Math.floor((left % 3600) / 60),
        sec = left % 60;
    el.innerHTML =
        '— starts in <span class="cdl">' +
        (h ? h + 'h ' : '') +
        m +
        'm ' +
        pad2(sec) +
        's</span> · ' +
        e.checkedIn +
        ' / ' +
        e.filled +
        ' signed in';
}
