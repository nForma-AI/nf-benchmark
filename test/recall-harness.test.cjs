'use strict';

// Tests for the recall harness (bin/recall-harness.cjs). Uses a stub detector so the
// plumbing (write mutant → run detector → check the expected rule appears) is verified
// deterministically without needing semgrep installed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, OPERATORS } = require('../bin/recall-harness.cjs');

// A stub `sast-sweep.cjs` that re-derives findings from the mutant it is pointed at.
// `missRule` (optional) is a rule the stub deliberately fails to report → simulates a
// detector that misses that operator.
function makeStubBin(missRule) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbin-'));
  const stub = [
    "const fs=require('fs'),path=require('path');",
    "let c=''; try { c=fs.readFileSync(path.join(process.cwd(),'src','mutant.js'),'utf8'); } catch(_){}",
    "const miss=" + JSON.stringify(missRule || '') + ";",
    "const f=[];",
    "if(/db\\.query\\([^,]*\\+/.test(c)) f.push({rule:'sql-injection-string-concat'});",
    "if(/cp\\.exec\\(.*\\+/.test(c)) f.push({rule:'command-injection'});",
    "if(/eval\\(/.test(c)) f.push({rule:'eval-of-input'});",
    "if(/res\\.send\\(.*\\+/.test(c)) f.push({rule:'xss-unescaped-output'});",
    "if(/AKIA/.test(c)) f.push({rule:'hardcoded-secret'});",
    "if(/\\/Users\\//.test(c)) f.push({rule:'hardcoded-absolute-path'});",
    "process.stdout.write(JSON.stringify({skipped:false,findings:f.filter(x=>x.rule!==miss)}));",
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'sast-sweep.cjs'), stub);
  return bin;
}

test('every operator is caught by a correct detector → recall 100%, PASS', () => {
  const bin = makeStubBin();
  try {
    const r = run({ sutBin: bin });
    assert.strictEqual(r.applicable, OPERATORS.length);
    assert.strictEqual(r.missed, 0);
    assert.strictEqual(r.recall, 1);
    assert.ok(r.results.every(x => x.caught), 'all operators caught');
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
});

test('a detector that misses one operator → recall < 1, that operator flagged MISSED', () => {
  const bin = makeStubBin('eval-of-input');
  try {
    const r = run({ sutBin: bin });
    assert.strictEqual(r.missed, 1);
    assert.ok(r.recall < 1);
    const missed = r.results.find(x => !x.caught);
    assert.strictEqual(missed.operator, 'eval-of-input', 'the missed operator is surfaced by name');
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
});

test('a missing detector script → all skipped (recall n/a), never a false MISSED', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'emptybin-'));
  try {
    const r = run({ sutBin: bin });
    assert.strictEqual(r.applicable, 0);
    assert.strictEqual(r.recall, null);
    assert.ok(r.results.every(x => x.skipped));
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
});
