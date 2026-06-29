'use strict';
const { f } = require('./size.cjs');
const cases = [[{ items: [1, 2, 3] }, 3], [{ items: [] }, 0], [{}, 0], [null, 0], [undefined, 0]];
let bad = 0;
for (const [inp, exp] of cases) { try { if (f(inp) !== exp) bad++; } catch (_) { bad++; } }
process.exit(bad > 0 ? 1 : 0);
