'use strict';

// Tests for the inert-mutation lint (bin/mutation-validity.cjs).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isInert, scan } = require('../bin/mutation-validity.cjs');

test('isInert: bare-append marker with no find/replace is inert', () => {
  assert.strictEqual(isInert({ type: 'file-modify', target_file: 'x.js', append: '// modified by benchmark' }), true);
  assert.strictEqual(isInert({ type: 'file-modify', target_file: 'x.js' }), true, 'modify with nothing to change');
});

test('isInert: a real find/replace or content edit is NOT inert', () => {
  assert.strictEqual(isInert({ type: 'file-modify', find: 'a', replace: 'b' }), false);
  assert.strictEqual(isInert({ type: 'file-modify', append: 'require("./cycle.js")' }), false, 'a real appended require creates a defect');
  assert.strictEqual(isInert({ type: 'file-create', content: 'x' }), false, 'file-create is not a bare-modify');
});

test('scan flags a feasible-but-inert challenge (the miscategorised class)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'));
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify([
    { id: 'GOOD', feasibility: 'feasible', mutation: { type: 'file-modify', target_file: 'a.js', find: 'x', replace: 'y' } },
    { id: 'INERT-FEASIBLE', feasibility: 'feasible', mutation: { type: 'file-modify', target_file: 'b.js', append: '// modified by benchmark' } },
    { id: 'INERT-INFEASIBLE', feasibility: 'infeasible', mutation: { type: 'file-modify', target_file: 'c.js', append: '// modified by benchmark' } },
  ]));
  try {
    const found = scan(dir);
    const ids = found.map(x => x.id);
    assert.ok(ids.includes('INERT-FEASIBLE') && ids.includes('INERT-INFEASIBLE'), 'both inert challenges flagged');
    assert.ok(!ids.includes('GOOD'), 'the real mutation is not flagged');
    const feasibleInert = found.filter(x => x.feasibility === 'feasible');
    assert.strictEqual(feasibleInert.length, 1);
    assert.strictEqual(feasibleInert[0].id, 'INERT-FEASIBLE');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
