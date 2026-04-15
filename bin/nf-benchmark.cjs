#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const libDir = path.join(__dirname, '..', 'lib');
const { loadAllChallenges, loadChallenge, loadByCategory, loadByDifficulty, validateAll, printSummary } = require(path.join(libDir, 'challenges.cjs'));
const { applyMutation } = require(path.join(libDir, 'mutator.cjs'));
const { scoreChallenge, computeReport, formatReport } = require(path.join(libDir, 'scorer.cjs'));
const { createSnapshot, restoreSnapshot, runSolve, saveResult } = require(path.join(libDir, 'runner.cjs'));

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const BASELINE_PATH = path.join(__dirname, '..', 'baseline.json');

const args = process.argv.slice(2);
const command = args[0] || 'help';

function getProjectRoot() {
  if (args.includes('--project-root')) {
    const idx = args.indexOf('--project-root');
    return args[idx + 1];
  }
  const env = process.env.QGSD_ROOT || process.env.NFORMA_ROOT;
  if (env) return env;
  console.error('Error: No project root specified. Use --project-root <path> or set QGSD_ROOT env var.');
  process.exit(1);
}

function getFilterOptions() {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--single' && args[i + 1]) opts.single = args[++i];
    if (args[i] === '--category' && args[i + 1]) opts.category = args[++i];
    if (args[i] === '--difficulty' && args[i + 1]) opts.difficulty = args[++i];
    if (args[i] === '--tags' && args[i + 1]) opts.tags = args[++i].split(',');
    if (args[i] === '--project-root' && args[i + 1]) opts.projectRoot = args[++i];
    if (args[i] === '--timeout' && args[i + 1]) opts.timeout = parseInt(args[++i], 10);
    if (args[i] === '--dry-run') opts.dryRun = true;
    if (args[i] === '--parallel' && args[i + 1]) opts.parallel = parseInt(args[++i], 10);
    if (args[i] === '--save-baseline') opts.saveBaseline = true;
    if (args[i] === '--compare-baseline') opts.compareBaseline = true;
    if (args[i] === '--baseline-tolerance' && args[i + 1]) opts.baselineTolerance = parseFloat(args[++i]);
  }
  return opts;
}

