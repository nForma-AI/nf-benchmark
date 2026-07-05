'use strict';

// Tests for the Track B oracle scorer (bin/oracle-track.cjs). Uses controlled reviewer
// functions so the precision/recall math is verified without a live quorum.

const { test } = require('node:test');
const assert = require('node:assert');
const { run, SEMANTIC_MUTANTS, conservativeReviewer } = require('../bin/oracle-track.cjs');

// Ground-truth-aware reviewers, keyed off the meta.variant the scorer passes in.
const perfect = (_code, meta) => ({ hasDefect: meta.variant === 'defective' });
const flagEverything = () => ({ hasDefect: true });

test('every mutant is a real (clean, defective) pair with a named defect', () => {
  assert.ok(SEMANTIC_MUTANTS.length >= 5);
  for (const m of SEMANTIC_MUTANTS) {
    assert.ok(m.clean && m.defective && m.clean !== m.defective, m.name + ' has distinct clean/defective');
    assert.ok(m.defect && m.defect.length > 0, m.name + ' names its defect');
  }
});

test('a perfect reviewer scores precision=recall=F1=100%', () => {
  const r = run(perfect);
  assert.strictEqual(r.FP, 0);
  assert.strictEqual(r.FN, 0);
  assert.strictEqual(r.precision, 1);
  assert.strictEqual(r.recall, 1);
  assert.strictEqual(r.f1, 1);
  assert.ok(r.results.every(x => x.caught && !x.false_alarm));
});

test('a flag-everything reviewer has recall 1 but precision 0.5 (Track B tolerates error)', () => {
  const r = run(flagEverything);
  assert.strictEqual(r.recall, 1, 'catches every defect');
  assert.strictEqual(r.FP, r.total, 'but false-alarms on every clean variant');
  assert.strictEqual(r.precision, 0.5, 'precision = TP/(TP+FP) = N/2N');
});

test('the conservative stub reviewer has recall 0 (nothing flagged) — no false positives', () => {
  const r = run(conservativeReviewer);
  assert.strictEqual(r.TP, 0);
  assert.strictEqual(r.FP, 0);
  assert.strictEqual(r.recall, 0);
  assert.strictEqual(r.precision, null, 'precision undefined with no positive calls');
});
