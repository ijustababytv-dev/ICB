/** Hunt activity history rendering. Loaded before the page startup script. */
function drawLog(log) {
    $('log').innerHTML = log.length
        ? log
              .map(function (e) {
                  var t = new Date(e.at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit'
                      }),
                      s = '';
                  if (e.kind === 'find')
                      s =
                          '<b>' +
                          esc(e.name) +
                          '</b> ' +
                          (e.n > 0 ? '+' : '') +
                          e.n +
                          ' ' +
                          esc(e.icon || '') +
                          ' ' +
                          esc(e.label || e.item) +
                          ' (' +
                          (e.pts > 0 ? '+' : '') +
                          e.pts +
                          ' pts)' +
                          (e.how === 'dashboard' ? ' <span class="tag">you</span>' : '') +
                          (e.undone
                              ? ''
                              : ' <button class="btn-sm" onclick="post({undo:' +
                                e.id +
                                '})">Undo</button>');
                  else if (e.kind === 'join')
                      s =
                          '<b>' +
                          esc(e.name) +
                          '</b> joined <span style="color:' +
                          teamColor(e.team) +
                          '">' +
                          esc(teamName(e.team)) +
                          '</span>';
                  else if (e.kind === 'move')
                      s = '<b>' + esc(e.name) + '</b> moved to ' + esc(teamName(e.team));
                  else if (e.kind === 'noteam')
                      s =
                          '<b>' +
                          esc(e.name) +
                          '</b> typed !' +
                          esc(e.item) +
                          " but isn't on a team";
                  else if (e.kind === 'start') s = '▶ Hunt started';
                  else if (e.kind === 'end') s = '🏁 Hunt ended';
                  return (
                      '<div class="' +
                      (e.undone ? 'u' : '') +
                      '"><span class="note">' +
                      t +
                      '</span> ' +
                      s +
                      '</div>'
                  );
              })
              .join('')
        : '<div class="note">Nothing yet.</div>';
}
