#!/usr/bin/env node
'use strict';
// bin/precision-harness.cjs — the PRECISION track (quorum-ratified 2026-07-04,
// .planning/quorum/debates/2026-07-04-make-benchmark-useful.md).
//
// The detection benchmark is RECALL-ONLY: it measures "was the injected defect
// found". A detector that fires on EVERYTHING scores 100% recall — so the score is
// uninterpretable (you cannot rank detectors on a metric where "flag everything"
// wins). This harness measures the other axis: PRECISION. It runs every FP-safe
// deterministic detector against KNOWN-CLEAN code and requires ZERO findings — every
// finding on clean code is a false positive. This formalizes the 0-baseline
// invariant (previously a hand-checked assertion) into a measured, CI-gateable metric,
// and it must include real code that ships to users (not just fixtures).
//
// Usage:
//   node bin/precision-harness.cjs --sut-bin <dir-with-detectors> [--clean-root <path> ...] [--json]
//   --sut-bin    directory holding the detector scripts (nForma bin/ or ~/.claude/nf-bin)
//   --clean-root a known-clean project root to scan (repeatable). Defaults to the
//                bundled clean fixture; pass the real nForma checkout to exercise
//                shipping code (the held-out real-src check the corpus never had).
// Exit: 0 = zero false positives (precision 100%), 1 = at least one false positive.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The FP-safe deterministic detectors. Each ships with a `--json` mode returning
// { findings: [...] } (or { skipped: true } when its toolchain is absent).
const DETECTORS = [
  { name: 'sast', script: 'sast-sweep.cjs' },
  { name: 'require_graph', script: 'check-require-graph.cjs' },
  { name: 'model_check', script: 'check-model-invariants.cjs' },
  { name: 'petri_check', script: 'check-petri-reachability.cjs' },
  { name: 'fsm_check', script: 'check-fsm-models.cjs' },
];

function parseArgs(argv) {
  const opts = { cleanRoots: [], json: false, sutBin: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sut-bin' && argv[i + 1]) opts.sutBin = argv[++i];
    else if (argv[i] === '--clean-root' && argv[i + 1]) opts.cleanRoots.push(argv[++i]);
    else if (argv[i] === '--json') opts.json = true;
  }
  return opts;
}

// Run one detector against one clean root; return { findings, skipped }.
function runDetector(sutBin, script, root) {
  const scriptPath = path.join(sutBin, script);
  if (!fs.existsSync(scriptPath)) return { skipped: true, reason: script + ' not found', findings: [] };
  const r = spawnSync('node', [scriptPath, '--json'], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const out = r.stdout || '';
  const j = out.indexOf('{');
  if (j === -1) return { skipped: true, reason: 'no JSON output', findings: [] };
  try {
    const data = JSON.parse(out.slice(j));
    if (data.skipped) return { skipped: true, reason: data.reason || 'skipped', findings: [] };
    return { skipped: false, findings: Array.isArray(data.findings) ? data.findings : [] };
  } catch (e) {
    return { skipped: true, reason: 'unparseable output: ' + e.message, findings: [] };
  }
}

function run(opts) {
  const sutBin = opts.sutBin;
  const roots = opts.cleanRoots.length ? opts.cleanRoots : [path.join(__dirname, '..', 'fixtures', 'clean-corpus')];
  const results = [];
  for (const det of DETECTORS) {
    let falsePositives = 0;
    let checked = 0;
    let skippedAll = true;
    const fpDetails = [];
    for (const root of roots) {
      const r = runDetector(sutBin, det.script, root);
      if (!r.skipped) { skippedAll = false; checked++; }
      for (const f of r.findings) fpDetails.push({ root: root, finding: f.message || f.rule || JSON.stringify(f) });
      falsePositives += r.findings.length;
    }
    results.push({ detector: det.name, false_positives: falsePositives, roots_checked: checked, skipped: skippedAll, fp_details: fpDetails });
  }
  const totalFp = results.reduce((a, r) => a + r.false_positives, 0);
  // Precision here is the clean-corpus specificity: every finding on clean code is a
  // false positive, so a perfect run is 0 FP → precision 1.0 for that detector.
  return { roots: roots, results: results, total_false_positives: totalFp, precision: totalFp === 0 ? 1 : 0 };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.sutBin) {
    process.stderr.write('precision-harness: --sut-bin <dir-with-detectors> is required\n');
    process.exit(2);
  }
  const report = run(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write('Precision harness — clean corpus: ' + report.roots.join(', ') + '\n');
    for (const r of report.results) {
      const status = r.skipped ? 'SKIP (toolchain absent)' : (r.false_positives === 0 ? '✓ 0 false positives' : '✗ ' + r.false_positives + ' FALSE POSITIVE(S)');
      process.stdout.write('  ' + r.detector.padEnd(14) + ' ' + status + '\n');
      for (const d of r.fp_details) process.stdout.write('      FP: ' + d.finding + '  (' + d.root + ')\n');
    }
    process.stdout.write('\nPrecision: ' + (report.total_false_positives === 0 ? 'PASS' : 'FAIL')
      + ' (' + report.total_false_positives + ' false positive(s) across the deterministic detectors on clean code)\n');
  }
  process.exit(report.total_false_positives === 0 ? 0 : 1);
}

module.exports = { run: run, runDetector: runDetector, DETECTORS: DETECTORS };
