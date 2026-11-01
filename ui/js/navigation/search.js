'use strict';
(function () {
    /** Mount a keyboard-accessible, close-match page picker without network searches. */
    function mount(root, pages) {
        const box = document.createElement('div');
        box.className = 'ws-search';
        box.innerHTML =
            '<div class="ws-search-field"><span class="ws-search-symbol" aria-hidden="true">⌕</span>' +
            '<input id="ws-page-search" type="search" placeholder="Search pages, overlays, effects…" aria-label="Search all pages" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ws-search-results" autocomplete="off" maxlength="120">' +
            '<kbd aria-hidden="true">Ctrl K</kbd></div><ul class="ws-search-results" id="ws-search-results" role="listbox" aria-label="Matching pages" hidden></ul>';
        root.appendChild(box);
        const input = box.querySelector('input'),
            list = box.querySelector('ul');
        let matches = [],
            selected = -1;

        /** Close suggestions without changing the query or moving keyboard focus. */
        function close() {
            list.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            selected = -1;
        }

        /** Highlight one real suggestion; every option remains a normal clickable link. */
        function select(index) {
            selected = index;
            [...list.children].forEach((option, i) =>
                option.setAttribute('aria-selected', String(i === index))
            );
            if (index >= 0) {
                input.setAttribute('aria-activedescendant', 'ws-search-option-' + index);
                list.children[index].scrollIntoView({ block: 'nearest' });
            }
        }

        /** Rebuild only suggestions, preserving the typed query and the surrounding dashboard. */
        function render() {
            const query = input.value.trim();
            if (query.length < 2) return close();
            matches = window.ICBNavModel.search(pages(), query);
            list.replaceChildren();
            selected = -1;
            input.removeAttribute('aria-activedescendant');
            for (const [i, page] of matches.entries()) {
                const item = document.createElement('li'),
                    link = document.createElement('a'),
                    category = document.createElement('small');
                item.id = 'ws-search-option-' + i;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', 'false');
                link.href = page.url;
                link.textContent = page.label;
                category.textContent =
                    window.ICBNavModel.categories.find((entry) => entry.id === page.category)
                        ?.label || 'Workspace';
                link.appendChild(category);
                item.appendChild(link);
                list.appendChild(item);
            }
            if (!matches.length) {
                const empty = document.createElement('li');
                empty.className = 'ws-search-empty';
                empty.textContent = 'No close matches. Try a page or tool name.';
                empty.setAttribute('role', 'status');
                list.appendChild(empty);
            }
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }

        input.addEventListener('input', (event) => {
            event.stopPropagation();
            render();
        });
        input.addEventListener('change', (event) => event.stopPropagation());
        input.addEventListener('focus', () => {
            if (input.value.trim().length >= 2) render();
        });
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                input.select();
                return;
            }
            if (event.key === 'Escape') {
                close();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (list.hidden) render();
                if (matches.length)
                    select(
                        (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                            matches.length
                    );
            }
            if (event.key === 'Enter' && !list.hidden && matches.length) {
                event.preventDefault();
                list.querySelectorAll('a')[selected < 0 ? 0 : selected].click();
            }
        });
        document.addEventListener('click', (event) => {
            if (!box.contains(event.target)) close();
        });
        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                input.focus();
                input.select();
            }
        });
        return {
            refresh: () => {
                if (!list.hidden) render();
            },

            close
        };
    }

    window.ICBPageSearch = { mount };
})();
