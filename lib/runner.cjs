'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

const SNAPSHOT_EXTENSIONS = ['.json', '.tla'];

function createSnapshot(projectRoot) {
  const snapshot = {};
  const formalDir = path.join(projectRoot, '.planning', 'formal');
  if (!fs.existsSync(formalDir)) return snapshot;

  for (const ext of SNAPSHOT_EXTENSIONS) {
    const files = walkDir(formalDir, ext);
    for (const f of files) {
      const rel = path.relative(projectRoot, f);
      try {
        snapshot[rel] = fs.readFileSync(f, 'utf8');
      } catch { /* skip unreadable */ }
    }
  }

  // Also snapshot docs/*.md files so documentation mutations are restored between challenges
  const docsDir = path.join(projectRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    const mdFiles = walkDir(docsDir, '.md');
    for (const f of mdFiles) {
      const rel = path.relative(projectRoot, f);
      try {
        snapshot[rel] = fs.readFileSync(f, 'utf8');
      } catch { /* skip unreadable */ }
    }
  }

  return snapshot;
}

function restoreSnapshot(snapshot, projectRoot) {
  const formalDir = path.join(projectRoot, '.planning', 'formal');

  // First, clean up files that weren't in the original snapshot (for all tracked extensions)
  if (fs.existsSync(formalDir)) {
    for (const ext of SNAPSHOT_EXTENSIONS) {
      const currentFiles = walkDir(formalDir, ext);
      for (const f of currentFiles) {
        const rel = path.relative(projectRoot, f);
        if (!(rel in snapshot)) {
          fs.unlinkSync(f);
        }
      }
    }
  }

  // Then restore the snapshot files
  for (const [rel, content] of Object.entries(snapshot)) {
    const fullPath = path.join(projectRoot, rel);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

// createSnapshot only captures .planning/formal (.json/.tla) + docs/*.md. A
// challenge's mutation.target_file often lives OUTSIDE that scope (bin/, src/,
// test files), so without an explicit revert a file-create mutation persists —
// making a later file-create a no-op (post == pre → false "not detected") and
// polluting every subsequent challenge's baseline. These two helpers capture the
// target's pre-state and restore it (delete if created, rewrite if modified).
function captureMutationTarget(projectRoot, challenge) {
  const target = challenge && challenge.mutation && challenge.mutation.target_file;
  if (!target) return null;
  const fullPath = path.join(projectRoot, target);
  try {
    return fs.existsSync(fullPath)
      ? { target, existed: true, content: fs.readFileSync(fullPath) }
      : { target, existed: false };
  } catch {
    return null;
  }
}

// For a file-create/rename challenge, the target path must be ABSENT in the
// baseline (pre) solve for the "create" to represent a genuinely new file. Some
// SUTs carry a stray file already committed at that path — e.g. benchmark
// fixtures accidentally auto-committed into the product repo (109 bench-*.cjs
// were found committed in nForma's bin/). Without this, pre already contains the
// file, applyMutation's create is a no-op, post == pre, and detection is
// impossible. Remove a pre-existing create target before the baseline solve;
// captureMutationTarget has already saved it, so revertMutationTarget restores it.
function neutralizeCreateTarget(projectRoot, challenge) {
  const m = challenge && challenge.mutation;
  if (!m || !m.target_file) return;
  if (m.type !== 'file-create' && m.type !== 'file-rename') return;
  const fullPath = path.join(projectRoot, m.target_file);
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch {
    /* best-effort — a failed neutralize must not crash the benchmark */
  }
}

function revertMutationTarget(projectRoot, capture) {
  if (!capture || !capture.target) return;
  const fullPath = path.join(projectRoot, capture.target);
  try {
    if (capture.existed) {
      fs.writeFileSync(fullPath, capture.content);
    } else if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    /* best-effort revert — a failed revert must not crash the benchmark */
  }
}

function walkDir(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function runSolve(projectRoot, options = {}) {
  const sut = resolveSut(projectRoot, options);
  const binPath = sut.bin;
  // nf-solve takes 5+ minutes on a real project — 600s gives a safe margin.
  // Callers can override with opts.timeout.
  const timeout = options.timeout || 600;
  const args = ['--report-only', '--json', '--fast', '--no-timeout', '--max-iterations=1', '--skip-heatmap', '--skip-proximity', '--no-auto-commit'];

  if (options.focus) {
    args.push(`--focus=${options.focus}`);
  }

  try {
    const result = spawnSync('node', [binPath, ...args], {
      cwd: projectRoot,
      timeout: timeout * 1000,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, NF_SOLVE_SESSION_ID: `bench-${Date.now().toString(36)}` }
    });

    const stdout = result.stdout || '';
    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) {
      return {
        residual_vector: null,
        raw_output: stdout,
        error: null,
        exit_code: result.status
      };
    }

    const json = JSON.parse(stdout.slice(jsonStart));
    return {
      residual_vector: json.residual_vector || json,
      raw_output: stdout,
      error: null,
      exit_code: result.status,
      sut_source: sut.source,
      sut_version: sut.version
    };
  } catch (e) {
    return {
      residual_vector: null,
      raw_output: '',
      error: e,
      exit_code: -1
    };
  }
}

function runSolveFull(projectRoot, options = {}) {
  const sut = resolveSut(projectRoot, options);
  const binPath = sut.bin;
  const timeout = options.timeout || 600;
  const args = ['--json', '--no-timeout'];

  if (options.focus) {
    args.push(`--focus=${options.focus}`);
  }

  try {
    const result = spawnSync('node', [binPath, ...args], {
      cwd: projectRoot,
      timeout: timeout * 1000,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, NF_SOLVE_SESSION_ID: `bench-full-${Date.now().toString(36)}` }
    });

    const stdout = result.stdout || '';
    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) {
      return {
        residual_vector: null,
        raw_output: stdout,
        error: null,
        exit_code: result.status
      };
    }

    const json = JSON.parse(stdout.slice(jsonStart));
    return {
      residual_vector: json.residual_vector || json,
      raw_output: stdout,
      error: null,
      exit_code: result.status,
      sut_source: sut.source,
      sut_version: sut.version
    };
  } catch (e) {
    return {
      residual_vector: null,
      raw_output: '',
      error: e,
      exit_code: -1
    };
  }
}

