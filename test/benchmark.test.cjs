const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { loadAllChallenges, validateAll, getCategories, getDifficulties } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));
const { parseJsonPath } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));
const { scoreChallenge } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));

describe('Challenge Loading', () => {
  test('loads all 230 challenges (minus any staged out of the runner)', () => {
    const all = loadAllChallenges();
    const staged = loadStagedChallenges().length;
    assert.strictEqual(
      all.length + staged, 230,
      `Expected 230 challenges total, got ${all.length} loaded + ${staged} staged`,
    );
  });

  test('all challenges have unique IDs', () => {
    const all = loadAllChallenges();
    const ids = all.map(c => c.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, 'Duplicate IDs found');
  });

  test('all IDs match BENCH-NNN pattern', () => {
    const all = loadAllChallenges();
    for (const c of all) {
      assert.match(c.id, /^BENCH-\d{3}$/, `Invalid ID format: ${c.id}`);
    }
  });

  // The ID space must stay complete: a challenge that silently vanishes is a
  // corpus regression. A challenge deliberately STAGED out of the runner
  // (.staged-challenges/, same convention as .staged-fixtures/) still holds its ID,
  // so the union of loaded + staged must cover 1..230 with no gaps and no reuse.
  test('IDs cover BENCH-001 through BENCH-230 (loaded + staged, no gaps)', () => {
    const num = c => parseInt(c.id.replace('BENCH-', ''), 10);
    const loaded = loadAllChallenges().map(num);
    const staged = loadStagedChallenges().map(num);
    const overlap = loaded.filter(n => staged.includes(n));
    assert.deepStrictEqual(overlap, [], `IDs are both loaded and staged: ${overlap.join(', ')}`);
    const seen = new Set([...loaded, ...staged]);
    for (let i = 1; i <= 230; i++) {
      assert.ok(
        seen.has(i),
        `Missing BENCH-${String(i).padStart(3, '0')} — not in challenges/ and not staged in .staged-challenges/`,
      );
    }
    assert.strictEqual(seen.size, 230, `expected 230 distinct IDs, saw ${seen.size}`);
  });
});

// Staged challenges live outside challenges/ so lib/challenges.cjs never loads them,
// but they keep their IDs reserved — see .staged-challenges/README.md.
function loadStagedChallenges() {
  const dir = path.join(__dirname, '..', '.staged-challenges');
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return []; }
  return files.flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

describe('Challenge Validation', () => {
  test('all challenges pass validation', () => {
    const results = validateAll();
    const invalid = results.filter(r => !r.valid);
    if (invalid.length > 0) {
      const details = invalid.map(r => `${r.id}: ${r.errors.join(', ')}`).join('; ');
      assert.fail(`${invalid.length} invalid challenges: ${details}`);
    }
  });

  test('all challenges have required fields', () => {
    const all = loadAllChallenges();
    const required = ['id', 'title', 'category', 'difficulty', 'description', 'target_layers', 'mutation', 'expected_outcome', 'scoring'];
    for (const c of all) {
      for (const field of required) {
        assert.ok(c[field] !== undefined, `${c.id} missing field: ${field}`);
      }
    }
  });

  test('all categories are valid', () => {
    const validCats = getCategories();
    const all = loadAllChallenges();
    for (const c of all) {
      assert.ok(validCats.includes(c.category), `${c.id} has invalid category: ${c.category}`);
    }
  });

  test('all difficulties are valid', () => {
    const validDiffs = getDifficulties();
    const all = loadAllChallenges();
    for (const c of all) {
      assert.ok(validDiffs.includes(c.difficulty), `${c.id} has invalid difficulty: ${c.difficulty}`);
    }
  });
});

