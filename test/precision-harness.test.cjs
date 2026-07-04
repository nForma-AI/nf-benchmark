'use strict';

// Tests for the precision harness (bin/precision-harness.cjs): every finding a
// detector produces on clean code is a false positive; a clean run is 0 FP → PASS.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, runDetector } = require('../bin/precision-harness.cjs');

// Build a throwaway "SUT bin" holding one fake detector script whose finding count is
// controlled by a marker file in the scanned root — so we can drive clean vs dirty.
function makeSutBin(scriptName) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sutbin-'));
  fs.writeFileSync(path.join(bin, scriptName), [
    "const fs = require('fs');",
    "const findings = fs.existsSync('DIRTY') ? [{ rule: 'x', message: 'fp here' }] : [];",
    "process.stdout.write(JSON.stringify({ skipped: false, findings }));",
  ].join('\n'));
  return bin;
}

test('runDetector: 0 findings on a clean root, a finding on a dirty root', () => {
  const bin = makeSutBin('sast-sweep.cjs');
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
  const dirty = fs.mkdtempSync(path.join(os.tmpdir(), 'dirty-'));
  fs.writeFileSync(path.join(dirty, 'DIRTY'), '');
  try {
    assert.strictEqual(runDetector(bin, 'sast-sweep.cjs', clean).findings.length, 0);
    assert.strictEqual(runDetector(bin, 'sast-sweep.cjs', dirty).findings.length, 1);
  } finally {
    [bin, clean, dirty].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  }
});

test('run: PASS (precision 1) when clean, FAIL (precision 0) when a detector false-positives', () => {
  const bin = makeSutBin('sast-sweep.cjs');
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
  const dirty = fs.mkdtempSync(path.join(os.tmpdir(), 'dirty-'));
  fs.writeFileSync(path.join(dirty, 'DIRTY'), '');
  try {
    const ok = run({ sutBin: bin, cleanRoots: [clean] });
    assert.strictEqual(ok.total_false_positives, 0);
    assert.strictEqual(ok.precision, 1);

    const bad = run({ sutBin: bin, cleanRoots: [dirty] });
    assert.strictEqual(bad.total_false_positives, 1, 'a finding on clean code is a false positive');
    assert.strictEqual(bad.precision, 0);
    const sast = bad.results.find(r => r.detector === 'sast');
    assert.strictEqual(sast.false_positives, 1);
    assert.ok(sast.fp_details.length === 1, 'the false positive is surfaced for triage');
  } finally {
    [bin, clean, dirty].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  }
});

test('run: a missing detector script is SKIP (toolchain absent), not a false positive', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'emptybin-'));
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
  try {
    const r = run({ sutBin: bin, cleanRoots: [clean] });
    assert.strictEqual(r.total_false_positives, 0);
    assert.ok(r.results.every(x => x.skipped), 'no scripts present → all skipped, never a false FP');
  } finally {
    [bin, clean].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  }
});
