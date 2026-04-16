#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { workerData, parentPort, isMainThread, Worker } = require('worker_threads');

// ── Worker thread entry point ──────────────────────────────────────────────
if (!isMainThread) {
  // Running as a worker: receive challenges + projectRoot, run serially, post results
  const { challenges, projectRoot, timeout } = workerData;

  const libDir = path.join(__dirname, '..', 'lib');
  const { applyMutation } = require(path.join(libDir, 'mutator.cjs'));
  const { scoreChallenge, LAYER_ALIASES } = require(path.join(libDir, 'scorer.cjs'));
  const { createSnapshot, restoreSnapshot, runSolve, runSolveFull, saveResult } = require(path.join(libDir, 'runner.cjs'));

  function workerFocusLayer(challenge) {
    const layer = challenge.scoring && challenge.scoring.target_layer;
    if (!layer) return null;
    return LAYER_ALIASES[layer] || layer;
  }

  (async () => {
    for (const challenge of challenges) {
      const challengeStart = Date.now();
      const snapshot = createSnapshot(projectRoot);
      const focus = workerFocusLayer(challenge);
      const solveOpts = { timeout, focus };
      let result;

      try {
        let preResidual, seededResidual, fixResidual, postSolveOutput, postSolveError;

        if (challenge.scoring.method === 'no_regression') {
          // No mutation applied — just run twice
          const preSolve = runSolve(projectRoot, solveOpts);
          preResidual = preSolve.residual_vector;
          const postSolve = runSolve(projectRoot, solveOpts);
          seededResidual = postSolve.residual_vector;
          postSolveOutput = postSolve.raw_output;
          postSolveError = postSolve.error;
          fixResidual = undefined;
        } else if (challenge.scoring.method === 'fix_and_verify') {
          const preSolve = runSolve(projectRoot, solveOpts);
          preResidual = preSolve.residual_vector;
          applyMutation(challenge, projectRoot);
          const seededSolve = runSolve(projectRoot, solveOpts);
          seededResidual = seededSolve.residual_vector;
          postSolveOutput = seededSolve.raw_output;
          postSolveError = seededSolve.error;
          // Attempt full remediation
          runSolveFull(projectRoot, { timeout: timeout * 2, focus });
          // Measure result after fix
          const postFixSolve = runSolve(projectRoot, solveOpts);
          fixResidual = postFixSolve.residual_vector;
        } else {
          const preSolve = runSolve(projectRoot, solveOpts);
          preResidual = preSolve.residual_vector;
          applyMutation(challenge, projectRoot);
          const postSolve = runSolve(projectRoot, solveOpts);
          seededResidual = postSolve.residual_vector;
          postSolveOutput = postSolve.raw_output;
          postSolveError = postSolve.error;
          fixResidual = undefined;
        }

        const score = scoreChallenge(
          challenge,
          preResidual,
          seededResidual,
          postSolveOutput,
          postSolveError,
          fixResidual
        );

        const executionTimeMs = Date.now() - challengeStart;
        result = {
          challenge,
          pre_residual: preResidual,
          post_residual: seededResidual,
          fix_residual: fixResidual,
          score,
          execution_time_ms: executionTimeMs,
          timestamp: new Date().toISOString()
        };
        saveResult(challenge.id, result);

        parentPort.postMessage({ type: 'progress', challengeId: challenge.id, status: score.passed ? 'PASS' : 'FAIL', reason: score.reason, timeMs: executionTimeMs });
      } catch (e) {
        const executionTimeMs = Date.now() - challengeStart;
        result = {
          challenge,
          pre_residual: null,
          post_residual: null,
          fix_residual: null,
          score: { passed: false, score: 0, reduction_score: 0, reason: `Benchmark error: ${e.message}` },
          execution_time_ms: executionTimeMs,
          timestamp: new Date().toISOString()
        };
        saveResult(challenge.id, result);
        parentPort.postMessage({ type: 'progress', challengeId: challenge.id, status: 'ERROR', reason: e.message, timeMs: executionTimeMs });
      } finally {
        restoreSnapshot(snapshot, projectRoot);
      }

      parentPort.postMessage({ type: 'result', challengeId: challenge.id, result });
    }
    parentPort.postMessage({ type: 'done' });
  })();

  return; // stop main thread code from executing in worker
}

