'use strict';

// Tests for the dual-score reporting (quorum-ratified 2026-07-04): computeReport must
// report BOTH the raw pass rate (passed/total) AND the capability score
// (passed/feasible), excluding challenges tagged feasibility=infeasible|fictional.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { computeReport, formatReport } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));

function res(id, passed, feasibility) {
  const challenge = { id, category: 'x', difficulty: 'easy', target_layers: ['l'] };
  if (feasibility) challenge.feasibility = feasibility;
  return { challenge, score: { passed } };
}

test('capability score excludes infeasible + fictional from the denominator', () => {
  const r = computeReport([
    res('A', true),                  // feasible, pass
    res('B', false),                 // feasible, fail
    res('C', false, 'infeasible'),   // excluded
    res('D', false, 'fictional'),    // excluded
  ]);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.passed, 1);
  assert.strictEqual(r.passRate, '25.0');            // raw coverage
  assert.strictEqual(r.feasibleTotal, 2);
  assert.strictEqual(r.feasiblePassed, 1);
  assert.strictEqual(r.capabilityRate, '50.0');      // capability (the actionable metric)
  assert.strictEqual(r.infeasible, 1);
  assert.strictEqual(r.fictional, 1);
});

test('untagged challenges count as feasible (capability == coverage when nothing excluded)', () => {
  const r = computeReport([res('A', true), res('B', false)]);
  assert.strictEqual(r.feasibleTotal, 2);
  assert.strictEqual(r.capabilityRate, r.passRate);
});

test('formatReport shows the Capability line only when something is excluded (both numbers visible = not gaming)', () => {
  const withExcluded = formatReport(computeReport([res('A', true), res('C', false, 'infeasible')]));
  assert.match(withExcluded, /Rate: 50\.0%/);        // raw still shown
  assert.match(withExcluded, /Capability: 1\/1 feasible \(100\.0%\)/);
  assert.match(withExcluded, /excluded: 1 infeasible, 0 fictional/);

  const noneExcluded = formatReport(computeReport([res('A', true), res('B', false)]));
  assert.ok(!/Capability:/.test(noneExcluded), 'no Capability line when total == feasible (avoids noise)');
});
