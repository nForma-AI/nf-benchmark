'use strict';
// Seeded defect: returns true for "x is a valid value within [0, max]" using
// !(x > max), but NaN makes every comparison false, so NaN is accepted (fail-open).
// Fix: require a finite number, e.g. Number.isFinite(x) && x >= 0 && x <= max.
function f(x, max) {
  return !(x > max);
}
module.exports = { f };
