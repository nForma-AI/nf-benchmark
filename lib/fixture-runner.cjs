'use strict';
// lib/fixture-runner.cjs
// Self-contained fixture runner — the decoupled benchmark core.
//
// A fixture is a tiny COMPLETE project that embodies one defect plus a `verify`
// command that is the challenge's executable spec. The runner:
//   1. copies fixtures/<id>/project/ into a throwaway temp dir (never the host repo),
//   2. runs verify → expects FAIL (defect present),
//   3. runs the System Under Test (nf-solve, pinned) against the temp copy,
//   4. runs verify → expects PASS (defect fixed),
//   5. discards the temp dir.
// The fixture has NO dependency on QGSD or any host repo, so it cannot rot when the
// product evolves, and nothing the SUT does can touch the developer's working tree.

const fs            = require('fs');
const os            = require('os');
const path          = require('path');
const { spawnSync } = require('child_process');

// ── PURE: load + validate a fixture manifest ──────────────────────────────────
function loadFixture(fixtureDir) {
  const manifestPath = path.join(fixtureDir, 'fixture.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof m.id !== 'string' || !m.id) throw new Error(`${fixtureDir}: fixture.json missing id`);
  const method = (m.scoring && m.scoring.method) || 'fix_and_verify';
  // verify is the spec for code-level fixtures; residual_reduction fixtures are scored
  // by nf-solve's residual_vector instead and need no verify command.
  if (method !== 'residual_reduction' && (typeof m.verify !== 'string' || !m.verify)) {
    throw new Error(`${m.id}: fixture.json missing verify command`);
  }
  const projectDir = path.join(fixtureDir, 'project');
  if (!fs.existsSync(projectDir)) throw new Error(`${m.id}: missing project/ directory`);
  return { id: m.id, title: m.title || m.id, category: m.category || 'uncategorized',
           difficulty: m.difficulty || 'unknown', verify: m.verify, method, projectDir, manifest: m };
}

// ── PURE: scoring contract ─────────────────────────────────────────────────────
// fix_and_verify: the defect must be present before (verify fails) AND repaired
// after (verify passes). no_regression: verify must pass after (no defect introduced).
function scoreFixture(method, preStatus, postStatus) {
  if (method === 'no_regression') return { passed: postStatus === 0, reason: postStatus === 0 ? 'no regression' : 'regression introduced' };
  const preFailed = preStatus !== 0;
  const postPassed = postStatus === 0;
  if (!preFailed) return { passed: false, reason: 'defect not present pre-solve (fixture invalid or already fixed)' };
  if (!postPassed) return { passed: false, reason: 'defect not repaired by SUT' };
  return { passed: true, reason: 'defect reproduced then repaired' };
}

function runVerify(cwd, verifyCmd) {
  const parts = verifyCmd.split(/\s+/);
  const r = spawnSync(parts[0], parts.slice(1), { cwd, encoding: 'utf8', timeout: 60000 });
  return r.status === null ? -1 : r.status;
}

// Default SUT adapter: run a pinned nf-solve against the temp project. Injectable so
// tests can substitute a stub, and so a future npx/version adapter can drop in.
function defaultSutRun(tempProjectDir, manifest, opts) {
  const { resolveSut } = require('./runner.cjs');
  const sut = resolveSut(opts.projectRoot || tempProjectDir, opts);
  const args = ['--json', '--no-timeout'];
  if (manifest.scoring && manifest.scoring.target_layer) args.push(`--focus=${manifest.scoring.target_layer}`);
  spawnSync('node', [sut.bin, ...args], { cwd: tempProjectDir, encoding: 'utf8', timeout: (opts.timeout || 600) * 1000, maxBuffer: 50 * 1024 * 1024 });
  return { source: sut.source, version: sut.version };
}

// Measure a project's total residual via `nf-solve --report-only` (fast, no LLM).
// Returns { total, layers, has_residual } — sum of per-layer residual_vector values.
function measureResidual(projectDir, opts = {}) {
  const { resolveSut } = require('./runner.cjs');
  const sut = resolveSut(opts.projectRoot || projectDir, opts);
  const args = ['--report-only', '--json', '--fast', '--no-timeout', '--skip-tests', '--skip-proximity', '--skip-heatmap', '--no-coderlm'];
  const r = spawnSync('node', [sut.bin, ...args], { cwd: projectDir, encoding: 'utf8', timeout: (opts.reportTimeout || 120) * 1000, maxBuffer: 50 * 1024 * 1024 });
  const out = r.stdout || '';
  const i = out.indexOf('{');
  if (i === -1) return { total: null, layers: {}, has_residual: false };
  let j;
  try { j = JSON.parse(out.slice(i)); } catch (_) { return { total: null, layers: {}, has_residual: false }; }
  const rv = j.residual_vector || {};
  const layers = {};
  let total = 0;
  for (const k of Object.keys(rv)) {
    const v = (rv[k] && typeof rv[k].residual === 'number' && rv[k].residual > 0) ? rv[k].residual : 0;
    layers[k] = v;
    total += v;
  }
  return { total, layers, has_residual: !!j.has_residual };
}

// ── Run one fixture end-to-end in isolation ────────────────────────────────────
function runFixture(fixtureDir, opts = {}) {
  const fx = loadFixture(fixtureDir);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-fixture-'));
  try {
    fs.cpSync(fx.projectDir, tempDir, { recursive: true });

    if (fx.method === 'residual_reduction') {
      // Score one seeded layer gap when target_layer is given; else the total.
      const targetLayer = fx.manifest.scoring && fx.manifest.scoring.target_layer;
      const metric = (m) => (targetLayer ? (m.layers && m.layers[targetLayer]) : m.total);
      const pre = measureResidual(tempDir, opts);
      const preMetric = metric(pre);
      const detected = typeof preMetric === 'number' && preMetric > 0;
      // The repair half needs a live quorum solve; gate it behind RUN_LIVE_SOLVE (or
      // an explicit sutRun stub in tests). Detection alone is fast and needs no LLM.
      const willSolve = opts.sutRun || process.env.RUN_LIVE_SOLVE;
      if (!willSolve) {
        return { id: fx.id, title: fx.title, category: fx.category, difficulty: fx.difficulty,
                 method: fx.method, target_layer: targetLayer || null, pre_residual: preMetric,
                 total_residual: pre.total, post_residual: null, detected,
                 passed: null, reason: detected ? 'gap detected; repair not run (set RUN_LIVE_SOLVE)' : 'no residual gap detected — fixture invalid',
                 sut: null };
      }
      const sutRunFn = opts.sutRun || defaultSutRun;
      let sutInfo = null;
      try { sutInfo = sutRunFn(tempDir, fx.manifest, opts); } catch (e) { sutInfo = { error: e.message }; }
      const post = measureResidual(tempDir, opts);
      const postMetric = metric(post);
      const repaired = detected && typeof postMetric === 'number' && postMetric === 0;
      return { id: fx.id, title: fx.title, category: fx.category, difficulty: fx.difficulty,
               method: fx.method, target_layer: targetLayer || null, pre_residual: preMetric, post_residual: postMetric, detected,
               passed: detected && repaired,
               reason: !detected ? 'no residual gap detected — fixture invalid'
                       : repaired ? 'residual gap detected then driven to zero' : 'residual not fully closed by SUT',
               sut: sutInfo };
    }

    // fix_and_verify (code-level): verify must FAIL pre-solve and PASS post-solve.
    const sutRun = opts.sutRun || defaultSutRun;
    const preStatus = runVerify(tempDir, fx.verify);
    let sutInfo = null;
    try { sutInfo = sutRun(tempDir, fx.manifest, opts); } catch (e) { sutInfo = { error: e.message }; }
    const postStatus = runVerify(tempDir, fx.verify);
    const score = scoreFixture(fx.method, preStatus, postStatus);
    return { id: fx.id, title: fx.title, category: fx.category, difficulty: fx.difficulty,
             method: fx.method, pre_status: preStatus, post_status: postStatus,
             passed: score.passed, reason: score.reason, sut: sutInfo };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Discover all fixtures under a root (default: ../fixtures).
function discoverFixtures(fixturesRoot) {
  const root = fixturesRoot || path.join(__dirname, '..', 'fixtures');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'fixture.json')))
    .map(e => path.join(root, e.name))
    .sort();
}

module.exports = { loadFixture, scoreFixture, runVerify, runFixture, discoverFixtures, defaultSutRun, measureResidual };
