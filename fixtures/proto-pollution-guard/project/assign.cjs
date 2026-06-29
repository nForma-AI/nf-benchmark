'use strict';
// Seeded defect: deep-set walks a key PATH and assigns at the leaf with no guard,
// so a path like ['__proto__','polluted'] reaches Object.prototype and pollutes it
// for every object in the process. Fix: reject __proto__/constructor/prototype while
// walking (or build intermediate objects with Object.create(null)).
function f(dst, keys, val) {
  let o = dst;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = val;
  return dst;
}
module.exports = { f };
