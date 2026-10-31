'use strict';
(function () {
    var csrf = '';

    /** Render public status only; bearer tokens remain inside the local Node process. */
    async function refresh() {
        try {
            var response = await fetch('/api/cloud/status');
            var data = await response.json();
            document.getElementById('cloudStatus').textContent =
                'Account: ' +
                (data.account ? data.account.username : 'signed out') +
                '\n' +
                'API configured: ' +
                (data.configured ? 'yes' : 'no') +
                '\n' +
                'Pending uploads: ' +
                data.pending +
                '\nQuarantined uploads: ' +
                (data.quarantined || 0) +
                '\nUncounted provider events: ' +
                (data.uncounted_events || 0) +
                '\n' +
                'Last acknowledgment: ' +
                (data.last_ack || 'none') +
                '\nStatus: ' +
                (data.code || 'ready');
        } catch (_error) {
            document.getElementById('cloudStatus').textContent = 'Local server is unavailable.';
        }
    }

    /** Submit credential actions through same-origin CSRF protection, without browser token storage. */
    async function action(path, body) {
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
        document.getElementById('result').textContent = response.ok
            ? 'Account updated.'
            : data.code || 'Request failed.';
        await refresh();
    }

    document.getElementById('login').addEventListener('submit', async function (event) {
        event.preventDefault();
        var password = document.getElementById('password');
        try {
            await action('/api/cloud/login', {
                username: document.getElementById('username').value,
                password: password.value
            });
        } catch (_error) {
            document.getElementById('result').textContent = 'Cloud sign-in is unavailable.';
        } finally {
            password.value = '';
        }
    });
    document.getElementById('logout').addEventListener('click', function () {
        action('/api/cloud/logout', {}).catch(function () {
            document.getElementById('result').textContent = 'Sign-out failed.';
        });
    });
    refresh();
    setInterval(refresh, 5000);
})();
