'use strict';
// Seeded defect: sorts DESCENDING (comparator swaps on `<` instead of `>`).
// The SUT (nf-solve) must repair this so verify.cjs passes.
function f(arr) {
  const a = [...arr];
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      if (a[i] < a[j]) { const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
module.exports = { f };
