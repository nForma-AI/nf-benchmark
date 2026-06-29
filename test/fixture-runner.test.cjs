'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scoreFixture, runFixture, discoverFixtures, loadFixture } = require('../lib/fixture-runner.cjs');

const SORT_FIXTURE = path.join(__dirname, '..', 'fixtures', 'sort-ascending');

// ── pure scoring contract ──
test('scoreFixture: fix_and_verify needs defect-present-then-repaired', () => {
  assert.equal(scoreFixture('fix_and_verify', 1, 0).passed, true);   // failed pre, passed post
  assert.equal(scoreFixture('fix_and_verify', 0, 0).passed, false);  // defect not present pre
  assert.equal(scoreFixture('fix_and_verify', 1, 1).passed, false);  // not repaired
});
test('scoreFixture: no_regression needs post-pass only', () => {
  assert.equal(scoreFixture('no_regression', 0, 0).passed, true);
  assert.equal(scoreFixture('no_regression', 0, 1).passed, false);
});

// A stub SUT that actually repairs the seeded defect in the isolated temp copy.
function stubFixingSut(tempDir) {
  const f = path.join(tempDir, 'sort.cjs');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('a[i] < a[j]', 'a[i] > a[j]'));
  return { source: 'stub-fix' };
}
// A stub SUT that does nothing (models a solver that fails to fix).
function stubNoopSut() { return { source: 'stub-noop' }; }

test('runFixture: defect reproduced (pre fails) then repaired by SUT (post passes)', () => {
  const r = runFixture(SORT_FIXTURE, { sutRun: stubFixingSut });
  assert.notEqual(r.pre_status, 0, 'verify must FAIL before the fix (defect present)');
  assert.equal(r.post_status, 0, 'verify must PASS after the fix');
  assert.equal(r.passed, true);
  assert.equal(r.reason, 'defect reproduced then repaired');
});

test('runFixture: a no-op SUT does NOT pass (defect remains)', () => {
  const r = runFixture(SORT_FIXTURE, { sutRun: stubNoopSut });
  assert.equal(r.passed, false);
  assert.equal(r.reason, 'defect not repaired by SUT');
});

test('runFixture: the SOURCE fixture is never mutated (isolation)', () => {
  const src = path.join(SORT_FIXTURE, 'project', 'sort.cjs');
  const before = fs.readFileSync(src, 'utf8');
  runFixture(SORT_FIXTURE, { sutRun: stubFixingSut });
  assert.equal(fs.readFileSync(src, 'utf8'), before, 'fixture source must be untouched after a run');
  assert.ok(before.includes('a[i] < a[j]'), 'source still carries the seeded defect');
});

test('discoverFixtures: finds the exemplar; loadFixture validates it', () => {
  const dirs = discoverFixtures();
  assert.ok(dirs.some(d => d.endsWith('sort-ascending')), 'sort-ascending fixture discovered');
  const fx = loadFixture(SORT_FIXTURE);
  assert.equal(fx.method, 'fix_and_verify');
  assert.equal(fx.verify, 'node verify.cjs');
});
