#!/usr/bin/env node
'use strict';
// bin/exactness-report.cjs — the TWO-TRACK exactness report (quorum-ratified
// 2026-07-04, debates/2026-07-04-make-benchmark-useful.md).
//
// The benchmark's headline detection score is RECALL-ONLY, which can't rank detectors
// (a detector that flags everything wins). This report combines the two harnesses into
// a proper confusion matrix for TRACK A (the FP-safe deterministic detectors):
//
//   TP = injected defects caught          (recall harness)
//   FN = injected defects missed          (recall harness)
//   FP = findings on clean code           (precision harness)
//   precision = TP / (TP + FP)            recall = TP / (TP + FN)     F1 = 2PR/(P+R)
//
// Track A must be EXACT (precision = recall = 1.0). TRACK B — the undecidable
// challenges (races/leaks/perf/semantic) — is out of scope for a deterministic
// detector (Rice's theorem) and belongs to the oracle/LLM (quorum) tier, scored by a
// precision/recall CURVE where being wrong sometimes is acceptable. Track B has no
// deterministic runner by construction; this report names it so the two are never
// conflated into one meaningless number.
//
// Usage: node bin/exactness-report.cjs --sut-bin <dir> [--clean-root <path> ...] [--json]
// Exit:  0 if Track A is exact (P=R=1), 1 otherwise.

const path = require('path');
const precision = require('./precision-harness.cjs');
const recall = require('./recall-harness.cjs');

function parseArgs(argv) {
  const o = { sutBin: null, cleanRoots: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sut-bin' && argv[i + 1]) o.sutBin = argv[++i];
    else if (argv[i] === '--clean-root' && argv[i + 1]) o.cleanRoots.push(argv[++i]);
    else if (argv[i] === '--json') o.json = true;
  }
  return o;
}

function compute(opts) {
  const prec = precision.run({ sutBin: opts.sutBin, cleanRoots: opts.cleanRoots });
  const rec = recall.run({ sutBin: opts.sutBin });
  const FP = prec.total_false_positives;
  const TP = rec.caught;
  const FN = rec.missed;
  const applicable = rec.applicable;
  const precisionVal = (TP + FP) > 0 ? TP / (TP + FP) : null;
  const recallVal = (TP + FN) > 0 ? TP / (TP + FN) : null;
  const f1 = (precisionVal !== null && recallVal !== null && (precisionVal + recallVal) > 0)
    ? 2 * precisionVal * recallVal / (precisionVal + recallVal) : null;
  const exact = FP === 0 && FN === 0 && applicable > 0;
  return {
    track_a: { TP, FP, FN, precision: precisionVal, recall: recallVal, f1, exact, applicable },
    track_b: { note: 'oracle/LLM (quorum) tier — undecidable challenges (races/leaks/perf/semantic); scored by precision/recall, not exactness. No deterministic runner by construction.' },
    precision_detail: prec,
    recall_detail: rec,
  };
}

function pct(x) { return x === null ? 'n/a' : (x * 100).toFixed(1) + '%'; }

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.sutBin) { process.stderr.write('exactness-report: --sut-bin <dir> required\n'); process.exit(2); }
  const r = compute(opts);
  if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exit(r.track_a.exact ? 0 : 1); }
  const a = r.track_a;
  process.stdout.write('════════════════════════════════════════════════════\n');
  process.stdout.write(' nf-benchmark ► EXACTNESS REPORT (two-track)\n');
  process.stdout.write('════════════════════════════════════════════════════\n\n');
  process.stdout.write('Track A — FP-safe deterministic detectors (must be EXACT):\n');
  process.stdout.write('  TP=' + a.TP + '  FP=' + a.FP + '  FN=' + a.FN + '\n');
  process.stdout.write('  precision = ' + pct(a.precision) + '   recall = ' + pct(a.recall) + '   F1 = ' + pct(a.f1) + '\n');
  process.stdout.write('  verdict: ' + (a.exact ? 'EXACT ✓ (precision = recall = 100%)' : 'NOT EXACT ✗ — ' + (a.FP ? a.FP + ' false positive(s) ' : '') + (a.FN ? a.FN + ' missed defect(s)' : '')) + '\n\n');
  process.stdout.write('Track B — oracle/LLM (quorum) tier:\n');
  process.stdout.write('  ' + r.track_b.note + '\n');
  process.exit(a.exact ? 0 : 1);
}

module.exports = { compute: compute };
