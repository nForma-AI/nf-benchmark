'use strict';
// Seeded defect: counts evens in 1..n INCLUSIVE, but the loop stops at i < n,
// so it drops n itself. Fix: iterate i <= n.
function f(n) {
  let c = 0;
  for (let i = 1; i < n; i++) if (i % 2 === 0) c++;
  return c;
}
module.exports = { f };
