'use strict';
const { f } = require('./filter.cjs');
const cases = [
  [[[1, 2, 3, 4, 5], 3], [3, 4, 5]],
  [[[10, 20, 30], 5], [10, 20, 30]],
  [[[1, 2], 2], [2]],
];
let failed = 0;
for (const [args, expected] of cases) {
  if (JSON.stringify(f(args[0], args[1])) !== JSON.stringify(expected)) failed++;
}
process.exit(failed > 0 ? 1 : 0);
