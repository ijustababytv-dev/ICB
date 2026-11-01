'use strict';
(function () {
    const panels = document.getElementById('ws-recent-panels');
    const table = document.getElementById('ws-recent-body');
    if (!panels && !table) return;
    let lastWidth = 0;

    /** Show only currently available pages, with each page's most recent opening first. */
    function entries() {
        const account = window.ICBLocalAccount;
        if (!account || !window.ICBVisits || !window.ICBWorkspace) return [];
        const pages = window.ICBWorkspace.pages();
        return window.ICBVisits.read(account.id)
            .map((row) => {
                const page = pages.find((candidate) => candidate.url.split(/[?#]/)[0] === row.url);
                return page ? { ...page, openedAt: row.openedAt } : null;
            })
            .filter(Boolean);
    }

    /** Format UTC storage timestamps using the signed-in account's reporting timezone. */
    function when(value) {
        try {
            return new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: window.ICBLocalAccount?.timezone || 'America/Chicago'
            }).format(value);
        } catch (_error) {
            return new Date(value).toLocaleString();
        }
    }

    /** A clear empty state is preferable to fabricated recent tools on a new account/browser. */
    function empty(parent, text) {
        const paragraph = document.createElement('p');
        paragraph.className = 'ws-empty';
        paragraph.textContent = text;
        parent.appendChild(paragraph);
    }

    /** Fit one row of panels to the available width, with up to four real pages per panel. */
    function renderPanels(rows) {
        const width = panels.getBoundingClientRect().width;
        const columns = Math.max(1, Math.floor((width + 16) / 336));
        panels.style.gridTemplateColumns = 'repeat(' + columns + ',minmax(0,1fr))';
        panels.replaceChildren();
        if (!rows.length) {
            empty(
                panels,
                window.ICBLocalAccount
                    ? 'No recent pages yet. Open a tool from the sidebar or search to get started.'
                    : 'Loading recent pages…'
            );
            return;
        }
        for (let offset = 0; offset < Math.min(rows.length, columns * 4); offset += 4) {
            const panel = document.createElement('div');
            panel.className = 'ws-recent-panel';
            for (const page of rows.slice(offset, offset + 4)) {
                const link = document.createElement('a'),
                    icon = document.createElement('span'),
                    name = document.createElement('span'),
                    arrow = document.createElement('span');
                link.href = page.url;
                link.className = 'ws-recent-item';
                link.title = page.label + '\nLast opened ' + when(page.openedAt);
                icon.className = 'ws-recent-icon';
                icon.textContent =
                    window.ICBNavModel.categories.find((item) => item.id === page.category)?.icon ||
                    '◷';
                icon.setAttribute('aria-hidden', 'true');
                name.className = 'ws-recent-name';
                name.textContent = page.label;
                arrow.className = 'ws-recent-arrow';
                arrow.textContent = '›';
                arrow.setAttribute('aria-hidden', 'true');
                link.append(icon, name, arrow);
                panel.appendChild(link);
            }
            panels.appendChild(panel);
        }
    }

    /** The complete recent-page view is a table ordered by last opening, not by page title. */
    function renderTable(rows) {
        table.replaceChildren();
        for (const page of rows) {
            const row = document.createElement('tr'),
                title = document.createElement('td'),
                category = document.createElement('td'),
                opened = document.createElement('td'),
                link = document.createElement('a'),
                time = document.createElement('time');
            link.href = page.url;
            link.textContent = page.label;
            title.appendChild(link);
            category.textContent =
                window.ICBNavModel.categories.find((item) => item.id === page.category)?.label ||
                'Workspace';
            time.dateTime = new Date(page.openedAt).toISOString();
            time.textContent = when(page.openedAt);
            opened.appendChild(time);
            row.dataset.openedAt = page.openedAt;
            row.append(title, category, opened);
            table.appendChild(row);
        }
        const note = document.getElementById('ws-recent-note');
        note.textContent = rows.length
            ? rows.length + ' pages, most recently opened first. Times use your account timezone.'
            : 'No recent pages yet. Open a tool to start your history.';
    }

    /** Share one source for the summary panels and full history list, including changes from other tabs. */
    function render() {
        const rows = entries();
        if (panels) renderPanels(rows);
        if (table) renderTable(rows);
    }

    for (const event of ['icb-account', 'icb-recent', 'icb-catalog'])
        window.addEventListener(event, render);
    window.addEventListener('storage', (event) => {
        if (window.ICBVisits && event.key === window.ICBVisits.key(window.ICBLocalAccount?.id))
            render();
    });
    if (panels)
        new ResizeObserver((changes) => {
            const width = Math.round(changes[0].contentRect.width);
            if (width !== lastWidth) {
                lastWidth = width;
                render();
            }
        }).observe(panels);
    window.ICBRecentPages = { entries, render };
    render();
})();
