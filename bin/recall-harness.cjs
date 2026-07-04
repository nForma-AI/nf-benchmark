#!/usr/bin/env node
'use strict';
// bin/recall-harness.cjs — the RECALL track (quorum-ratified 2026-07-04,
// debates/2026-07-04-make-benchmark-useful.md, step 3 scoped to the deterministic
// detectors). The exact mirror of the precision harness.
//
// The precision harness injects NOTHING and requires 0 findings. This harness applies
// structured MUTATION OPERATORS (PIT/mutmut-style) that inject a detector-targeted
// defect into a clean file, then requires the detector to catch it. Recall =
// caught / injected. Together with the precision harness this gives the full
// EXACTNESS metric for Track A (deterministic detectors): 100% recall on injected
// defects + 0% false positives on clean code.
//
// Why operators (not hand-authored challenges): they are DETERMINISTIC and
// LEAKAGE-FREE (no LLM saw them in training) and they SCALE — every operator × every
// clean base file is a fresh ground-truth mutant. This is the mutation-testing
// approach the quorum preferred over git-history mining.
//
// Currently covers the SAST layer (a directory-scanning detector, no git/toolchain
// needed). require_graph / model_check / petri_check / fsm_check recall is exercised
// by the benchmark's own detection_only challenges (BENCH-037/043/176/022/025/…).
//
// Usage: node bin/recall-harness.cjs --sut-bin <dir-with-detectors> [--json]
// Exit:  0 = every operator caught (recall 100%), 1 = at least one missed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// A clean base file the operators mutate. Written to src/ (a SAST scan target).
const CLEAN_BASE = [
  "'use strict';",
  "const db = require('./db');",
  "const cp = require('child_process');",
  "function ok(id) { return db.query('SELECT * FROM t WHERE id = ?', [id]); }",
  "module.exports = { ok };",
].join('\n');

// Structured mutation operators. Each injects ONE detector-targeted defect; a correct
// detector must return >=1 finding of the expected rule. Secret uses the allowlisted
// AWS example key (AKIAIOSFODNN7EXAMPLE) so nothing here trips push protection.
const OPERATORS = [
  { detector: 'sast', name: 'sql-injection', rule: 'sql-injection-string-concat', inject: "\nfunction bad(name) { return db.query('SELECT * FROM t WHERE n=' + name); }\n" },
  { detector: 'sast', name: 'command-injection', rule: 'command-injection', inject: "\nfunction run(x) { return cp.exec('ls ' + x); }\n" },
  { detector: 'sast', name: 'eval-of-input', rule: 'eval-of-input', inject: "\nfunction eval_(x) { return eval(x); }\n" },
  { detector: 'sast', name: 'xss-unescaped', rule: 'xss-unescaped-output', inject: "\nfunction render(res, x) { return res.send('<b>' + x + '</b>'); }\n" },
  { detector: 'sast', name: 'hardcoded-secret', rule: 'hardcoded-secret', inject: "\nconst awsKey = 'AKIAIOSFODNN7EXAMPLE';\n" }, // pragma: allowlist secret
  { detector: 'sast', name: 'hardcoded-absolute-path', rule: 'hardcoded-absolute-path', inject: "\nconst upl = require('path').join('/Users/ci/uploads', 'x');\n" },
];

const DETECTOR_SCRIPT = { sast: 'sast-sweep.cjs' };

function runDetectorJson(sutBin, script, root) {
  const scriptPath = path.join(sutBin, script);
  if (!fs.existsSync(scriptPath)) return { skipped: true, findings: [] };
  const r = spawnSync('node', [scriptPath, '--json'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  const out = r.stdout || '';
  const j = out.indexOf('{');
  if (j === -1) return { skipped: true, findings: [] };
  try {
    const data = JSON.parse(out.slice(j));
    if (data.skipped) return { skipped: true, findings: [] };
    return { skipped: false, findings: Array.isArray(data.findings) ? data.findings : [] };
  } catch (_) { return { skipped: true, findings: [] }; }
}

function run(opts) {
  const sutBin = opts.sutBin;
  const results = [];
  for (const op of OPERATORS) {
    const script = DETECTOR_SCRIPT[op.detector];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-recall-'));
    let caught = false, skipped = false, rules = [];
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'mutant.js'), CLEAN_BASE + op.inject);
      const r = runDetectorJson(sutBin, script, tmp);
      skipped = r.skipped;
      rules = r.findings.map(f => f.rule);
      caught = rules.includes(op.rule);
    } catch (_) { skipped = true; }
    finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
    results.push({ detector: op.detector, operator: op.name, expected_rule: op.rule, caught, skipped, saw: rules });
  }
  const applicable = results.filter(r => !r.skipped);
  const caughtN = applicable.filter(r => r.caught).length;
  const recall = applicable.length ? caughtN / applicable.length : null;
  return { results, applicable: applicable.length, caught: caughtN, missed: applicable.length - caughtN, recall };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = { json: argv.includes('--json'), sutBin: null };
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--sut-bin' && argv[i + 1]) opts.sutBin = argv[++i];
  if (!opts.sutBin) { process.stderr.write('recall-harness: --sut-bin <dir-with-detectors> is required\n'); process.exit(2); }
  const report = run(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write('Recall harness — mutation operators (detector-targeted defects):\n');
    for (const r of report.results) {
      const status = r.skipped ? 'SKIP (toolchain absent)' : (r.caught ? '✓ caught' : '✗ MISSED (saw: ' + (r.saw.join(',') || 'nothing') + ')');
      process.stdout.write('  ' + (r.detector + '/' + r.operator).padEnd(30) + ' ' + status + '\n');
    }
    const pct = report.recall === null ? 'n/a (all skipped)' : (report.recall * 100).toFixed(1) + '%';
    process.stdout.write('\nRecall: ' + (report.missed === 0 && report.applicable > 0 ? 'PASS' : (report.applicable === 0 ? 'SKIP' : 'FAIL'))
      + ' — ' + report.caught + '/' + report.applicable + ' injected defects caught (' + pct + ')\n');
  }
  process.exit(report.applicable > 0 && report.missed > 0 ? 1 : 0);
}

module.exports = { run: run, OPERATORS: OPERATORS };
