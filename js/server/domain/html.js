'use strict';



/** Escape operator-provided text before inserting it into server-rendered HTML. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

Object.assign(exports, { escapeHtml });
