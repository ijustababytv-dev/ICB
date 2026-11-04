'use strict';
(function () {
    if (!document.body.hasAttribute('data-workspace')) return;
    const model = window.ICBNavModel;
    let extra = [],
        refreshed = 0;
    const sidebar = document.getElementById('workspace-sidebar');
    const topbar = document.getElementById('workspace-topbar');
    const mobile = matchMedia('(max-width: 960px)');
    const toggle = document.createElement('button'),
        backdrop = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ws-menu-toggle';
    toggle.textContent = '☰';
    toggle.setAttribute('aria-label', 'Open navigation');
    toggle.setAttribute('aria-controls', 'workspace-sidebar');
    toggle.setAttribute('aria-expanded', 'false');
    backdrop.type = 'button';
    backdrop.className = 'ws-nav-backdrop';
    backdrop.setAttribute('aria-label', 'Close navigation');
    document.body.appendChild(backdrop);
    topbar.appendChild(toggle);
    const picker = window.ICBPageSearch.mount(topbar, () => model.catalog(extra));
    const connection = document.createElement('span');
    connection.className = 'ws-connection';
    connection.textContent = 'Connected';
    connection.setAttribute('role', 'status');
    if (!document.getElementById('health')) connection.id = 'health';
    topbar.appendChild(connection);
    const featureHealth = document.getElementById('health');
    if (featureHealth && featureHealth !== connection) {
        /** Follow the feature's existing status instead of starting another health-poll loop. */
        function healthChanged() {
            connection.textContent = featureHealth.textContent;
            connection.classList.toggle(
                'offline',
                /offline|disconnected|error/i.test(featureHealth.textContent)
            );
        }

        new MutationObserver(healthChanged).observe(featureHealth, {
            childList: true,
            subtree: true,
            characterData: true
        });
        healthChanged();
    }

    /** Use regular links so modified clicks, new tabs and copying addresses keep working. */
    function link(page, className) {
        const node = document.createElement('a');
        node.href = page.url;
        node.textContent = page.label;
        if (className) node.className = className;
        if (model.safeURL(location.pathname) === page.url)
            node.setAttribute('aria-current', 'page');
        if (/^https?:/.test(page.url)) {
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
        }
        return node;
    }

    /** Preserve expanded sections when account-created decor/custom links refresh. */
    function renderSidebar() {
        const opened = new Set(
            [...sidebar.querySelectorAll('details[open]')].map((entry) => entry.dataset.category)
        );
        sidebar.replaceChildren();
        const brand = document.createElement('div');
        brand.className = 'ws-brand';
        brand.innerHTML =
            '<span class="ws-brand-symbol" aria-hidden="true">✦</span><div><strong>ICB</strong><small>Stream workspace</small></div>';
        sidebar.appendChild(brand);
        const home = link({ url: '/', label: 'Home' }, 'ws-home');
        const homeIcon = document.createElement('span');
        homeIcon.textContent = '⌂';
        homeIcon.setAttribute('aria-hidden', 'true');
        home.prepend(homeIcon);
        sidebar.appendChild(home);
        const label = document.createElement('div');
        label.className = 'ws-side-label';
        label.textContent = 'Workspace';
        sidebar.appendChild(label);
        const sections = document.createElement('nav');
        sections.className = 'ws-sections';
        sections.setAttribute('aria-label', 'Workspace sections');
        const pages = model.catalog(extra);
        for (const category of model.categories) {
            const details = document.createElement('details'),
                summary = document.createElement('summary'),
                icon = document.createElement('span'),
                title = document.createElement('span'),
                list = document.createElement('ul');
            details.className = 'ws-category';
            details.dataset.category = category.id;
            icon.className = 'ws-side-icon';
            icon.textContent = category.icon;
            icon.setAttribute('aria-hidden', 'true');
            title.textContent = category.label;
            summary.append(icon, title);
            details.appendChild(summary);
            const entries = model.alphabetical(
                pages.filter((page) => page.category === category.id)
            );
            details.open =
                opened.has(category.id) ||
                entries.some((page) => page.url === model.safeURL(location.pathname));
            for (const page of entries) {
                const item = document.createElement('li');
                item.appendChild(link(page));
                list.appendChild(item);
            }
            details.appendChild(list);
            sections.appendChild(details);
        }
        sidebar.appendChild(sections);
        const allPages = link({ url: '/all-pages.html', label: 'All pages' }, 'ws-all-pages');
        const allIcon = document.createElement('span');
        allIcon.textContent = '⌕';
        allIcon.setAttribute('aria-hidden', 'true');
        allPages.prepend(allIcon);
        sidebar.appendChild(allPages);
        sidebar.inert = mobile.matches && !document.body.classList.contains('ws-nav-open');
        window.dispatchEvent(new Event('icb-catalog'));
        picker.refresh();
    }

    /** Keep sidebar/search/catalog views aligned without persisting rewritten names to the cloud. */
    function updateRuntime(hub, decor) {
        extra = extra
            .filter((page) => (hub ? !page.custom : true))
            .filter((page) => (decor ? !page.decor : true));
        if (hub?.tiles)
            for (const tile of hub.tiles.filter((tile) => !tile.builtin)) {
                if (model.safeURL(tile.url))
                    extra.push({
                        url: tile.url,
                        label: tile.name,
                        category: 'connections',
                        custom: true
                    });
            }
        if (decor?.effects)
            for (const effect of decor.effects) {
                if (/^[a-z0-9-]+$/.test(effect.id) && !['all', 'leaves'].includes(effect.id))
                    extra.push({
                        url: '/decor/' + effect.id + '.html',
                        label: (effect.name || effect.id) + ' — Decor Overlay',
                        category: 'decor',
                        decor: true
                    });
            }
        renderSidebar();
    }

    /** Read confirmed account-created links on focus, avoiding another background poll loop. */
    async function refresh() {
        if (Date.now() - refreshed < 15000) return;
        refreshed = Date.now();
        const replies = await Promise.allSettled(
            ['/api/hub', '/api/decor/state'].map(async (url) => {
                const response = await fetch(url);
                return response.ok ? response.json() : null;
            })
        );
        updateRuntime(
            replies[0].status === 'fulfilled' ? replies[0].value : null,
            replies[1].status === 'fulfilled' ? replies[1].value : null
        );
    }

    /** Show the mobile drawer while keeping offscreen navigation out of the tab order. */
    function setOpen(open) {
        document.body.classList.toggle('ws-nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        sidebar.inert = mobile.matches && !open;
        if (open) sidebar.querySelector('.ws-home').focus();
        else toggle.focus();
    }

    toggle.addEventListener('click', () =>
        setOpen(!document.body.classList.contains('ws-nav-open'))
    );
    backdrop.addEventListener('click', () => setOpen(false));
    /** Capture intended page openings before navigation, including modified/new-tab clicks. */
    function opened(event) {
        const anchor = event.target.closest('a[href]');
        if (
            !anchor ||
            !window.ICBVisits ||
            !window.ICBLocalAccount ||
            (event.button != null && event.button > 1)
        )
            return;
        const url = new URL(anchor.href, location.origin);
        if (url.origin === location.origin)
            window.ICBVisits.open(window.ICBLocalAccount.id, url.pathname);
    }

    document.addEventListener('click', opened);
    document.addEventListener('auxclick', opened);
    mobile.addEventListener('change', () => {
        sidebar.inert = mobile.matches && !document.body.classList.contains('ws-nav-open');
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.body.classList.contains('ws-nav-open'))
            setOpen(false);
        if (
            event.key === 'Tab' &&
            mobile.matches &&
            document.body.classList.contains('ws-nav-open')
        ) {
            const nodes = [...sidebar.querySelectorAll('a, summary')].filter(
                (node) => node.getClientRects().length
            );
            if (event.shiftKey && document.activeElement === nodes[0]) {
                event.preventDefault();
                nodes.at(-1).focus();
            }
            if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
                event.preventDefault();
                nodes[0].focus();
            }
        }
    });
    window.ICBWorkspace = {
        pages: () => model.catalog(extra),

        updateHub: (hub) => updateRuntime(hub, null),

        refresh
    };
    renderSidebar();
    refresh();
    window.addEventListener('focus', refresh);
})();
