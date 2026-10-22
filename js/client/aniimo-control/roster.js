/** Aniimo roster editing and variant management. Loaded before the page startup script. */
function editA(id) {
    editing = id;
    var a = id
        ? A(id)
        : {
              name: '',
              number: '',
              element: '',
              variants: [
                  'Basic Form',
                  'Prismana (rare)',
                  'Sparkling mutation',
                  'Alpha mutation',
                  'Mini mutation',
                  'Umbral variant'
              ]
          };
    $('mTitle').textContent = id ? 'Edit ' + a.name : 'Add an Aniimo';
    $('mName').value = a.name;
    $('mNum').value = a.number;
    $('mEl').value = a.element;
    $('mVars').value = a.variants.join('\n');
    $('mDel').style.display = id ? '' : 'none';
    $('modal').className = 'modal on';
    $('mName').focus();
    $('picBox').style.display = id ? '' : 'none';
    $('picNew').style.display = id ? 'none' : '';
    if (id) showPic();
}

function closeM() {
    $('modal').className = 'modal';
}

function saveA() {
    var b = {
        id: editing || '',
        name: $('mName').value,
        number: $('mNum').value,
        element: $('mEl').value,
        variants: $('mVars').value.split(/\r?\n/)
    };
    if (editing) {
        var a = A(editing),
            gone = a.variants.filter(function (v) {
                return (
                    b.variants
                        .map(function (x) {
                            return x.trim();
                        })
                        .indexOf(v) < 0 && S.checked[key(a, v)]
                );
            });
        if (
            gone.length &&
            !confirm('These ticked forms will be removed: ' + gone.join(', ') + '. Continue?')
        )
            return;
    }
    api('/api/aniimo', { saveAniimo: b }).then(function (r) {
        if (r.ok === false) alert(r.error);
        else {
            closeM();
            load();
        }
    });
}

function delA() {
    var a = A(editing);
    if (confirm('Remove ' + a.name + ' and its ticks from the list?'))
        set({ removeAniimo: editing }).then(closeM);
}

function addFormAll() {
    var v = $('formAll').value.trim();
    if (v && confirm('Add "' + v + '" to all ' + S.roster.length + ' Aniimo?'))
        set({ addFormAll: v }).then(function () {
            $('formAll').value = '';
        });
}

function renameForm() {
    var f = $('rnFrom').value.trim(),
        t = $('rnTo').value.trim();
    if (f && t)
        set({ renameForm: { from: f, to: t } }).then(function () {
            $('rnFrom').value = '';
            $('rnTo').value = '';
        });
}
