'use strict';
// Seeded defect: `x > b` excludes the boundary element x == b (should be `x >= b`).
function f(a, b) { return a.filter(function (x) { return x > b; }); }
module.exports = { f };