// ── Main thread ────────────────────────────────────────────────────────────

const libDir = path.join(__dirname, '..', 'lib');
const { loadAllChallenges, loadChallenge, loadByCategory, loadByDifficulty, validateAll, printSummary } = require(path.join(libDir, 'challenges.cjs'));
const { applyMutation } = require(path.join(libDir, 'mutator.cjs'));
const { scoreChallenge, computeReport, formatReport, LAYER_ALIASES } = require(path.join(libDir, 'scorer.cjs'));
const { createSnapshot, restoreSnapshot, runSolve, runSolveFull, createIsolatedRoot, cleanupIsolatedRoot, saveResult } = require(path.join(libDir, 'runner.cjs'));

// Resolve a benchmark target_layer name to the canonical nf-solve key for --focus.
// Falls back to the layer name itself if not in LAYER_ALIASES.
function focusLayerFor(challenge) {
  const layer = challenge.scoring && challenge.scoring.target_layer;
  if (!layer) return null;
  return LAYER_ALIASES[layer] || layer;
}

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const BASELINE_PATH = path.join(__dirname, '..', 'baseline.json');
const TREND_PATH = path.join(RESULTS_DIR, 'trend.jsonl');

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

function appendTrend(report, results) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const avgReductionScore = results
    .filter(r => r.score && r.score.reduction_score !== undefined)
    .reduce((sum, r, _, arr) => sum + r.score.reduction_score / arr.length, 0);

  // by_layer aggregation from results
  const byLayer = {};
  const byDifficulty = {};
  for (const r of results) {
    const c = r.challenge;
    if (!c) continue;

    if (c.target_layers) {
      for (const layer of c.target_layers) {
        if (!byLayer[layer]) byLayer[layer] = { passed: 0, total: 0 };
        byLayer[layer].total++;
        if (r.score && r.score.passed) byLayer[layer].passed++;
      }
    }

    const diff = c.difficulty;
    if (diff) {
      if (!byDifficulty[diff]) byDifficulty[diff] = { passed: 0, total: 0 };
      byDifficulty[diff].total++;
      if (r.score && r.score.passed) byDifficulty[diff].passed++;
    }
  }

  const entry = {
    timestamp: new Date().toISOString(),
    pass_rate: parseFloat(report.passRate),
    passed: report.passed,
    total: report.total,
    avg_reduction_score: avgReductionScore,
    by_layer: byLayer,
    by_difficulty: byDifficulty
  };

  fs.appendFileSync(TREND_PATH, JSON.stringify(entry) + '\n');
}

