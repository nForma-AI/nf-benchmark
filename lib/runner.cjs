'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

const SNAPSHOT_EXTENSIONS = ['.json', '.tla', '.jsonl'];

// Dirs where challenges file-create. The snapshot model runs in place, so any
// file a challenge adds here must be removed on restore — otherwise it persists
// and a repeat run sees the file already present (no residual increase = false fail).
const CREATE_GUARD_DIRS = ['bin', 'test', 'src', 'hooks', 'templates', 'scripts', '.planning'];

function createSnapshot(projectRoot) {
  const content = {};
  const formalDir = path.join(projectRoot, '.planning', 'formal');
  if (fs.existsSync(formalDir)) {
    for (const ext of SNAPSHOT_EXTENSIONS) {
      for (const f of walkDir(formalDir, ext)) {
        const rel = path.relative(projectRoot, f);
        try {
          content[rel] = fs.readFileSync(f, 'utf8');
        } catch { /* skip unreadable */ }
      }
    }
  }

  // Also snapshot docs/*.md files so documentation mutations are restored between challenges
  const docsDir = path.join(projectRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const f of walkDir(docsDir, '.md')) {
      const rel = path.relative(projectRoot, f);
      try {
        content[rel] = fs.readFileSync(f, 'utf8');
      } catch { /* skip unreadable */ }
    }
  }

  // Record every pre-existing file in the create-guard dirs so restoreSnapshot
  // can delete anything a challenge added.
  const guardPaths = new Set();
  for (const d of CREATE_GUARD_DIRS) {
    for (const f of listAllFiles(path.join(projectRoot, d))) guardPaths.add(f);
  }

  return { content, guardPaths };
}

function restoreSnapshot(snapshot, projectRoot) {
  if (!snapshot) return;
  const content = snapshot.content || {};
  const guardPaths = snapshot.guardPaths;

  // Delete non-snapshot .json/.tla files created under .planning/formal
  const formalDir = path.join(projectRoot, '.planning', 'formal');
  if (fs.existsSync(formalDir)) {
    for (const ext of SNAPSHOT_EXTENSIONS) {
      for (const f of walkDir(formalDir, ext)) {
        const rel = path.relative(projectRoot, f);
        if (!(rel in content)) {
          try { fs.unlinkSync(f); } catch { /* ignore */ }
        }
      }
    }
  }

  // Delete any file a challenge created in the guarded dirs
  if (guardPaths) {
    for (const d of CREATE_GUARD_DIRS) {
      for (const f of listAllFiles(path.join(projectRoot, d))) {
        if (!guardPaths.has(f)) {
          try { fs.unlinkSync(f); } catch { /* ignore */ }
        }
      }
    }
  }

  // Restore snapshotted file content
  for (const [rel, c] of Object.entries(content)) {
    const fullPath = path.join(projectRoot, rel);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, c);
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

// All files (any extension) under dir, recursively. Used to detect files a
// challenge created so they can be removed on snapshot restore.
function listAllFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllFiles(fullPath));
    } else {
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
  // --fast/--skip-* prevent the t_to_c hang observed on full remediation runs.
  const args = ['--json', '--fast', '--no-timeout', '--skip-heatmap', '--skip-proximity', '--no-auto-commit'];

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
  const candidates = [
    path.join(os.homedir(), '.claude', 'nf-bin', 'nf-solve.cjs'),
    path.join(projectRoot, 'bin', 'nf-solve.cjs')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('nf-solve.cjs not found');
}

function createIsolatedRoot(projectRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-bench-'));

  // Directories that must be deep-copied (not symlinked) because either:
  // - The solver writes to them (.planning, bin)
  // - The mutator writes to them (hooks, docs, templates, scripts, bin)
  // Symlinking these would let parallel workers clobber the real project repo.
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
