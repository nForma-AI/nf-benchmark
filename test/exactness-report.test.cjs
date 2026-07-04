'use strict';

// Tests for the two-track exactness report (bin/exactness-report.cjs): it combines the
// recall harness (TP/FN on injected mutants) with the precision harness (FP on clean
// code) into a confusion matrix and reports Track A precision/recall/F1.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compute } = require('../bin/exactness-report.cjs');

// Stub `sast-sweep.cjs` that re-derives sast findings from whatever src/*.js it scans.
function makeStubBin() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbin-'));
  const stub = [
    "const fs=require('fs'),path=require('path');",
    "let c='';",
    "try { const dir=path.join(process.cwd(),'src'); for(const f of fs.readdirSync(dir)) c+=fs.readFileSync(path.join(dir,f),'utf8')+'\\n'; } catch(_){}",
    "const f=[];",
    "if(/db\\.query\\([^,]*\\+/.test(c)) f.push({rule:'sql-injection-string-concat'});",
    "if(/cp\\.exec\\(.*\\+/.test(c)) f.push({rule:'command-injection'});",
    "if(/eval\\(/.test(c)) f.push({rule:'eval-of-input'});",
    "if(/res\\.send\\(.*\\+/.test(c)) f.push({rule:'xss-unescaped-output'});",
    "if(/AKIA/.test(c)) f.push({rule:'hardcoded-secret'});",
    "if(/\\/Users\\//.test(c)) f.push({rule:'hardcoded-absolute-path'});",
    "process.stdout.write(JSON.stringify({skipped:false,findings:f}));",
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'sast-sweep.cjs'), stub);
  return bin;
}

function cleanRoot(content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'ok.js'), content || "const x = 1;\nmodule.exports = { x };");
  return root;
}

test('clean corpus + all operators caught → EXACT (P=R=F1=100%)', () => {
  const bin = makeStubBin();
  const clean = cleanRoot();
  try {
    const r = compute({ sutBin: bin, cleanRoots: [clean] });
    assert.strictEqual(r.track_a.TP, 6);
    assert.strictEqual(r.track_a.FP, 0);
    assert.strictEqual(r.track_a.FN, 0);
    assert.strictEqual(r.track_a.precision, 1);
    assert.strictEqual(r.track_a.recall, 1);
    assert.strictEqual(r.track_a.f1, 1);
    assert.strictEqual(r.track_a.exact, true);
  } finally { [bin, clean].forEach(d => fs.rmSync(d, { recursive: true, force: true })); }
});

test('a false positive on clean code lowers precision below 1 and breaks EXACT', () => {
  const bin = makeStubBin();
  // The "clean" file contains a /Users/ path → the stub flags it → a false positive.
  const dirty = cleanRoot("const p = require('path').join('/Users/ci', 'x');\nmodule.exports = { p };");
  try {
    const r = compute({ sutBin: bin, cleanRoots: [dirty] });
    assert.strictEqual(r.track_a.FP, 1);
    assert.ok(r.track_a.precision < 1, 'precision drops with a false positive');
    assert.strictEqual(r.track_a.recall, 1, 'recall still perfect');
    assert.strictEqual(r.track_a.exact, false);
  } finally { [bin, dirty].forEach(d => fs.rmSync(d, { recursive: true, force: true })); }
});

test('Track B is named as the oracle tier (never conflated with Track A)', () => {
  const bin = makeStubBin();
  const clean = cleanRoot();
  try {
    const r = compute({ sutBin: bin, cleanRoots: [clean] });
    assert.match(r.track_b.note, /oracle\/LLM|quorum/);
  } finally { [bin, clean].forEach(d => fs.rmSync(d, { recursive: true, force: true })); }
});
