'use strict';
(function () {
    var csrf = '';
    var busy = false;
    var refreshVersion = 0;

    /** Keep provider codes readable without rendering arbitrary server text as markup. */
    function connectionLabel(data) {
        if (!data.configured) return 'Not configured';
        if (data.code === 'outbox_unreadable') return 'Upload queue needs attention';
        if (!data.account) return 'Ready for sign-in';
        var code = data.code || (data.feed && data.feed.code);
        if (code && !['ready', 'ok'].includes(code)) return 'Needs attention: ' + code;
        return 'Connected';
    }

    /** Announce the result next to the form without exposing credentials. */
    function message(text, error) {
        var result = document.getElementById('result');
        result.textContent = text;
        result.dataset.error = error ? 'true' : 'false';
    }

    /** Render public status only; bearer tokens remain inside the local Node process. */
    async function refresh() {
        var version = ++refreshVersion;
        try {
            var response = await fetch('/api/cloud/status');
            if (!response.ok) throw new Error('status_unavailable');
            var data = await response.json();
            if (version !== refreshVersion) return;
            document.getElementById('accountState').textContent = data.account
                ? 'Signed in as ' + data.account.username
                : 'Signed out';
            document.getElementById('connectionState').textContent = connectionLabel(data);
            document.getElementById('pendingUploads').textContent =
                data.pending == null ? 'Unavailable' : data.pending;
            document.getElementById('quarantinedUploads').textContent =
                data.quarantined == null ? 'Unavailable' : data.quarantined;
            document.getElementById('uncountedEvents').textContent = data.uncounted_events || 0;
            document.getElementById('lastAck').textContent = data.last_ack
                ? new Date(data.last_ack).toLocaleString()
                : 'No uploads confirmed yet';
            document.getElementById('logout').hidden = !data.account;
        } catch (_error) {
            if (version !== refreshVersion) return;
            document.getElementById('connectionState').textContent = 'Local server is unavailable';
        }
    }

    /** Submit credential actions through same-origin CSRF protection, without browser token storage. */
    async function action(path, body) {
        if (busy) return;
        busy = true;
        // Fence an earlier status poll so it cannot repaint an obsolete account.
        refreshVersion++;
        document.getElementById('signin').disabled = true;
        document.getElementById('logout').disabled = true;
        message(path.endsWith('/login') ? 'Signing in…' : 'Signing out…', false);
        try {
            if (!csrf) {
                var token = await fetch('/api/cloud/csrf');
                csrf = (await token.json()).csrf;
            }
            var response = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-ICB-CSRF': csrf },
                body: JSON.stringify(body)
            });
            await response.json();
            message(
                response.ok
                    ? path.endsWith('/login')
                        ? 'Signed in. Your dashboards are ready.'
                        : 'Signed out.'
                    : path.endsWith('/login')
                    ? 'Sign-in failed. Check your username, password and cloud connection.'
                    : 'Sign-out failed. Please try again.',
                !response.ok
            );
        } finally {
            busy = false;
            document.getElementById('signin').disabled = false;
            document.getElementById('logout').disabled = false;
        }
        await refresh();
    }

    document.getElementById('login').addEventListener('submit', async function (event) {
        event.preventDefault();
        var password = document.getElementById('password');
        try {
            await action('/api/cloud/login', {
                username: document.getElementById('username').value.trim(),
                password: password.value
            });
        } catch (_error) {
            message('Cloud sign-in is unavailable. Please try again.', true);
        } finally {
            password.value = '';
        }
    });
    document.getElementById('logout').addEventListener('click', function () {
        action('/api/cloud/logout', {}).catch(function () {
            message('Sign-out failed. Please try again.', true);
        });
    });
    refresh();
    setInterval(function () {
        if (!busy) refresh();
    }, 5000);
})();
