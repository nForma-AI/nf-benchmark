'use strict';

// Tests for the capability map (bin/capability-map.cjs): classify tagged challenges by
// the missing capability, rank by unlock-count, gate "actionable" at >=5.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, classify } = require('../bin/capability-map.cjs');

test('classify maps defect types to the right capability', () => {
  assert.strictEqual(classify('Rate-limit semaphore deadlock'), 'concurrency-modeling');
  assert.strictEqual(classify('Memory leak in long-running process'), 'resource-lifecycle-modeling');
  assert.strictEqual(classify('Inefficient algorithm with O(n2) complexity'), 'complexity-analysis');
  assert.strictEqual(classify('Off-by-one in quorum fan-out'), 'llm-code-review');
  assert.strictEqual(classify('Cross-formal inconsistency (TLA+ vs Alloy)'), 'cross-formalism-check');
  assert.strictEqual(classify('Formal invariant that is too weak'), 'property-strengthening');
});

function tmpCorpus(challenges) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcorpus-'));
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify(challenges));
  return dir;
}

test('only tagged (infeasible/fictional) challenges are mapped; feasible ones are ignored', () => {
  const dir = tmpCorpus([
    { id: 'A', feasibility: 'infeasible', title: 'race condition' },
    { id: 'B', title: 'a normal passing challenge' }, // untagged → ignored
  ]);
  try {
    const rows = build(dir, false);
    const all = rows.flatMap(r => r.challenges);
    assert.ok(all.includes('A'));
    assert.ok(!all.includes('B'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('actionable gate: >=5 unlocks flips to actionable, ranked by unlock-count', () => {
  const races = Array.from({ length: 5 }, (_, i) => ({ id: 'R' + i, feasibility: 'infeasible', title: 'deadlock ' + i }));
  const one = [{ id: 'W', feasibility: 'infeasible', title: 'invariant too weak' }];
  const dir = tmpCorpus([...races, ...one]);
  try {
    const rows = build(dir, false);
    const conc = rows.find(r => r.capability === 'concurrency-modeling');
    const weak = rows.find(r => r.capability === 'property-strengthening');
    assert.strictEqual(conc.unlocks, 5);
    assert.strictEqual(conc.actionable, true);
    assert.strictEqual(weak.actionable, false, '1 unlock → hypothesis, not actionable');
    assert.ok(rows[0].unlocks >= rows[rows.length - 1].unlocks, 'sorted by unlock-count desc');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--write-tags stamps requires_capability onto the challenge', () => {
  const dir = tmpCorpus([{ id: 'A', feasibility: 'infeasible', title: 'semaphore deadlock' }]);
  try {
    build(dir, true);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'c.json'), 'utf8'));
    assert.strictEqual(data[0].requires_capability, 'concurrency-modeling');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
