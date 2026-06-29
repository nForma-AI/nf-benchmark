'use strict';
const { f } = require('./assign.cjs');
let bad = 0;
// legitimate deep assignment must still work
const ok = f({ a: {} }, ['a', 'b'], 1);
if (!ok.a || ok.a.b !== 1) bad++;
// a __proto__ path must NOT pollute Object.prototype
f({}, ['__proto__', 'polluted'], true);
if (({}).polluted !== undefined) bad++;
// constructor.prototype path must also be blocked
f({}, ['constructor', 'prototype', 'hacked'], true);
if (({}).hacked !== undefined) bad++;
process.exit(bad > 0 ? 1 : 0);
