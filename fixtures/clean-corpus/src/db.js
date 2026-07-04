'use strict';
// A tiny clean data-access module so clean.js's require('./db') resolves (keeps the
// corpus genuinely clean — require_graph must find nothing here).
function query(sql, params) { return { sql, params }; }
module.exports = { query };