describe('Challenge Coverage', () => {
  test('covers all 12 categories', () => {
    const cats = getCategories();
    assert.strictEqual(cats.length, 12, `Expected 12 categories, got ${cats.length}: ${cats.join(', ')}`);
  });

  test('covers all 4 difficulty levels', () => {
    const all = loadAllChallenges();
    const diffs = new Set(all.map(c => c.difficulty));
    assert.ok(diffs.has('easy'), 'Missing easy challenges');
    assert.ok(diffs.has('medium'), 'Missing medium challenges');
    assert.ok(diffs.has('hard'), 'Missing hard challenges');
    assert.ok(diffs.has('expert'), 'Missing expert challenges');
  });

  test('covers at least 15 of 19 layer transitions', () => {
    const all = loadAllChallenges();
    const layers = new Set();
    for (const c of all) {
      for (const l of c.target_layers) layers.add(l);
    }
    assert.ok(layers.size >= 15, `Expected >=15 layer transitions, got ${layers.size}: ${[...layers].join(', ')}`);
  });
});

describe('JSON Path Parser', () => {
  test('parses simple key path', () => {
    const segments = parseJsonPath('$.requirements');
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].value, 'requirements');
  });

  test('parses array index path', () => {
    const segments = parseJsonPath('$.requirements[0]');
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[1].type, 'index');
    assert.strictEqual(segments[1].value, 0);
  });

  test('parses nested path with string key', () => {
    const segments = parseJsonPath('$.models["key.with.dots"]');
    assert.ok(segments.length >= 1);
  });
});

