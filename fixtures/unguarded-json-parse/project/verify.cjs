'use strict';
const { loadConfig } = require('./config.cjs');
const cases = [['{"a":1}', { a: 1 }], ['', {}], ['not json', {}], ['{bad', {}]];
let bad = 0;
for (const [inp, exp] of cases) { try { const got = loadConfig(inp); if (JSON.stringify(got) !== JSON.stringify(exp)) bad++; } catch (_) { bad++; } }
process.exit(bad > 0 ? 1 : 0);
