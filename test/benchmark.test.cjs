const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { loadAllChallenges, validateAll, getCategories, getDifficulties } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));
const { parseJsonPath } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));
const { scoreChallenge } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));

describe('Challenge Loading', () => {
  test('loads all 205 challenges', () => {
    const all = loadAllChallenges();
    assert.strictEqual(all.length, 205, `Expected 205 challenges, got ${all.length}`);
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

  test('IDs are sequential BENCH-001 through BENCH-205', () => {
    const all = loadAllChallenges();
    const ids = all.map(c => parseInt(c.id.replace('BENCH-', ''), 10)).sort((a, b) => a - b);
    for (let i = 0; i < 205; i++) {
      assert.strictEqual(ids[i], i + 1, `Missing BENCH-${String(i + 1).padStart(3, '0')}`);
    }
  });
});

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
  test('covers all 10 categories', () => {
    const cats = getCategories();
    assert.strictEqual(cats.length, 10, `Expected 10 categories, got ${cats.length}: ${cats.join(', ')}`);
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
});
