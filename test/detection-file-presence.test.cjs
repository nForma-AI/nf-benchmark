'use strict';

// Fast unit tests (no solve) for the file-presence detection signal in
// scoreDetection. Reverse-layer residual COUNTS (c_to_r/t_to_r/d_to_r) often do
// not increment for a single injected orphan (aggregated/truncated lists), yet
// the created file appears in the solver's post analysis. Because a file-create
// target cannot exist in the PRE analysis, "present in post, absent in pre" is a
// sound detection signal — and it must be scoped to create/rename so a modified
// (pre-existing) file can never trigger it spuriously.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { scoreChallenge } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));

const detChallenge = (over = {}) => ({
  id: 'BENCH-TST',
  scoring: { method: 'detection_only', target_layer: 'c_to_r' },
  mutation: { type: 'file-create', target_file: 'bin/bench-overlap.cjs' },
  expected_outcome: { layers_affected: ['c_to_r'] },
  target_layers: ['c_to_r'],
  ...over
});

const rv = (ctorResidual, files) => ({
  total: 170,
  c_to_r: { residual: ctorResidual, detail: { untraced_modules: files.map(f => ({ file: f })) } }
});

test('file-create: count unchanged but file newly in post → detected (file_presence)', () => {
  const pre = rv(297, ['bin/existing.cjs']);
  const post = rv(297, ['bin/existing.cjs', 'bin/bench-overlap.cjs']); // same count, new file present
  const r = scoreChallenge(detChallenge(), pre, post, '', null);
  assert.strictEqual(r.passed, true, r.reason);
  assert.strictEqual(r.details.method, 'file_presence');
});

test('file-create: count increased → detected via count (not presence method)', () => {
  const pre = rv(297, ['bin/existing.cjs']);
  const post = rv(298, ['bin/existing.cjs', 'bin/bench-overlap.cjs']);
  const r = scoreChallenge(detChallenge(), pre, post, '', null);
  assert.strictEqual(r.passed, true, r.reason);
  assert.strictEqual(r.details.method, 'residual_layer_increased');
});

test('file-create: file NOT surfaced in post → not detected (no false pass)', () => {
  const pre = rv(297, ['bin/existing.cjs']);
  const post = rv(297, ['bin/existing.cjs']); // file never appears
  const r = scoreChallenge(detChallenge(), pre, post, '', null);
  assert.strictEqual(r.passed, false, r.reason);
});

test('file-MODIFY: pre-existing file in both pre+post, count flat → NOT a false pass', () => {
  // A modified file exists in pre already, so presence-in-post-not-pre is false.
  const ch = detChallenge({ mutation: { type: 'file-modify', target_file: 'src/backup.js' } });
  const pre = rv(297, ['src/backup.js']);
  const post = rv(297, ['src/backup.js']);
  const r = scoreChallenge(ch, pre, post, '', null);
  assert.strictEqual(r.passed, false, 'file-modify must not pass via the create-only presence signal');
});

test('regression: existing count-based detection still passes unchanged', () => {
  // No mutation target file edge case — pure count increase on target layer.
  const ch = detChallenge({ mutation: { type: 'json-field-modify', target_file: '.planning/formal/requirements.json' } });
  const pre = rv(10, []);
  const post = rv(12, []);
  const r = scoreChallenge(ch, pre, post, '', null);
  assert.strictEqual(r.passed, true, r.reason);
  assert.strictEqual(r.details.method, 'residual_layer_increased');
});
