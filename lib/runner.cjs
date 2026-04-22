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
  const binPath = findSolveBin(projectRoot);
  // nf-solve takes 5+ minutes on a real project — 600s gives a safe margin.
  // Callers can override with opts.timeout.
  const timeout = options.timeout || 600;
  const args = ['--report-only', '--json', '--fast', '--no-timeout', '--max-iterations=1', '--skip-heatmap', '--skip-proximity', '--no-auto-commit', '--no-coderlm'];

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
      exit_code: result.status
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
  const binPath = findSolveBin(projectRoot);
  const timeout = options.timeout || 600;
  const args = ['--json', '--fast', '--no-timeout', '--skip-heatmap', '--skip-proximity', '--no-auto-commit', '--no-coderlm'];

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
      exit_code: result.status
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

function findSolveBin(projectRoot) {
  // Prefer solver in projectRoot/bin/ when running in isolated temp dir
  // to ensure solver runs from the isolated context, not $HOME/.claude/nf-bin/
  const localBin = path.join(projectRoot, 'bin', 'nf-solve.cjs');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  throw new Error('nf-solve.cjs not found');
}

function createIsolatedRoot(projectRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-bench-'));

  // Directories that must be deep-copied (not symlinked) because either:
  // - The solver writes to them (.planning, bin)
  // - The mutator writes to them (hooks, docs, templates, scripts, bin)
  const COPY_DIRS = new Set(['.planning', '.git', 'bin', 'hooks', 'docs', 'templates', 'scripts']);

  // Symlink everything else from projectRoot
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (COPY_DIRS.has(entry.name)) continue;
    const srcPath = path.join(projectRoot, entry.name);
    const destPath = path.join(tempDir, entry.name);
    fs.symlinkSync(srcPath, destPath);
  }

  // Deep copy mutable directories
  for (const dirName of COPY_DIRS) {
    if (dirName === '.git') continue; // skip .git entirely
    const srcDir = path.join(projectRoot, dirName);
    const destDir = path.join(tempDir, dirName);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
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
  runSolve,
  runSolveFull,
  createIsolatedRoot,
  cleanupIsolatedRoot,
  findSolveBin,
  saveResult,
  loadResults,
  RESULTS_DIR
};
