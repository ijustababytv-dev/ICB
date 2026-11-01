'use strict';
(function () {
    var csrf = '';
    var busy = false;
    var refreshVersion = 0;

    /** Accept only local page destinations; never turn sign-in into an external redirect. */
    function destination() {
        var next = new URLSearchParams(location.search).get('next') || '/';
        if (!next.startsWith('/') || next.startsWith('//') || /[\\\x00-\x1f]/.test(next))
            return '/';
        var target = new URL(next, location.origin);
        return target.origin === location.origin &&
            !target.pathname.startsWith('//') &&
            target.pathname !== '/cloud.html'
            ? target.pathname + target.search
            : '/';
    }

    /** Resume the requested tool or Home only after the server confirms authentication. */
    function continueToApp() {
        location.replace(destination());
    }

    /** Keep provider codes readable without rendering arbitrary server text as markup. */
    function connectionLabel(data) {
        if (data.auth_code === 'forget_failed') return 'Saved sign-in could not be erased';
        if (data.restoring) return 'Restoring remembered session';
        if (data.auth_code === 'cloud_unavailable') return 'Cloud unavailable; retry saved sign-in';
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
                : data.restoring
                ? 'Restoring saved sign-in…'
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
            document.getElementById('logout').hidden = !data.account && !data.remembered;
            document.getElementById('continue').hidden = !data.account;
            document.getElementById('restore').hidden =
                !data.remembered ||
                !!data.account ||
                !!data.restoring ||
                data.auth_code === 'forget_failed';
            document.getElementById('signin').disabled = !!data.restoring;
            document.getElementById('sessionExpiry').textContent = data.expires_at
                ? new Date(data.expires_at).toLocaleString()
                : 'Sign in to remember this computer';
            if (data.account && /[?&](?:next|startup)=/.test(location.search)) continueToApp();
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
        var signingOut = path.endsWith('/logout');
        message(signingOut ? 'Signing out…' : 'Signing in…', false);
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
            var data = await response.json();
            message(
                response.ok
                    ? signingOut
                        ? 'Signed out. This computer has forgotten your sign-in.'
                        : 'Signed in. Your dashboards are ready.'
                    : data.code === 'forget_failed'
                    ? 'Windows could not erase the saved sign-in. Access is locked; check file permissions and retry Sign out.'
                    : data.code === 'secure_storage_unavailable'
                    ? 'Windows could not securely remember this sign-in. Please try again.'
                    : data.code === 'session_protocol_required'
                    ? 'The cloud sign-in service needs its session update. Please try again after deployment.'
                    : signingOut
                    ? 'Sign-out failed. Please try again.'
                    : 'Sign-in failed. Check your username, password and cloud connection.',
                !response.ok
            );
            if (response.ok && !signingOut) continueToApp();
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
    document.getElementById('restore').addEventListener('click', function () {
        action('/api/cloud/restore', {}).catch(function () {
            message('Saved sign-in is unavailable. Retry or sign in with your password.', true);
        });
    });
    refresh();
    setInterval(function () {
        if (!busy) refresh();
    }, 5000);
})();
