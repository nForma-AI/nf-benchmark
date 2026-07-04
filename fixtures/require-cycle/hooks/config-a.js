'use strict';
// Config hook A. Clean by default: A requires B (a one-way edge, no cycle).
const b = require('./config-b.js');
function loadA() { return { a: true, b: b.loadB() }; }
module.exports = { loadA };
