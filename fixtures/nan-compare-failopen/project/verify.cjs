'use strict';
const { f } = require('./bounds.cjs');
const cases = [[5, 10, true], [10, 10, true], [11, 10, false], [-1, 10, false], [NaN, 10, false], [Infinity, 10, false]];
let bad = 0;
for (const [x, max, exp] of cases) if (f(x, max) !== exp) bad++;
process.exit(bad > 0 ? 1 : 0);
