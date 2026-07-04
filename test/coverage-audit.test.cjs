'use strict';

// Tests for the coverage audit (bin/coverage-audit.cjs): it must count filled vs empty
// per layer, surface redundancy (same layer + mutation shape, >=3), and flag
// deterministic detectors with thin filled coverage.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../bin/coverage-audit.cjs');

function tmpCorpus(challenges) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-'));
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify(challenges));
  return dir;
}

test('counts filled vs empty per layer and records feasibility', () => {
  const dir = tmpCorpus([
    { id: 'A', target_layers: ['sast'], mutation: { type: 'file-modify', target_file: 'src/x.js', find: 'a', replace: 'b' } },
    { id: 'B', target_layers: ['sast'], mutation: { type: 'file-modify', target_file: 'src/y.js', description: 'empty' }, feasibility: 'fictional' },
  ]);
  try {
    const r = audit(dir);
    assert.strictEqual(r.byLayer.sast.filled, 1);
    assert.strictEqual(r.byLayer.sast.empty, 1);
    assert.strictEqual(r.byLayer.sast.feas.fictional, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flags redundancy: same layer + same mutation shape, >=3 filled', () => {
  const mk = (id) => ({ id, target_layers: ['r_to_f'], mutation: { type: 'json-entry-add', target_file: 'x/requirements.json', value: {} } });
  const dir = tmpCorpus([mk('A'), mk('B'), mk('C')]);
  try {
    const r = audit(dir);
    const red = r.redundancy.find(x => x.layer === 'r_to_f');
    assert.ok(red, 'redundant shape surfaced');
    assert.strictEqual(red.count, 3);
    assert.match(red.shape, /json-entry-add:requirements\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('two different shapes in a layer are NOT redundancy', () => {
  const dir = tmpCorpus([
    { id: 'A', target_layers: ['sast'], mutation: { type: 'file-create', target_file: 'a.js', content: 'x' } },
    { id: 'B', target_layers: ['sast'], mutation: { type: 'file-modify', target_file: 'b.js', find: 'x', replace: 'y' } },
  ]);
  try {
    assert.strictEqual(audit(dir).redundancy.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flags a deterministic detector with < 2 filled challenges as a gap', () => {
  const dir = tmpCorpus([
    { id: 'A', target_layers: ['sast'], mutation: { type: 'file-create', target_file: 'a.js', content: 'x' } },
  ]);
  try {
    const r = audit(dir);
    assert.ok(r.gaps.some(g => g.detector === 'require_graph' && g.filled === 0), 'uncovered detector flagged');
    assert.ok(r.gaps.some(g => g.detector === 'sast' && g.filled === 1), 'thin (1) coverage flagged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
