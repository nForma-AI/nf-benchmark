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

test('every mutant is BEHAVIORALLY real — defective differs from clean on some input', () => {
  // An input per mutant that exercises the injected defect. If clean and defective
  // agree on this input (or both throw), the "bug" is cosmetic and the ground truth is
  // invalid — this guards the corpus against that.
  const inputs = {
    'off-by-one-boundary': [[1, 2, 3]], 'negated-condition': [{ id: 1 }, { owner: 1 }], 'wrong-return': [''],
    'swapped-comparison': [2, 5], 'dropped-guard': [6, 0], 'wrong-operator': [10, 3],
    'reversed-comparator': [[3, 1, 2]], 'wrong-accumulator-seed': [[1, 2, 3]], 'early-return-in-loop': [[1, 2, -1]],
    'and-or-confusion': [{ name: 'a', email: '' }], 'inclusive-exclusive-slice': [[1, 2, 3], 3], 'assignment-in-condition': [{ role: 'user' }],
    'nullish-vs-or': [{ size: 0 }], 'negative-modulo': [-1, 3], 'float-rounding-order': [1.5],
    'input-mutation': [{ id: 1 }], 'string-coercion': ['5'], 'boundary-inclusive': [5, 5, 10],
  };
  const compile = (code) => eval('(' + code.replace(/^function \w+/, 'function') + ')');
  // Run on a fresh deep copy; capture BOTH the return value and the args AFTER the call
  // so a hidden side effect (input mutation with an equal return) still registers.
  const exec = (code, name) => {
    const args = inputs[name].map(a => JSON.parse(JSON.stringify(a)));
    let r, e = false; try { r = compile(code)(...args); } catch (_) { e = true; }
    return JSON.stringify({ r, args, e });
  };
  for (const m of SEMANTIC_MUTANTS) {
    assert.ok(inputs[m.name], 'test input defined for ' + m.name);
    assert.notStrictEqual(exec(m.clean, m.name), exec(m.defective, m.name),
      m.name + ': defective must behave differently from clean (real bug), incl. side effects');
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