describe('Scorer', () => {
  test('scores residual_zero correctly', () => {
    const challenge = { scoring: { method: 'residual_zero' } };
    const result = scoreChallenge(challenge, { total: 5 }, { total: 0 }, '', null);
    assert.ok(result.passed);
    assert.ok(result.reduction_score !== undefined, 'reduction_score must be present');
  });

  test('scores no_crash correctly', () => {
    const challenge = { scoring: { method: 'no_crash' } };
    const result = scoreChallenge(challenge, {}, {}, '', null);
    assert.ok(result.passed);
  });

  test('scores error case correctly', () => {
    const challenge = { scoring: { method: 'residual_zero' } };
    const result = scoreChallenge(challenge, {}, {}, '', new Error('boom'));
    assert.ok(!result.passed);
  });

  test('detection_only passes when target layer residual increased', () => {
    const challenge = {
      scoring: { method: 'detection_only', target_layer: 'r_to_f' },
      expected_outcome: { layers_affected: ['r_to_f'] },
      target_layers: ['r_to_f']
    };
    const pre = { total: 10, r_to_f: { residual: 2 } };
    const post = { total: 14, r_to_f: { residual: 6 } };
    const result = scoreChallenge(challenge, pre, post, '', null);
    assert.ok(result.passed, `Expected pass but got: ${result.reason}`);
    assert.strictEqual(result.details.method, 'residual_layer_increased');
  });

  test('detection_only fails when target layer residual unchanged', () => {
    const challenge = {
      scoring: { method: 'detection_only', target_layer: 'r_to_f' },
      expected_outcome: { layers_affected: ['r_to_f'] },
      target_layers: ['r_to_f']
    };
    const pre = { total: 10, r_to_f: { residual: 2 } };
    const post = { total: 10, r_to_f: { residual: 2 } };
    const result = scoreChallenge(challenge, pre, post, '', null);
    assert.ok(!result.passed, `Expected fail but got: ${result.reason}`);
    assert.strictEqual(result.details.method, 'residual_layer_increased');
  });

  test('detection_only uses LAYER_ALIASES for canonical key resolution', () => {
    const challenge = {
      scoring: { method: 'detection_only', target_layer: 'c_to_e' },
      expected_outcome: { layers_affected: ['c_to_e'] },
      target_layers: ['c_to_e']
    };
    // c_to_e aliases to git_heatmap
    const pre = { total: 5, git_heatmap: { residual: 1 } };
    const post = { total: 8, git_heatmap: { residual: 4 } };
    const result = scoreChallenge(challenge, pre, post, '', null);
    assert.ok(result.passed, `Expected pass via alias but got: ${result.reason}`);
  });

  test('reduction_score is positive when residual decreases', () => {
    const challenge = { scoring: { method: 'residual_decreased' } };
    const result = scoreChallenge(challenge, { total: 10 }, { total: 6 }, '', null);
    assert.ok(result.reduction_score > 0, `Expected positive reduction_score, got ${result.reduction_score}`);
    assert.ok(Math.abs(result.reduction_score - 0.4) < 0.001, `Expected 0.4, got ${result.reduction_score}`);
  });

  test('no_regression passes when totals are equal', () => {
    const challenge = { scoring: { method: 'no_regression' } };
    const result = scoreChallenge(challenge, { total: 10 }, { total: 10 }, '', null);
    assert.ok(result.passed, `Expected pass but got: ${result.reason}`);
  });

  test('no_regression passes when delta is exactly 1', () => {
    const challenge = { scoring: { method: 'no_regression' } };
    const result = scoreChallenge(challenge, { total: 10 }, { total: 11 }, '', null);
    assert.ok(result.passed, `Expected pass (delta=1 is allowed) but got: ${result.reason}`);
  });

  test('no_regression fails when delta exceeds 1', () => {
    const challenge = { scoring: { method: 'no_regression' } };
    const result = scoreChallenge(challenge, { total: 10 }, { total: 15 }, '', null);
    assert.ok(!result.passed, `Expected fail but got: ${result.reason}`);
    assert.strictEqual(result.details.delta, 5);
  });

  test('fix_and_verify passes when detection and fix both succeed', () => {
    const challenge = {
      scoring: { method: 'fix_and_verify', target_layer: 'r_to_f' },
      expected_outcome: { layers_affected: ['r_to_f'] },
      target_layers: ['r_to_f']
    };
    const pre = { total: 10, r_to_f: { residual: 2 } };
    const seeded = { total: 14, r_to_f: { residual: 6 } };
    const fix = { total: 10, r_to_f: { residual: 2 } };
    const result = scoreChallenge(challenge, pre, seeded, '', null, fix);
    assert.ok(result.passed, `Expected pass but got: ${result.reason}`);
    assert.strictEqual(result.score, 1);
  });

  test('fix_and_verify fails with score=0.5 when detected but not fixed', () => {
    const challenge = {
      scoring: { method: 'fix_and_verify', target_layer: 'r_to_f' },
      expected_outcome: { layers_affected: ['r_to_f'] },
      target_layers: ['r_to_f']
    };
    const pre = { total: 10, r_to_f: { residual: 2 } };
    const seeded = { total: 14, r_to_f: { residual: 6 } };
    const fix = { total: 14, r_to_f: { residual: 5 } }; // still higher than pre
    const result = scoreChallenge(challenge, pre, seeded, '', null, fix);
    assert.ok(!result.passed, `Expected fail but got: ${result.reason}`);
    assert.strictEqual(result.score, 0.5);
    assert.ok(result.reason.includes('not fixed'), `Expected 'not fixed' in reason: ${result.reason}`);
  });

  test('fix_and_verify fails with score=0 when detection fails', () => {
    const challenge = {
      scoring: { method: 'fix_and_verify', target_layer: 'r_to_f' },
      expected_outcome: { layers_affected: ['r_to_f'] },
      target_layers: ['r_to_f']
    };
    const pre = { total: 10, r_to_f: { residual: 2 } };
    const seeded = { total: 10, r_to_f: { residual: 2 } }; // not detected
    const fix = { total: 10, r_to_f: { residual: 2 } };
    const result = scoreChallenge(challenge, pre, seeded, '', null, fix);
    assert.ok(!result.passed, `Expected fail but got: ${result.reason}`);
    assert.strictEqual(result.score, 0);
    assert.ok(result.reason.includes('not detected') || result.reason.includes('Mutation not detected'), `Expected 'not detected' in reason: ${result.reason}`);
  });
});
