'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

function createSnapshot(projectRoot) {
  const snapshot = {};
  const formalDir = path.join(projectRoot, '.planning', 'formal');
  if (!fs.existsSync(formalDir)) return snapshot;

  const jsonFiles = walkDir(formalDir, '.json');
  for (const f of jsonFiles) {
    const rel = path.relative(projectRoot, f);
    try {
      snapshot[rel] = fs.readFileSync(f, 'utf8');
    } catch { /* skip unreadable */ }
  }
  return snapshot;
}

function restoreSnapshot(snapshot, projectRoot) {
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
  const timeout = options.timeout || 300;
  const args = ['--report-only', '--json', '--fast'];

  if (options.focus) {
    args.push(`--focus="${options.focus}"`);
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

function findSolveBin(projectRoot) {
  const candidates = [
    path.join(require('os').homedir(), '.claude', 'nf-bin', 'nf-solve.cjs'),
    path.join(projectRoot, 'bin', 'nf-solve.cjs')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('nf-solve.cjs not found');
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
  return files.map(f => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')));
}

module.exports = {
  createSnapshot,
  restoreSnapshot,
  runSolve,
  findSolveBin,
  saveResult,
  loadResults,
  RESULTS_DIR
};
