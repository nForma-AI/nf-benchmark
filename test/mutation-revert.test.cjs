'use strict';

// Fast unit tests (no solve) for the mutation-target revert helpers that keep
// each challenge starting from a pristine tree. createSnapshot only covers
// .planning/formal + docs; these helpers cover the mutation.target_file itself
// (bin/, src/, tests/ …) so a file-create mutation cannot persist across
// challenges (which would make a later file-create a no-op → false "not
// detected") and cannot pollute subsequent baselines.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { captureMutationTarget, revertMutationTarget } = require(path.join(__dirname, '..', 'lib', 'runner.cjs'));

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-bench-revert-'));
}

test('file-create mutation is fully reverted (file removed)', () => {
  const root = tmpRoot();
  try {
    const challenge = { mutation: { type: 'file-create', target_file: 'bin/bench-orphan.cjs' } };
    const cap = captureMutationTarget(root, challenge);
    assert.deepStrictEqual(cap, { target: 'bin/bench-orphan.cjs', existed: false });

    // Simulate applyMutation creating the file.
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bin', 'bench-orphan.cjs'), 'module.exports = {};');
    assert.ok(fs.existsSync(path.join(root, 'bin', 'bench-orphan.cjs')));

    revertMutationTarget(root, cap);
    assert.ok(!fs.existsSync(path.join(root, 'bin', 'bench-orphan.cjs')),
      'a created file must be deleted on revert so it cannot pollute later challenges');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('file-modify mutation is reverted to the original byte content', () => {
  const root = tmpRoot();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const target = path.join(root, 'src', 'backup.js');
    const original = 'const ORIGINAL = 1;\n';
    fs.writeFileSync(target, original);

    const challenge = { mutation: { type: 'file-modify', target_file: 'src/backup.js' } };
    const cap = captureMutationTarget(root, challenge);
    assert.strictEqual(cap.existed, true);

    // Simulate applyMutation corrupting the file.
    fs.writeFileSync(target, original + 'CORRUPTION APPENDED\n');
    assert.notStrictEqual(fs.readFileSync(target, 'utf8'), original);

    revertMutationTarget(root, cap);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), original,
      'a modified file must be restored to its exact pre-mutation content');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('null-mutation / missing target_file → capture is null, revert is a no-op', () => {
  const root = tmpRoot();
  try {
    assert.strictEqual(captureMutationTarget(root, { mutation: { type: 'null-mutation' } }), null);
    assert.strictEqual(captureMutationTarget(root, {}), null);
    // revert tolerates null capture without throwing
    assert.doesNotThrow(() => revertMutationTarget(root, null));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
