'use strict';
(function () {
    const body = document.getElementById('ws-directory-body');
    if (!body) return;

    /** List each safe page once in global alphabetical order, including account-created effects. */
    function render() {
        const pages = window.ICBNavModel.alphabetical(window.ICBWorkspace.pages());
        body.replaceChildren();
        for (const page of pages) {
            const row = document.createElement('tr'),
                title = document.createElement('td'),
                section = document.createElement('td'),
                link = document.createElement('a');
            link.href = page.url;
            link.textContent = page.label;
            if (/^https?:/.test(page.url)) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            title.appendChild(link);
            section.textContent =
                window.ICBNavModel.categories.find((category) => category.id === page.category)
                    ?.label || 'Workspace';
            row.append(title, section);
            body.appendChild(row);
        }
        document.getElementById('ws-directory-count').textContent =
            pages.length + ' pages, listed alphabetically.';
    }

    window.addEventListener('icb-catalog', render);
    render();
})();
