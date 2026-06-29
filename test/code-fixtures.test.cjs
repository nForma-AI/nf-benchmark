'use strict';
// Repairability contract for the code-category fix_and_verify fixtures.
// run-fixtures.cjs (CI) proves each defect REPRODUCES (verify fails). These tests
// prove each is REPAIRABLE: a stub SUT that applies the documented fix in the
// isolated temp copy must drive verify to pass (pre fails → post passes). This
// locks in both halves of fix_and_verify without needing a live solve.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runFixture } = require('../lib/fixture-runner.cjs');

const FIX_ROOT = path.join(__dirname, '..', 'fixtures');

// [fixtureId, fileInProject, find, replace] — the minimal documented repair.
const CASES = [
  ['counter-offbyone', 'counter.cjs', '; i < n;', '; i <= n;'],
  ['null-deref-guard', 'size.cjs', 'return obj.items.length;', 'return obj && obj.items ? obj.items.length : 0;'],
  ['proto-pollution-guard', 'assign.cjs', 'o[keys[keys.length - 1]] = val;',
    "for (const k of keys) if (k === '__proto__' || k === 'constructor' || k === 'prototype') return dst;\n  o[keys[keys.length - 1]] = val;"],
  ['nan-compare-failopen', 'bounds.cjs', 'return !(x > max);', 'return Number.isFinite(x) && x >= 0 && x <= max;'],
];

function makeStubFix(fileName, find, replace) {
  return (tempDir) => {
    const fp = path.join(tempDir, fileName);
    const src = fs.readFileSync(fp, 'utf8');
    assert.ok(src.includes(find), `${fileName}: repair pattern not found (${find})`);
    fs.writeFileSync(fp, src.replace(find, replace));
    return { source: 'stub-fix' };
  };
}

for (const [id, file, find, replace] of CASES) {
  test(`${id}: defect reproduces, documented fix repairs it`, () => {
    const dir = path.join(FIX_ROOT, id);
    const r = runFixture(dir, { sutRun: makeStubFix(file, find, replace) });
    assert.notEqual(r.pre_status, 0, 'verify must FAIL before the fix (defect present)');
    assert.equal(r.post_status, 0, 'verify must PASS after the documented fix');
    assert.equal(r.passed, true);
  });

  test(`${id}: a no-op SUT does NOT pass (defect remains)`, () => {
    const dir = path.join(FIX_ROOT, id);
    const r = runFixture(dir, { sutRun: () => ({ source: 'noop' }) });
    assert.equal(r.passed, false, 'defect must remain when the SUT does nothing');
  });

  test(`${id}: source fixture is never mutated`, () => {
    const dir = path.join(FIX_ROOT, id);
    const src = path.join(dir, 'project', file);
    const before = fs.readFileSync(src, 'utf8');
    runFixture(dir, { sutRun: makeStubFix(file, find, replace) });
    assert.equal(fs.readFileSync(src, 'utf8'), before, 'fixture source must be untouched after a run');
  });
}
