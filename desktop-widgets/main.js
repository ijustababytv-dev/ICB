// ICB Desktop Widgets (Baby, 2026-10-11)
// Shows ICB widgets (or any link) in see-through, always-on-top windows on the desktop.
// Everything is controlled from the ICB dashboard: http://127.0.0.1:8790/desktop-control.html
// This app only follows what the server says (GET /api/desktop every second) and reports
// back her screens and any widget she drags in Move mode.
const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, globalShortcut, shell, session } = require('electron');
const path = require('path');
const http = require('http');

const ICB = process.env.ICB_URL || 'http://127.0.0.1:8790';
const VERSION = '1.3.0';
if (process.env.ICB_FAKE_CAM) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }
const wins = new Map();          // widget id -> { win, url, lastLocal, reloadAt, state }
let state = { move: false, hideAll: false, widgets: [] };
let tray = null, online = false;

// Only one copy at a time (double-clicking the launcher again does nothing).
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

function req(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(ICB + p);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: 3000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let s = ''; res.on('data', c => { s += c; }); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (_e) { resolve(null); } });
    });
    r.on('error', () => resolve(null)); r.on('timeout', () => { r.destroy(); resolve(null); });
    if (data) r.write(data); r.end();
  });
}

function displaysInfo() {
  const p = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(d => ({ id: d.id, x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, primary: d.id === p, scale: d.scaleFactor }));
}
function report(extra) { return req('POST', '/api/desktop/app', Object.assign({ version: VERSION, displays: displaysInfo() }, extra || {})); }

function editInfo(w) { return { on: !!(state.move && !w.locked), name: w.name || 'Widget' }; }

function makeWin(w) {
  const win = new BrowserWindow({
    x: w.x, y: w.y, width: w.w, height: w.h,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, title: 'ICB ' + (w.name || 'Widget'),
    // Own session per widget (2026-10-11): Chromium remembers zoom per website, so two widgets
    // from the same site (e.g. two Meld elements) would share one zoom. Separate partitions fix that.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: 'persist:widget-' + w.id }
  });
  setupSession(win.webContents.session);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setMenu(null);
  const rec = { win, url: w.url, lastLocal: 0, reloadAt: w.reloadAt || 0, zoom: 0, moveT: null, id: w.id };
  win.webContents.on('did-finish-load', () => { win.webContents.send('edit', editInfo(cur(w.id) || w)); applyZoom(rec, cur(w.id) || w, true); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // She dragged it: remember the new spot on the server (and don't snap back meanwhile).
  win.on('move', () => {
    rec.lastLocal = Date.now();
    clearTimeout(rec.moveT);
    rec.moveT = setTimeout(() => { const b = win.getBounds(); report({ bounds: { id: w.id, x: b.x, y: b.y, w: b.width, h: b.height } }); }, 350);
  });
  win.loadURL(w.url).catch(() => {});
  wins.set(w.id, rec);
  return rec;
}
const cur = id => state.widgets.find(x => x.id === id);

// Webcam widget (2026-10-11): let ICB pages use the camera without asking every time.
const icbOrigin = new URL(ICB).origin, isIcb = (u) => { try { return new URL(String(u)).origin === icbOrigin; } catch (_e) { return false; } };
const sessionsDone = new WeakSet();
function setupSession(ses) {
  if (sessionsDone.has(ses)) return; sessionsDone.add(ses);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm === 'media' ? isIcb(details.requestingUrl || wc.getURL()) : true));
  ses.setPermissionCheckHandler((wc, perm, origin) => (perm === 'media' ? isIcb(origin) : true));
}

function applyZoom(rec, w, force) {
  const z = (w.zoom || 100) / 100;
  if (force || rec.zoom !== z) { rec.zoom = z; try { rec.win.webContents.setZoomFactor(z); } catch (_e) {} }
}

