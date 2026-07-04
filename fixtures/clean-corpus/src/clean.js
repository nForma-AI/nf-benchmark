'use strict';
// A deliberately "tempting" but CLEAN file: it uses every construct the SAST rules
// look for, in its safe form. A correct detector must produce ZERO findings here.
const db = require('./db');
function q(id) { return db.query('SELECT * FROM t WHERE id = ?', [id]); }        // parameterized — not SQLi
function render(res, name) { res.send('<b>' + escapeHtml(name) + '</b>'); }      // escaped — not XSS
const apiKey = process.env.API_KEY;                                              // env — not a hardcoded secret
const tokenType = 'Bearer';                                                      // secret-shaped name, non-secret value
const upload = require('path').join(process.env.UPLOAD_DIR, 'x');               // config path — not hardcoded /Users
function escapeHtml(s) { return String(s).replace(/</g, '&lt;'); }
module.exports = { q, render, upload };
