#!/usr/bin/env node
'use strict';

const path = require('path');
const { validateAll, printSummary } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));

const results = validateAll();
const valid = results.filter(r => r.valid).length;
const invalid = results.filter(r => !r.valid).length;

printSummary();

console.log('\nValidation Results:');
console.log(`  Valid: ${valid}`);
console.log(`  Invalid: ${invalid}`);

if (invalid > 0) {
  console.log('\nErrors:');
  for (const r of results.filter(r => !r.valid)) {
    console.log(`  ${r.id}:`);
    for (const e of r.errors) {
      console.log(`    - ${e}`);
    }
  }
  process.exit(1);
}

console.log('\nAll challenges valid!\n');
