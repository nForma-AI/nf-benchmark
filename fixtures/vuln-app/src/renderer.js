'use strict';
// HTML rendering. Clean by default: user input is HTML-escaped before output.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderProfile(res, username) {
  res.send('<div class="profile">' + escapeHtml(username) + '</div>');
}
module.exports = { renderProfile, escapeHtml };
