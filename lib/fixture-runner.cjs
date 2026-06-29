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
  if (typeof m.verify !== 'string' || !m.verify) throw new Error(`${m.id}: fixture.json missing verify command`);
  const method = (m.scoring && m.scoring.method) || 'fix_and_verify';
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

// ── Run one fixture end-to-end in isolation ────────────────────────────────────
function runFixture(fixtureDir, opts = {}) {
  const fx = loadFixture(fixtureDir);
  const sutRun = opts.sutRun || defaultSutRun;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-fixture-'));
  try {
    fs.cpSync(fx.projectDir, tempDir, { recursive: true });
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

module.exports = { loadFixture, scoreFixture, runVerify, runFixture, discoverFixtures, defaultSutRun };