async function runChallengeSerial(challenge, projectRoot, timeout) {
  const challengeStart = Date.now();
  const snapshot = createSnapshot(projectRoot);
  const focus = focusLayerFor(challenge);
  const solveOpts = { timeout, focus };

  try {
    let preResidual, seededResidual, fixResidual, postSolveOutput, postSolveError;

    if (challenge.scoring.method === 'no_regression') {
      const preSolve = runSolve(projectRoot, solveOpts);
      preResidual = preSolve.residual_vector;
      const postSolve = runSolve(projectRoot, solveOpts);
      seededResidual = postSolve.residual_vector;
      postSolveOutput = postSolve.raw_output;
      postSolveError = postSolve.error;
      fixResidual = undefined;
    } else if (challenge.scoring.method === 'fix_and_verify') {
      const preSolve = runSolve(projectRoot, solveOpts);
      preResidual = preSolve.residual_vector;
      applyMutation(challenge, projectRoot);
      const seededSolve = runSolve(projectRoot, solveOpts);
      seededResidual = seededSolve.residual_vector;
      postSolveOutput = seededSolve.raw_output;
      postSolveError = seededSolve.error;
      runSolveFull(projectRoot, { timeout: timeout * 2, focus });
      const postFixSolve = runSolve(projectRoot, solveOpts);
      fixResidual = postFixSolve.residual_vector;
    } else {
      const preSolve = runSolve(projectRoot, solveOpts);
      preResidual = preSolve.residual_vector;
      applyMutation(challenge, projectRoot);
      const postSolve = runSolve(projectRoot, solveOpts);
      seededResidual = postSolve.residual_vector;
      postSolveOutput = postSolve.raw_output;
      postSolveError = postSolve.error;
      fixResidual = undefined;
    }

    const score = scoreChallenge(
      challenge,
      preResidual,
      seededResidual,
      postSolveOutput,
      postSolveError,
      fixResidual
    );

    const executionTimeMs = Date.now() - challengeStart;
    return {
      challenge,
      pre_residual: preResidual,
      post_residual: seededResidual,
      fix_residual: fixResidual,
      score,
      execution_time_ms: executionTimeMs,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    const executionTimeMs = Date.now() - challengeStart;
    return {
      challenge,
      pre_residual: null,
      post_residual: null,
      fix_residual: null,
      score: { passed: false, score: 0, reduction_score: 0, reason: `Benchmark error: ${e.message}` },
      execution_time_ms: executionTimeMs,
      timestamp: new Date().toISOString()
    };
  } finally {
    restoreSnapshot(snapshot, projectRoot);
  }
}

async function runBenchmark() {
  const opts = getFilterOptions();
  const projectRoot = opts.projectRoot || getProjectRoot();
  const baselineTolerance = opts.baselineTolerance !== undefined ? opts.baselineTolerance : 5.0;
  const timeout = opts.timeout || 300;

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

  const parallelN = opts.parallel && opts.parallel > 1 ? opts.parallel : 1;

  if (parallelN > 1) {
    // Parallel execution using worker_threads + isolated project roots
    const workerCount = Math.min(parallelN, challenges.length);
    const isolatedRoots = [];

    try {
      for (let i = 0; i < workerCount; i++) {
        isolatedRoots.push(createIsolatedRoot(projectRoot));
      }

      // Partition challenges across workers
      const chunks = Array.from({ length: workerCount }, () => []);
      challenges.forEach((c, i) => chunks[i % workerCount].push(c));

      // Track ordering for output
      const resultMap = {};
      const progressMap = {};

      await new Promise((resolve, reject) => {
        let doneCount = 0;
        const workers = [];

        for (let w = 0; w < workerCount; w++) {
          const worker = new Worker(__filename, {
            workerData: { challenges: chunks[w], projectRoot: isolatedRoots[w], timeout }
          });

          worker.on('message', (msg) => {
            if (msg.type === 'progress') {
              const timeStr = msg.timeMs >= 1000
                ? `${(msg.timeMs / 1000).toFixed(1)}s`
                : `${msg.timeMs}ms`;
              console.log(`  ${msg.challengeId} ${msg.status} (${msg.reason}) [${timeStr}]`);
              progressMap[msg.challengeId] = msg;
            } else if (msg.type === 'result') {
              resultMap[msg.challengeId] = msg.result;
            } else if (msg.type === 'done') {
              doneCount++;
              if (doneCount === workerCount) resolve();
            }
          });

          worker.on('error', reject);
          workers.push(worker);
        }
      });

      // Collect results in original challenge order
      for (const c of challenges) {
        const result = resultMap[c.id];
        if (result) {
          results.push(result);
          if (result.score.passed) passed++;
          else failed++;
        }
      }
    } finally {
      for (const root of isolatedRoots) {
        cleanupIsolatedRoot(root);
      }
    }
  } else {
    // Serial execution
    for (let i = 0; i < challenges.length; i++) {
      const challenge = challenges[i];
      const progress = `[${i + 1}/${challenges.length}]`;
      process.stdout.write(`${progress} ${challenge.id} ${challenge.title}... `);

      const result = await runChallengeSerial(challenge, projectRoot, timeout);
      results.push(result);
      saveResult(challenge.id, result);

      const executionTimeMs = result.execution_time_ms;
      const timeStr = executionTimeMs >= 1000
        ? `${(executionTimeMs / 1000).toFixed(1)}s`
        : `${executionTimeMs}ms`;

      if (result.score.passed) {
        passed++;
        console.log(`PASS (${result.score.reason}) [${timeStr}]`);
      } else {
        failed++;
        console.log(`FAIL (${result.score.reason}) [${timeStr}]`);
      }
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

  // Append to trend.jsonl
  appendTrend(report, results);

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

  // Exit 1 only on baseline regression (handled above). Raw failures are expected
  // during active development — CI tracks the score, not a pass-all gate.
  process.exit(0);
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

function calibrate() {
  if (!fs.existsSync(RESULTS_DIR)) {
    console.log('No results directory found. Run benchmarks first.');
    return;
  }

  const reportFiles = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))
    .sort();

  if (reportFiles.length === 0) {
    console.log('No report files found. Run benchmarks first.');
    return;
  }

  // Aggregate per-challenge pass/fail across all historical runs
  const challengeHistory = {}; // id -> { passed: N, total: N, difficulty: string }

  for (const f of reportFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      const challengeResults = data.results || [];
      for (const r of challengeResults) {
        if (!r.id) continue;
        if (!challengeHistory[r.id]) {
          challengeHistory[r.id] = { passed: 0, total: 0, difficulty: r.difficulty || 'unknown' };
        }
        challengeHistory[r.id].total++;
        if (r.passed) challengeHistory[r.id].passed++;
      }
    } catch (e) {
      console.warn(`Skipping malformed report: ${f} (${e.message})`);
    }
  }

  function empiricalDifficulty(rate) {
    if (rate >= 0.9) return 'easy';
    if (rate >= 0.6) return 'medium';
    if (rate >= 0.3) return 'hard';
    return 'expert';
  }

  const N = reportFiles.length;
  console.log(`\nChallenge difficulty calibration (based on ${N} run${N === 1 ? '' : 's'}):\n`);
  console.log(`  ${'ID'.padEnd(12)} ${'Current'.padEnd(14)} ${'Empirical'.padEnd(12)} Suggested`);
  console.log(`  ${''.padEnd(12, '-')} ${''.padEnd(14, '-')} ${''.padEnd(12, '-')} ${''.padEnd(30, '-')}`);

  const ids = Object.keys(challengeHistory).sort();
  for (const id of ids) {
    const { passed, total, difficulty } = challengeHistory[id];
    const rate = passed / total;
    const empPct = (rate * 100).toFixed(1) + '%';
    const suggested = empiricalDifficulty(rate);
    let note;
    if (suggested === difficulty) {
      note = `${suggested} (confirmed)`;
    } else {
      const tiers = ['easy', 'medium', 'hard', 'expert'];
      const currentIdx = tiers.indexOf(difficulty);
      const suggestedIdx = tiers.indexOf(suggested);
      note = suggestedIdx > currentIdx
        ? `${suggested} (upgrade difficulty)`
        : `${suggested} (downgrade)`;
    }
    console.log(`  ${id.padEnd(12)} ${(difficulty || 'unknown').padEnd(14)} ${empPct.padEnd(12)} ${note}`);
  }
  console.log('');
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
  calibrate        Calibrate difficulty tiers from historical results
  help             Show this help

Options:
  --project-root <path>       Path to nForma project (or set QGSD_ROOT env)
  --single <BENCH-NNN>        Run a single challenge by ID
  --category <name>           Filter by category
  --difficulty <level>        Filter by difficulty (easy|medium|hard|expert)
  --tags <tag1,tag2>          Filter by tags
  --timeout <seconds>         Per-challenge timeout (default: 300)
  --dry-run                   Show what would run without executing
  --parallel <N>              Run N challenges in parallel using worker threads
  --save-baseline             Save current results as baseline.json
  --compare-baseline          Fail if pass rate drops >5pp vs baseline.json
  --baseline-tolerance <pp>   Pass rate drop tolerance in percentage points (default: 5)

Examples:
  nf-benchmark run --project-root ~/code/QGSD
  nf-benchmark run --single BENCH-001 --project-root ~/code/QGSD
  nf-benchmark run --category formal-models --project-root ~/code/QGSD
  nf-benchmark run --project-root ~/code/QGSD --save-baseline
  nf-benchmark run --project-root ~/code/QGSD --compare-baseline
  nf-benchmark run --project-root ~/code/QGSD --parallel 4
  nf-benchmark list
  nf-benchmark validate
  nf-benchmark calibrate
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
  case 'calibrate':
    calibrate();
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
