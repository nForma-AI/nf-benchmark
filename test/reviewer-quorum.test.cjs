'use strict';

// Tests for the quorum reviewer (bin/reviewer-quorum.cjs). Fleet members are stub shell
// commands so the majority vote / dead-voter handling is verified without live LLMs.

const { test } = require('node:test');
const assert = require('node:assert');
const { parseFleet, quorumReview } = require('../bin/reviewer-quorum.cjs');

// stub reviewers: each ignores stdin and echoes a fixed verdict.
const yes = "cat >/dev/null; echo '{\"hasDefect\":true}'";
const no = "cat >/dev/null; echo '{\"hasDefect\":false}'";
const dead = 'exit 7'; // errors → no output → must be excluded from the tally

test('parseFleet splits on newlines and commas, trims, drops blanks', () => {
  assert.deepStrictEqual(parseFleet('a\n b ,c,\n'), ['a', 'b', 'c']);
  assert.deepStrictEqual(parseFleet(''), []);
});

test('strict majority flags a defect', () => {
  const v = quorumReview('code', [yes, yes, no]);
  assert.strictEqual(v.hasDefect, true);
  assert.strictEqual(v.yes, 2);
  assert.strictEqual(v.live, 3);
});

test('a tie does NOT flag (favors precision)', () => {
  const v = quorumReview('code', [yes, no]);
  assert.strictEqual(v.hasDefect, false);
  assert.strictEqual(v.yes, 1);
  assert.strictEqual(v.live, 2);
});

test('dead reviewers are excluded from the denominator, not counted as "no"', () => {
  // 1 yes, 2 dead → live=1, yes=1 → majority → flags. If dead counted as "no" it wouldn't.
  const v = quorumReview('code', [yes, dead, dead]);
  assert.strictEqual(v.live, 1);
  assert.strictEqual(v.yes, 1);
  assert.strictEqual(v.hasDefect, true);
  assert.strictEqual(v.fleet_size, 3);
});

test('a fully-dead fleet fails open to no-defect (no false positive)', () => {
  const v = quorumReview('code', [dead, dead]);
  assert.strictEqual(v.live, 0);
  assert.strictEqual(v.hasDefect, false);
});
