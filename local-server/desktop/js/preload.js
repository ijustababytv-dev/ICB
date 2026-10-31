// ICB Desktop Widgets - runs inside every widget window.
// In Move mode it lays a pink frame over the widget: drag anywhere to move it,
// drag the corner grip to resize. When locked it removes itself (clicks pass through).
const { ipcRenderer } = require('electron');
let box = null;
function build(name) {
    box = document.createElement('div');
    box.id = '__icb_move';
    box.style.cssText =
        'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;box-sizing:border-box;border:3px dashed #ff8fd8;' +
        'background:rgba(183,124,255,.18);-webkit-app-region:drag;cursor:move;font:800 14px "Segoe UI",sans-serif;color:#fff;';
    const lab = document.createElement('div');
    lab.style.cssText =
        'position:absolute;left:6px;top:6px;padding:3px 10px;border-radius:999px;background:#ff8fd8;color:#1b0f2a;';
    lab.textContent = '✥ ' + name + ' - drag to move';
    const grip = document.createElement('div');
    grip.style.cssText =
        'position:absolute;right:0;bottom:0;width:26px;height:26px;background:#ff8fd8;border-top-left-radius:10px;-webkit-app-region:no-drag;cursor:nwse-resize;' +
        'display:flex;align-items:center;justify-content:center;color:#1b0f2a;font-size:16px;';
    grip.textContent = '⤡';
    let on = false;
    grip.addEventListener('pointerdown', (e) => {
        on = true;
        grip.setPointerCapture(e.pointerId);
        ipcRenderer.send('resize-start');
        e.preventDefault();
    });
    grip.addEventListener('pointermove', () => {
        if (on) ipcRenderer.send('resize-move');
    });
    const end = () => {
        if (on) {
            on = false;
            ipcRenderer.send('resize-end');
        }
    };

    grip.addEventListener('pointerup', end);
    grip.addEventListener('lostpointercapture', end);
    box.appendChild(lab);
    box.appendChild(grip);
    (document.body || document.documentElement).appendChild(box);
}

ipcRenderer.on('edit', (_e, info) => {
    const go = () => {
        if (box) {
            box.remove();
            box = null;
        }
        if (info && info.on) build(info.name);
    };

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
});
