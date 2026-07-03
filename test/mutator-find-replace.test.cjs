'use strict';

// Unit tests for the file-modify find/replace op (in-place edits). Append-only
// mutation cannot express REPLACEMENT defects ("change A to B", "replace
// invariant with x=x") nor land a defect INSIDE a bounded region (a TLA module
// body ends with `====`; an appended line is dead code TLC never parses). The
// find/replace op fills that gap and MUST fail loudly on a drifted anchor so a
// mis-authored challenge can never silently no-op into a pass-through mutation.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyMutation } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-bench-fr-'));
}

test('find/replace performs an in-place edit', () => {
  const root = tmpRoot();
  try {
    const rel = 'model.tla';
    fs.writeFileSync(path.join(root, rel), 'stepCount \\in 0..MaxWorkflows\n====\n');
    const challenge = {
      mutation: {
        type: 'file-modify',
        target_file: rel,
        find: 'stepCount \\in 0..MaxWorkflows',
        replace: 'stepCount \\in Nat',
      },
    };
    applyMutation(challenge, root);
    const out = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(out.includes('stepCount \\in Nat'), 'anchor should be replaced');
    assert.ok(!out.includes('0..MaxWorkflows'), 'old bounded domain should be gone');
    assert.ok(out.includes('===='), 'the edit must stay INSIDE the module body');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('find with no replace deletes the anchor', () => {
  const root = tmpRoot();
  try {
    const rel = 'inv.tla';
    fs.writeFileSync(path.join(root, rel), 'GoodInvariant == x > 0\n');
    const challenge = {
      mutation: { type: 'file-modify', target_file: rel, find: 'GoodInvariant == x > 0' },
    };
    applyMutation(challenge, root);
    const out = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(!out.includes('GoodInvariant'), 'anchor deleted when replace omitted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('find with a missing anchor throws (never silently no-ops)', () => {
  const root = tmpRoot();
  try {
    const rel = 'model.tla';
    fs.writeFileSync(path.join(root, rel), 'stepCount \\in 0..MaxWorkflows\n');
    const challenge = {
      mutation: {
        type: 'file-modify',
        target_file: rel,
        find: 'THIS_ANCHOR_DOES_NOT_EXIST',
        replace: 'whatever',
      },
    };
    assert.throws(
      () => applyMutation(challenge, root),
      /find anchor not present/,
      'a drifted anchor must throw, not pass through unchanged'
    );
    // File must be untouched on throw.
    const out = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.strictEqual(out, 'stepCount \\in 0..MaxWorkflows\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('append path is unchanged when find is absent', () => {
  const root = tmpRoot();
  try {
    const rel = 'code.js';
    fs.writeFileSync(path.join(root, rel), 'const a = 1;\n');
    const challenge = {
      mutation: { type: 'file-modify', target_file: rel, append: '\nconst b = 2;\n' },
    };
    applyMutation(challenge, root);
    const out = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.strictEqual(out, 'const a = 1;\n\nconst b = 2;\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('find replaces every occurrence of the anchor', () => {
  const root = tmpRoot();
  try {
    const rel = 'multi.txt';
    fs.writeFileSync(path.join(root, rel), 'X and X and X\n');
    const challenge = {
      mutation: { type: 'file-modify', target_file: rel, find: 'X', replace: 'Y' },
    };
    applyMutation(challenge, root);
    const out = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.strictEqual(out, 'Y and Y and Y\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
