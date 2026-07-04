'use strict';

// Tests for the bug-history miner (bin/bug-history-miner.cjs). Builds a throwaway git
// repo with known fix commits and asserts each is classified by would-catch capability
// (nForma-tooling scopes separated; defect types mapped to the capability taxonomy).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { mine } = require('../bin/bug-history-miner.cjs');

function repoWith(subjects) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhm-'));
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['commit', '--allow-empty', '-q', '-m', 'chore: base']);
  for (const s of subjects) git(['commit', '--allow-empty', '-q', '-m', s]);
  return dir;
}

test('classifies fix commits by would-catch capability; ignores non-fix commits', () => {
  const dir = repoWith([
    'fix(quorum): args_template fallback',          // nForma tooling
    'fix(solve): rate-limit semaphore deadlock',    // concurrency
    'fix: off-by-one in fan-out boundary',          // llm-code-review
    'fix(formal): dangling Alloy signature',        // deterministic-already
    'feat: a new feature',                          // not a fix → ignored
  ]);
  try {
    const r = mine(dir, 100);
    assert.strictEqual(r.total_bugs, 4, 'only the 4 fix commits counted');
    const cap = (id) => r.mappings.find(m => m.subject.includes(id))?.capability;
    assert.strictEqual(cap('args_template'), 'out-of-scope-nforma-tooling');
    assert.strictEqual(cap('semaphore deadlock'), 'concurrency-modeling');
    assert.strictEqual(cap('off-by-one'), 'llm-code-review');
    assert.strictEqual(cap('dangling Alloy'), 'deterministic-already');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ranked output is sorted by count and sums to total', () => {
  const dir = repoWith([
    'fix: off-by-one A', 'fix: wrong return value B', 'fix: semantic logic C', // 3× llm-review
    'fix: memory leak D',                                                       // 1× resource
  ]);
  try {
    const r = mine(dir, 100);
    assert.strictEqual(r.ranked[0].capability, 'llm-code-review');
    assert.strictEqual(r.ranked[0].count, 3);
    assert.strictEqual(r.ranked.reduce((a, x) => a + x.count, 0), r.total_bugs);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
