const $ = id => document.getElementById(id);

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `Request to ${path} failed.`);
  return body;
}

function renderState(state) {
  const filled = (state.board || []).filter(b => b.kind === 'item').length;
  $('stFilled').textContent = filled;
  $('btnSpin').disabled = !state.canSpin;

  const reveal = $('reveal');
  if (state.revealed) {
    if (state.revealed.kind === 'item') {
      const it = state.revealed.item;
      reveal.innerHTML = `Landed on: <b style="color:#ffd94a;">${it.name}</b>${it.type === 'points' ? ` (${it.points} pts)` : ''}`;
    } else {
      reveal.innerHTML = `<i>Empty box — add plushies to the pool.</i>`;
    }
  } else {
    reveal.innerHTML = '';
  }

  $('log').innerHTML = (state.log || []).map(e =>
    `<div>${new Date(e.at).toLocaleTimeString()} — ${e.message}</div>`).join('');
}

async function run(path) {
  try {
    const state = await api(path, { method: 'POST' });
    renderState(state);
  } catch (e) {
    alert(e.message);
  }
}

$('btnShuffle').onclick = () => run('/api/tradeup/shuffle');
$('btnSpin').onclick = () => run('/api/tradeup/spin');
$('btnClear').onclick = () => run('/api/tradeup/clear');

$('itemType').onchange = () => {
  $('pointsRow').style.display = $('itemType').value === 'points' ? 'block' : 'none';
};

$('btnAddItem').onclick = async () => {
  const name = $('itemName').value.trim();
  if (!name) return alert('Name is required.');
  const type = $('itemType').value;
  const payload = { name, type };
  if (type === 'points') payload.points = Number($('itemPoints').value) || 0;

  const fileInput = $('itemImage');
  if (fileInput.files && fileInput.files[0]) {
    payload.imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(fileInput.files[0]);
    });
  }

  try {
    const res = await api('/api/tradeup/items', { method: 'POST', body: JSON.stringify(payload) });
    $('itemName').value = '';
    $('itemImage').value = '';
    renderCatalog(res.config.items);
    $('stCatalog').textContent = res.config.items.length;
  } catch (e) {
    alert(e.message);
  }
};

function renderCatalog(items) {
  $('catalogBody').innerHTML = items.map(it => `
    <tr>
      <td>${it.image ? `<img class="thumb" src="${it.image}">` : ''}</td>
      <td>${it.name}${it.type === 'points' ? ` (${it.points} pts)` : ''}</td>
      <td>${it.type}</td>
      <td>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" id="img-${it.id}" onchange="replaceImage('${it.id}')">
        <button onclick="document.getElementById('img-${it.id}').click()">${it.image ? '🖼 Replace' : '🖼 Add image'}</button>
        <button class="danger" onclick="deleteItem('${it.id}')">✕</button>
      </td>
    </tr>
  `).join('');
}

window.replaceImage = async (id) => {
  const fileInput = $(`img-${id}`);
  if (!fileInput.files || !fileInput.files[0]) return;
  try {
    const imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(fileInput.files[0]);
    });
    const res = await api(`/api/tradeup/items/${id}`, { method: 'PUT', body: JSON.stringify({ imageDataUrl }) });
    renderCatalog(res.config.items);
  } catch (e) {
    alert(e.message);
  }
};

window.deleteItem = async (id) => {
  if (!confirm('Remove this from the pool?')) return;
  try {
    const res = await api(`/api/tradeup/items/${id}`, { method: 'DELETE' });
    renderCatalog(res.config.items);
    $('stCatalog').textContent = res.config.items.length;
  } catch (e) {
    alert(e.message);
  }
};

async function init() {
  const state = await api('/api/tradeup/state');
  renderState(state);
  const cfg = await api('/api/tradeup/config');
  renderCatalog(cfg.config.items);
  $('stCatalog').textContent = cfg.config.items.length;
}

async function poll() {
  try {
    const state = await api('/api/tradeup/state');
    renderState(state);
  } catch (e) {}
}

init();
setInterval(poll, 2000);
