'use strict';
// Seeded defect: dereferences obj.items unconditionally — throws on null/undefined
// or when items is missing. Fix: guard and return 0 for absent collections.
function f(obj) {
  return obj.items.length;
}
module.exports = { f };
