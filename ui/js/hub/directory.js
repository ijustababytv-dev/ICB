'use strict';
(function () {
    /** Add account-created decor URLs without hiding the static directory when signed out. */
    async function refreshDecorDirectory() {
        var status = document.getElementById('decorDirectoryStatus');
        try {
            var response = await fetch('/api/decor/state');
            var data = await response.json();
            var container = document.getElementById('decorPages');
            container.replaceChildren();
            if (!response.ok || !data.ok || !Array.isArray(data.effects)) {
                status.textContent = 'Sign in to list any additional saved decor effects.';
                return;
            }
            data.effects.forEach(function (effect) {
                // IDs are URL slugs, while labels are untrusted account-provided text.
                if (!/^[a-z0-9-]+$/.test(effect.id) || ['leaves', 'all'].includes(effect.id))
                    return;
                var link = document.createElement('a');
                link.href = '/decor/' + effect.id + '.html';
                link.textContent = (effect.name || effect.id) + ' — Decor Overlay';
                container.appendChild(link);
            });
            status.textContent =
                'Saved decor effects are listed above. Manage them on the Decor dashboard.';
        } catch (_error) {
            document.getElementById('decorPages').replaceChildren();
            status.textContent =
                'Saved decor effects are unavailable. The built-in page links above still work.';
        }
    }

    refreshDecorDirectory();
    window.addEventListener('focus', refreshDecorDirectory);
})();