async function runBenchmark() {
  const opts = getFilterOptions();
  const projectRoot = opts.projectRoot || getProjectRoot();
  // Default regression tolerance: pass rate may not drop more than 5 percentage points
  const baselineTolerance = opts.baselineTolerance !== undefined ? opts.baselineTolerance : 5.0;

  if (!fs.existsSync(path.join(projectRoot, 'bin', 'nf-solve.cjs'))) {
    console.error(`Error: ${projectRoot} does not appear to be a valid nForma project`);
    process.exit(1);
  }

  let challenges = loadAllChallenges().filter(c => !c.disabled);

  if (opts.single) {
    challenges = challenges.filter(c => c.id === opts.single);
    if (challenges.length === 0) {
      console.error(`Challenge ${opts.single} not found`);
      process.exit(1);
    }
  }
  if (opts.category) {
    challenges = challenges.filter(c => c.category === opts.category);
  }
  if (opts.difficulty) {
    challenges = challenges.filter(c => c.difficulty === opts.difficulty);
  }
  if (opts.tags) {
    challenges = challenges.filter(c =>
      opts.tags.some(t => (c.tags || []).includes(t))
    );
  }

  console.log(`\nRunning ${challenges.length} challenges against ${projectRoot}\n`);

  if (opts.dryRun) {
    for (const c of challenges) {
      console.log(`  [DRY] ${c.id} ${c.title} (${c.difficulty})`);
    }
    return;
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < challenges.length; i++) {
    const challenge = challenges[i];
    const progress = `[${i + 1}/${challenges.length}]`;
    process.stdout.write(`${progress} ${challenge.id} ${challenge.title}... `);

    const snapshot = createSnapshot(projectRoot);
    const challengeStart = Date.now();

    try {
      const preSolve = runSolve(projectRoot, { timeout: opts.timeout || 300 });
      const preResidual = preSolve.residual_vector;

      applyMutation(challenge, projectRoot);

      const postSolve = runSolve(projectRoot, { timeout: opts.timeout || 300 });
      const postResidual = postSolve.residual_vector;

      const score = scoreChallenge(
        challenge,
        preResidual,
        postResidual,
        postSolve.raw_output,
        postSolve.error
      );

      const executionTimeMs = Date.now() - challengeStart;

      const result = {
        challenge,
        pre_residual: preResidual,
        post_residual: postResidual,
        score,
        execution_time_ms: executionTimeMs,
        timestamp: new Date().toISOString()
      };

      results.push(result);
      saveResult(challenge.id, result);

      const timeStr = executionTimeMs >= 1000
        ? `${(executionTimeMs / 1000).toFixed(1)}s`
        : `${executionTimeMs}ms`;

      if (score.passed) {
        passed++;
        console.log(`PASS (${score.reason}) [${timeStr}]`);
      } else {
        failed++;
        console.log(`FAIL (${score.reason}) [${timeStr}]`);
      }
    } catch (e) {
      const executionTimeMs = Date.now() - challengeStart;
      failed++;
      const result = {
        challenge,
        pre_residual: null,
        post_residual: null,
        score: { passed: false, score: 0, reduction_score: 0, reason: `Benchmark error: ${e.message}` },
        execution_time_ms: executionTimeMs,
        timestamp: new Date().toISOString()
      };
      results.push(result);
      saveResult(challenge.id, result);
      console.log(`ERROR (${e.message})`);
    } finally {
      restoreSnapshot(snapshot, projectRoot);
    }
  }

  const report = computeReport(results);
  console.log('\n' + formatReport(report));

  const reportPath = path.join(RESULTS_DIR, `report-${Date.now().toString(36)}.json`);
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ report, results: results.map(r => ({
    id: r.challenge.id,
    title: r.challenge.title,
    category: r.challenge.category,
    difficulty: r.challenge.difficulty,
    passed: r.score.passed,
    reason: r.score.reason,
    reduction_score: r.score.reduction_score,
    execution_time_ms: r.execution_time_ms
  })) }, null, 2) + '\n');
  console.log(`\nFull report saved to ${reportPath}`);

  // Baseline operations
  if (opts.saveBaseline) {
    const baseline = {
      saved_at: new Date().toISOString(),
      total: report.total,
      passed: report.passed,
      pass_rate: parseFloat(report.passRate),
      avg_reduction_score: report.avgReductionScore,
      by_category: report.byCategory,
      by_difficulty: report.byDifficulty
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nBaseline saved to ${BASELINE_PATH}`);
  }

  if (opts.compareBaseline) {
    if (!fs.existsSync(BASELINE_PATH)) {
      console.warn('\nWARN: --compare-baseline requested but no baseline.json found. Skipping comparison.');
    } else {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
      const currentRate = parseFloat(report.passRate);
      const baselineRate = baseline.pass_rate;
      const delta = currentRate - baselineRate;

      console.log(`\nBaseline comparison:`);
      console.log(`  Baseline pass rate : ${baselineRate.toFixed(1)}%  (saved ${baseline.saved_at})`);
      console.log(`  Current pass rate  : ${currentRate.toFixed(1)}%`);
      console.log(`  Delta              : ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`);

      if (delta < -baselineTolerance) {
        console.error(`\nREGRESSION: Pass rate dropped ${Math.abs(delta).toFixed(1)}pp (tolerance: ${baselineTolerance}pp)`);
        process.exit(1);
      } else if (delta < 0) {
        console.warn(`\nWARN: Pass rate dropped ${Math.abs(delta).toFixed(1)}pp (within ${baselineTolerance}pp tolerance)`);
      } else {
        console.log(`\nOK: No regression detected.`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

function listChallenges() {
  const challenges = loadAllChallenges();
  console.log(`\n${challenges.length} challenges available:\n`);
  console.log('  ID          Title                                           Difficulty  Category');
  console.log('  ----------  ----------------------------------------------  ----------  --------------------');
  for (const c of challenges) {
    const title = c.title.length > 45 ? c.title.slice(0, 42) + '...' : c.title.padEnd(45);
    console.log(`  ${c.id}  ${title}  ${c.difficulty.padEnd(10)}  ${c.category}`);
  }
  console.log('');
}

function validate() {
  const results = validateAll();
  const valid = results.filter(r => r.valid).length;
  const invalid = results.filter(r => !r.valid).length;
  console.log(`\nValidation: ${valid} valid, ${invalid} invalid out of ${results.length} challenges\n`);
  for (const r of results.filter(r => !r.valid)) {
    console.log(`  ${r.id}: ${r.errors.join(', ')}`);
  }
  if (invalid > 0) process.exit(1);
}

function showHelp() {
  console.log(`
nf-benchmark — Benchmark suite for nf:solve autonomous fixing capability

Usage:
  nf-benchmark <command> [options]

Commands:
  run              Run benchmark challenges (default)
  list             List all available challenges
  validate         Validate challenge definitions
  summary          Print challenge summary stats
  help             Show this help

Options:
  --project-root <path>       Path to nForma project (or set QGSD_ROOT env)
  --single <BENCH-NNN>        Run a single challenge by ID
  --category <name>           Filter by category
  --difficulty <level>        Filter by difficulty (easy|medium|hard|expert)
  --tags <tag1,tag2>          Filter by tags
  --timeout <seconds>         Per-challenge timeout (default: 300)
  --dry-run                   Show what would run without executing
  --parallel <N>              Run N challenges in parallel (not yet implemented)
  --save-baseline             Save current results as baseline.json
  --compare-baseline          Fail if pass rate drops >5pp vs baseline.json
  --baseline-tolerance <pp>   Pass rate drop tolerance in percentage points (default: 5)

Examples:
  nf-benchmark run --project-root ~/code/QGSD
  nf-benchmark run --single BENCH-001 --project-root ~/code/QGSD
  nf-benchmark run --category formal-models --project-root ~/code/QGSD
  nf-benchmark run --project-root ~/code/QGSD --save-baseline
  nf-benchmark run --project-root ~/code/QGSD --compare-baseline
  nf-benchmark list
  nf-benchmark validate
`);
}

switch (command) {
  case 'run':
    runBenchmark();
    break;
  case 'list':
    listChallenges();
    break;
  case 'validate':
    validate();
    break;
  case 'summary':
    printSummary();
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