function apply() {
  const want = new Set();
  for (const w of state.widgets) {
    if (!w.on || state.hideAll) continue;
    want.add(w.id);
    let rec = wins.get(w.id);
    if (!rec) rec = makeWin(w);
    const win = rec.win;
    if (rec.url !== w.url) { rec.url = w.url; win.loadURL(w.url).catch(() => {}); }
    if ((w.reloadAt || 0) > rec.reloadAt) { rec.reloadAt = w.reloadAt; win.webContents.reloadIgnoringCache(); }
    // Position / size from the dashboard (skip right after she dragged it herself).
    if (Date.now() - rec.lastLocal > 2000 && !rec.resizing) {
      const b = win.getBounds();
      if (b.x !== w.x || b.y !== w.y || b.width !== w.w || b.height !== w.h) { rec.lastLocal = 0; win.setBounds({ x: w.x, y: w.y, width: w.w, height: w.h }); rec.lastLocal = 0; }
    }
    const op = (w.opacity || 100) / 100; if (Math.abs(win.getOpacity() - op) > 0.001) win.setOpacity(op);
    applyZoom(rec, w, false);
    const edit = editInfo(w);
    const click = !!(edit.on || w.clickable);   // "Clickable" widgets (v1.3.0) take clicks/typing even when locked
    if (rec.edit !== edit.on || rec.name !== edit.name || rec.click !== click) {
      rec.edit = edit.on; rec.name = edit.name; rec.click = click;
      win.setIgnoreMouseEvents(!click, { forward: true });
      win.setFocusable(click);
      win.webContents.send('edit', edit);
    }
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }
  for (const [id, rec] of wins) if (!want.has(id)) { try { rec.win.destroy(); } catch (_e) {} wins.delete(id); }
  updateTray();
}

async function poll() {
  const d = await req('GET', '/api/desktop?app=1');
  const was = online; online = !!(d && d.ok);
  if (online) { state = d; apply(); }
  if (was !== online) updateTray();
}

// Corner grip resize (transparent windows can't use the normal Windows edges).
ipcMain.on('resize-start', (e) => { for (const r of wins.values()) if (r.win.webContents === e.sender) { r.resizing = r.win.getBounds(); r.cursor = screen.getCursorScreenPoint(); } });
ipcMain.on('resize-move', (e) => {
  for (const r of wins.values()) if (r.win.webContents === e.sender && r.resizing) {
    const c = screen.getCursorScreenPoint(), s = r.resizing;
    r.win.setBounds({ x: s.x, y: s.y, width: Math.max(60, s.width + c.x - r.cursor.x), height: Math.max(40, s.height + c.y - r.cursor.y) });
  }
});
ipcMain.on('resize-end', (e) => {
  for (const r of wins.values()) if (r.win.webContents === e.sender && r.resizing) {
    r.resizing = null; r.lastLocal = Date.now(); const b = r.win.getBounds();
    report({ bounds: { id: r.id, x: b.x, y: b.y, w: b.width, h: b.height } });
  }
});

function trayIcon() {
  // little pink rounded square with a white dot (no image file needed)
  const s = 32, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4, dx = x - 15.5, dy = y - 15.5, inBox = Math.abs(dx) < 14 && Math.abs(dy) < 14, dot = dx * dx + dy * dy < 36;
    const c = dot ? [255, 255, 255, 255] : inBox ? [216, 143, 255, 255] : [0, 0, 0, 0];
    buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = c[3];   // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip('ICB Desktop Widgets' + (online ? (state.move ? ' - MOVE MODE' : '') : ' - ICB server not running'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: online ? `ICB connected - ${state.widgets.filter(w => w.on).length} widget(s)` : 'ICB server not running', enabled: false },
    { type: 'separator' },
    { label: 'Move mode (Ctrl+Alt+M)', type: 'checkbox', checked: !!state.move, enabled: online, click: () => req('POST', '/api/desktop', { toggleMove: true }).then(poll) },
    { label: 'Hide all widgets', type: 'checkbox', checked: !!state.hideAll, enabled: online, click: (m) => req('POST', '/api/desktop', { hideAll: m.checked }).then(poll) },
    { label: 'Open dashboard', click: () => shell.openExternal(ICB + '/desktop-control.html') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

app.whenReady().then(() => {
  setupSession(session.defaultSession);
  tray = new Tray(trayIcon());
  tray.on('click', () => shell.openExternal(ICB + '/desktop-control.html'));
  updateTray();
  globalShortcut.register('Control+Alt+M', () => { req('POST', '/api/desktop', { toggleMove: true }).then(poll); });
  report();
  screen.on('display-added', () => report()); screen.on('display-removed', () => report()); screen.on('display-metrics-changed', () => report());
  poll(); setInterval(poll, 1000); setInterval(() => { if (online) report(); }, 5000);
});
app.on('window-all-closed', (e) => { /* keep running in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
