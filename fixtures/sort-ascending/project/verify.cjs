'use strict';
// Self-contained verify: exits 0 iff sort.cjs sorts ascending. Exits 1 while the
// defect is present. This IS the challenge's spec — no dependency on any host repo.
const { f } = require('./sort.cjs');
const cases = [
  [[3, 1, 2], [1, 2, 3]],
  [[5, 4, 3, 2, 1], [1, 2, 3, 4, 5]],
  [[42], [42]],
  [[], []],
];
let failed = 0;
for (const [input, expected] of cases) {
  if (JSON.stringify(f(input)) !== JSON.stringify(expected)) failed++;
}
process.exit(failed > 0 ? 1 : 0);
