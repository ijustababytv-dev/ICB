/** Daily and weekly checklist rendering and editing. Loaded before the page startup script. */
function todoRowHtml(list, it) {
    if (it.kind === 'goal') {
        const complete = it.current >= it.target;
        return `<div class="td-i${complete ? ' done' : ''}" data-td="${it.id}" data-list="${list}">
        <span class="td-t" data-td-edit data-td="${
            it.id
        }" data-list="${list}" title="Click to edit progress or target">${phEsc(it.text)}</span>
        <span class="td-goal">${it.current.toLocaleString()}/${it.target.toLocaleString()}</span>
        <div class="td-btns">
          <button data-td-adj="-1" data-td="${it.id}" data-list="${list}">−</button>
          <button data-td-adj="1" data-td="${it.id}" data-list="${list}">+</button>
        </div>
        <button class="td-del" data-td-del data-td="${
            it.id
        }" data-list="${list}" title="Delete">×</button>
      </div>`;
    }
    return `<div class="td-i${it.done ? ' done' : ''}" data-td="${it.id}" data-list="${list}">
      <span class="td-check" data-td-toggle data-td="${it.id}" data-list="${list}">${
        it.done ? '✓' : '☐'
    }</span>
      <span class="td-t" data-td-toggle data-td="${it.id}" data-list="${list}">${phEsc(
        it.text
    )}</span>
      <button class="td-del" data-td-del data-td="${
          it.id
      }" data-list="${list}" title="Delete">×</button>
    </div>`;
}

function todoRender() {
    for (const list of ['daily', 'weekly']) {
        const el = $(TODO_DOM[list] + 'List');
        if (!el) continue;
        const items = TODOS[list] || [];
        el.innerHTML = items.length
            ? items.map((it) => todoRowHtml(list, it)).join('')
            : '<div class="td-empty">Nothing here yet.</div>';
    }
}

async function todoCall(url, body, method = 'PUT') {
    const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const d = await r.json().catch(() => ({}));
    if (d.todos) {
        TODOS = d.todos;
        todoRender();
    }
    if (!r.ok && d.error) {
        alert(d.error);
        log('todo: ' + d.error);
    }
    return d;
}

function todoFindItem(list, id) {
    return (TODOS[list] || []).find((x) => x.id === id);
}

function todoAdd(list) {
    const p = TODO_DOM[list];
    const textInput = $(p + 'Text'),
        kindSelect = $(p + 'Kind'),
        targetInput = $(p + 'Target');
    const text = textInput.value.trim();
    if (!text) {
        textInput.focus();
        return;
    }
    const kind = kindSelect.value;
    const body = { text, kind };
    if (kind === 'goal') {
        const target = Number(targetInput.value);
        if (!target || target <= 0) {
            targetInput.focus();
            return;
        }
        body.target = target;
    }
    todoCall(`/api/todos/${list}`, body, 'POST').then((out) => {
        if (out && out.ok) {
            textInput.value = '';
            targetInput.value = '';
            textInput.focus();
        }
    });
}
