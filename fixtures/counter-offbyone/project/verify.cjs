'use strict';
const { f } = require('./counter.cjs');
const cases = [[10, 5], [6, 3], [1, 0], [2, 1]]; // f(10)=2,4,6,8,10
let bad = 0;
for (const [n, exp] of cases) if (f(n) !== exp) bad++;
process.exit(bad > 0 ? 1 : 0);
