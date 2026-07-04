#!/usr/bin/env node
'use strict';
// bin/coverage-audit.cjs — mutation-adequacy / coverage-over-detectors audit
// (quorum-ratified 2026-07-04, step 5 polish). A big corpus isn't a useful one: if 80
// challenges all exercise the same detector the same way, they inflate the denominator
// and dilute the signal. This audits WHERE the corpus has signal vs redundancy:
//
//   - per target layer: how many FILLED (real-mutation, recall-testing) challenges,
//     how many empty/tagged (infeasible/fictional) — a layer's real test weight.
//   - REDUNDANCY: layers over-represented by near-identical mutation shapes (same
//     type + same target_file) — collapse candidates.
//   - GAPS: deterministic detectors with thin or zero filled coverage (now backfilled
//     by the recall harness, but a signal that hand-authored coverage is missing).
//
// Read-only. Usage: node bin/coverage-audit.cjs [--json]

const fs = require('fs');
const path = require('path');

const CONTENT = ['json_path', 'value', 'append', 'content', 'find', 'replace'];
// The FP-safe deterministic detector layers (should have real challenge coverage).
const DETERMINISTIC = ['sast', 'require_graph', 'model_check', 'petri_check', 'fsm_check', 'formal_lint', 'f_to_t', 'c_to_f', 'r_to_f'];

function loadChallenges(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    let data; try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    for (const c of (Array.isArray(data) ? data : (data.challenges || []))) out.push(c);
  }
  return out;
}

function audit(dir) {
  const challenges = loadChallenges(dir);
  const byLayer = {}; // layer -> { filled, empty, feasibilities:{}, shapes:{} }
  for (const c of challenges) {
    const layer = (c.target_layers || ['(none)'])[0];
    const m = c.mutation || {};
    const filled = CONTENT.some(k => m[k] !== undefined);
    const L = byLayer[layer] || (byLayer[layer] = { filled: 0, empty: 0, feas: {}, shapes: {} });
    if (filled) L.filled++; else L.empty++;
    const feas = c.feasibility || 'feasible';
    L.feas[feas] = (L.feas[feas] || 0) + 1;
    if (filled) {
      // A "shape" fingerprint: mutation type + target basename. Many filled challenges
      // sharing a shape in one layer = redundancy.
      const shape = (m.type || '?') + ':' + String(m.target_file || '').split('/').pop();
      L.shapes[shape] = (L.shapes[shape] || 0) + 1;
    }
  }
  // Redundancy: a (layer, shape) group with >= 3 filled challenges.
  const redundancy = [];
  for (const [layer, L] of Object.entries(byLayer)) {
    for (const [shape, n] of Object.entries(L.shapes)) {
      if (n >= 3) redundancy.push({ layer, shape, count: n });
    }
  }
  redundancy.sort((a, b) => b.count - a.count);
  // Gaps: deterministic detectors with < 2 filled challenges.
  const gaps = DETERMINISTIC.filter(d => (byLayer[d] ? byLayer[d].filled : 0) < 2)
    .map(d => ({ detector: d, filled: byLayer[d] ? byLayer[d].filled : 0 }));
  return { total: challenges.length, byLayer, redundancy, gaps };
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'challenges');
  const r = audit(dir);
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exit(0); }
  process.stdout.write('Coverage audit — ' + r.total + ' challenges\n\n');
  process.stdout.write('Per layer (filled = recall-testing / empty = tagged or gap):\n');
  const rows = Object.entries(r.byLayer).sort((a, b) => b[1].filled - a[1].filled);
  for (const [layer, L] of rows) {
    const feas = Object.entries(L.feas).map(([k, v]) => k + ':' + v).join(' ');
    process.stdout.write('  ' + layer.padEnd(16) + ' filled=' + String(L.filled).padStart(3) + '  empty=' + String(L.empty).padStart(3) + '  [' + feas + ']\n');
  }
  process.stdout.write('\nRedundancy (same layer+mutation-shape, >=3 challenges — dedup candidates):\n');
  if (!r.redundancy.length) process.stdout.write('  (none)\n');
  for (const x of r.redundancy) process.stdout.write('  ' + x.layer.padEnd(16) + ' ' + x.count + '× ' + x.shape + '\n');
  process.stdout.write('\nDeterministic detectors with thin filled coverage (<2 — recall-harness backfills these):\n');
  if (!r.gaps.length) process.stdout.write('  (none — all deterministic detectors have >=2 filled challenges)\n');
  for (const g of r.gaps) process.stdout.write('  ' + g.detector.padEnd(16) + ' filled=' + g.filled + '\n');
}

module.exports = { audit: audit };