// Best-effort version stamp for the SUT (nearest package.json above the bin).
function readSutVersion(binPath) {
  try {
    let dir = path.dirname(binPath);
    for (let i = 0; i < 4; i++) {
      const pj = path.join(dir, 'package.json');
      if (fs.existsSync(pj)) {
        const v = JSON.parse(fs.readFileSync(pj, 'utf8')).version;
        if (v) return v;
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch (_) { /* ignore */ }
  return 'unknown';
}

// Resolve a published nForma package as the SUT — COMPLETE decoupling from any source
// checkout. spec e.g. "@nforma.ai/nforma@0.43.1". Installed once into a content-addressed
// cache (~/.cache/nf-benchmark-sut/<spec>) with --ignore-scripts (just the files, no heavy
// postinstall), then its bundled bin/nf-solve.cjs is used.
function resolveNpmSut(spec) {
  const cacheRoot = path.join(os.homedir(), '.cache', 'nf-benchmark-sut');
  const dir = path.join(cacheRoot, spec.replace(/[^a-zA-Z0-9._@-]/g, '_'));
  const bin = path.join(dir, 'node_modules', '@nforma.ai', 'nforma', 'bin', 'nf-solve.cjs');
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync('npm', ['i', spec, '--prefix', dir, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund'],
      { encoding: 'utf8', timeout: 300000 });
    if ((r.status !== 0 && r.status !== null) || !fs.existsSync(bin)) {
      throw new Error('npm SUT install failed for ' + spec + ': ' + ((r.stderr || r.error && r.error.message || '').slice(0, 200)));
    }
  }
  return { bin, source: 'npm:' + spec, version: readSutVersion(bin) };
}

// Resolve the System Under Test (nf-solve) explicitly and record its provenance,
// so benchmark scores are reproducible and comparable across nForma versions.
// Order: explicit pin (opts.sut / NF_SUT — a path OR an "npm:<pkg>@<ver>" spec) →
// installed copy → dev checkout (warned).
function resolveSut(projectRoot, opts = {}) {
  const override = opts.sut || process.env.NF_SUT;
  if (override) {
    if (override.startsWith('npm:')) return resolveNpmSut(override.slice(4));
    if (!fs.existsSync(override)) throw new Error('SUT not found at --sut/NF_SUT: ' + override);
    return { bin: override, source: 'pinned', version: readSutVersion(override) };
  }
  const installed = path.join(os.homedir(), '.claude', 'nf-bin', 'nf-solve.cjs');
  if (fs.existsSync(installed)) return { bin: installed, source: 'installed', version: readSutVersion(installed) };
  const dev = path.join(projectRoot, 'bin', 'nf-solve.cjs');
  if (fs.existsSync(dev)) {
    if (!resolveSut._warned) {
      console.warn('[nf-benchmark] WARNING: SUT resolved from the dev checkout (' + dev +
        ') — results are NOT version-pinned. Set --sut/NF_SUT to a pinned nf-solve.cjs for reproducible, version-comparable runs.');
      resolveSut._warned = true;
    }
    return { bin: dev, source: 'dev-checkout', version: readSutVersion(dev) };
  }
  throw new Error('nf-solve.cjs not found (set --sut/NF_SUT, or install @nforma.ai/nforma)');
}

// Back-compat: callers/tests that only need the path.
function findSolveBin(projectRoot) {
  return resolveSut(projectRoot).bin;
}

// Directories that MUST be deep-copied (not symlinked) because the mutator and/or
// the solver write into them. Symlinking these would let a seeded mutation or a
// solve run write THROUGH to the real project repo — the exact corruption this
// isolation exists to prevent. (.git is never copied or symlinked.)
const COPY_DIRS = new Set(['.planning', 'bin', 'hooks', 'docs', 'templates', 'scripts']);

function createIsolatedRoot(projectRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-bench-'));

  // Symlink read-only entries; deep-copy the mutable ones; skip .git entirely.
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || COPY_DIRS.has(entry.name)) continue;
    fs.symlinkSync(path.join(projectRoot, entry.name), path.join(tempDir, entry.name));
  }
  for (const dirName of COPY_DIRS) {
    const srcDir = path.join(projectRoot, dirName);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, path.join(tempDir, dirName), { recursive: true });
    }
  }

  return tempDir;
}

function cleanupIsolatedRoot(tempDir) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function saveResult(challengeId, result) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const filename = `${challengeId}-${Date.now().toString(36)}.json`;
  fs.writeFileSync(
    path.join(RESULTS_DIR, filename),
    JSON.stringify(result, null, 2) + '\n'
  );
  return filename;
}

function loadResults() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  const results = [];
  for (const f of files) {
    try {
      results.push(JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')));
    } catch (e) {
      // Skip malformed JSON files
      console.warn(`Skipping malformed result file: ${f} (${e.message})`);
    }
  }
  return results;
}

module.exports = {
  createSnapshot,
  restoreSnapshot,
  captureMutationTarget,
  revertMutationTarget,
  neutralizeCreateTarget,
  runSolve,
  runSolveFull,
  createIsolatedRoot,
  cleanupIsolatedRoot,
  findSolveBin,
  resolveSut,
  resolveNpmSut,
  readSutVersion,
  saveResult,
  loadResults,
  RESULTS_DIR
};
