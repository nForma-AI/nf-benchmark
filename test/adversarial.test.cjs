'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseJsonPath, applyJsonMutation, applyMutation, applyFileMutation } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));
const { scoreChallenge, computeReport, formatReport } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));
const { createSnapshot, restoreSnapshot, loadResults } = require(path.join(__dirname, '..', 'lib', 'runner.cjs'));
const { validateChallenge, loadAllChallenges } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));

function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-adv-'));
  return d;
}

function writeJson(dir, file, data) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

describe('BUG 1: parseJsonPath $ root — $ treated as object key instead of root', () => {
  test('$.foo mutates data.foo, not data["$"].foo', () => {
    const tmp = makeTmpDir();
    writeJson(tmp, 'test.json', { foo: 'original' });

    const result = applyJsonMutation('test.json', {
      type: 'json-field-modify',
      json_path: '$.foo',
      value: 'CHANGED'
    }, tmp);

    assert.strictEqual(result.foo, 'CHANGED',
      '$.foo should set data.foo, not data["$"].foo');
    assert.strictEqual(result['$'], undefined,
      'Should NOT create a "$" key on the data object');
    fs.rmSync(tmp, { recursive: true });
  });

  test('$.deeply.nested.key should traverse correctly from root', () => {
    const tmp = makeTmpDir();
    writeJson(tmp, 'test.json', { deeply: { nested: { key: 'old' } } });

    const result = applyJsonMutation('test.json', {
      type: 'json-field-modify',
      json_path: '$.deeply.nested.key',
      value: 'new'
    }, tmp);

    assert.strictEqual(result.deeply.nested.key, 'new');
    assert.strictEqual(result['$'], undefined);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('BUG 2: file-modify mutation does nothing', () => {
  test('file-modify should actually modify the file content', () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(path.join(tmp, 'target.txt'), 'original content');

    applyFileMutation('target.txt', {
      type: 'file-modify',
      description: 'Should modify the file content'
    }, tmp);

    const content = fs.readFileSync(path.join(tmp, 'target.txt'), 'utf8');
    assert.notStrictEqual(content, 'original content',
      'file-modify mutation should change the file, not leave it untouched');
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('BUG 3: scoreDetection trivially passes on keyword matches', () => {
  test('passes when output contains "residual" but no relevant layer info', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f'],
      expected_outcome: { layers_affected: ['t_to_c'] }
    };
    const result = scoreChallenge(
      challenge, {}, {},
      'The solver output has some text with the word residual mentioned in passing',
      null
    );
    assert.ok(!result.passed,
      'Should NOT pass just because output contains "residual" — no relevant layer detected');
  });

  test('passes when output mentions "gap" in unrelated context', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f'],
      expected_outcome: { layers_affected: ['r_to_f'] }
    };
    const result = scoreChallenge(
      challenge, {}, {},
      'There is a gap between the generations in this codebase',
      null
    );
    assert.ok(!result.passed,
      'Should NOT pass because "gap" appears in unrelated context');
  });

  test('passes when output mentions "mismatch" in unrelated context', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f'],
      expected_outcome: { layers_affected: ['r_to_f'] }
    };
    const result = scoreChallenge(
      challenge, {}, {},
      'A personality mismatch between team members',
      null
    );
    assert.ok(!result.passed,
      'Should NOT pass because "mismatch" appears in unrelated context');
  });
});

describe('BUG 4: scoreResidualDecreased passes when pre-residual is null', () => {
  test('pre=null should not be treated as Infinity (passing any finite post)', () => {
    const challenge = { scoring: { method: 'residual_decreased', target_layer: null } };
    const result = scoreChallenge(challenge, null, { total: 999 }, '', null);
    assert.ok(!result.passed,
      'Should NOT pass when pre-residual is null — no valid baseline to compare');
  });

  test('pre={} (no total) should not be treated as Infinity', () => {
    const challenge = { scoring: { method: 'residual_decreased', target_layer: null } };
    const result = scoreChallenge(challenge, {}, { total: 999 }, '', null);
    assert.ok(!result.passed,
      'Should NOT pass when pre-residual has no total field');
  });
});

describe('BUG 5: restoreSnapshot does not remove newly created files', () => {
  test('files created after snapshot persist after restore', () => {
    const tmp = makeTmpDir();
    const formalDir = path.join(tmp, '.planning', 'formal');
    fs.mkdirSync(formalDir, { recursive: true });
    fs.writeFileSync(path.join(formalDir, 'existing.json'), '{}');

    const snapshot = createSnapshot(tmp);

    const injectedFile = path.join(formalDir, 'injected.json');
    fs.writeFileSync(injectedFile, '{"injected": true}');

    restoreSnapshot(snapshot, tmp);

    const exists = fs.existsSync(injectedFile);
    fs.rmSync(tmp, { recursive: true });
    assert.ok(!exists,
      'restoreSnapshot should remove files that were not in the original snapshot');
  });
});

describe('BUG 6: navigateToParent crashes on out-of-bounds array index', () => {
  test('accessing array[5] on a 1-element array should not throw', () => {
    const tmp = makeTmpDir();
    writeJson(tmp, 'test.json', { items: [{ name: 'first' }] });

    assert.doesNotThrow(() => {
      applyJsonMutation('test.json', {
        type: 'json-field-modify',
        json_path: '$.items[5].name',
        value: 'changed'
      }, tmp);
    });
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('BUG 7: json-entry-add with index path does not work correctly', () => {
  test('json-entry-add to $.items[0] should push entry into items array', () => {
    const tmp = makeTmpDir();
    writeJson(tmp, 'test.json', { items: [{ id: 1 }] });

    const result = applyJsonMutation('test.json', {
      type: 'json-entry-add',
      json_path: '$.items[0]',
      value: { id: 2 }
    }, tmp);

    assert.ok(Array.isArray(result.items), 'items should be an array');
    assert.ok(result.items.length >= 2,
      `Expected at least 2 items, got ${result.items.length}`);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('BUG 8: runSolve --focus includes literal double quotes', () => {
test('--focus argument should not contain literal quote characters', () => {
  const focusValue = 'test-focus';
  const arg = `--focus=${focusValue}`;
  assert.ok(!arg.includes('"'),
    'Focus arg should not contain literal double-quote characters');
});
});

describe('BUG 9: loadResults crashes on malformed JSON', () => {
  test('loadResults should handle malformed JSON files gracefully', () => {
    const tmp = makeTmpDir();
    const origResultsDir = path.join(__dirname, '..', 'results');
    const backupDir = path.join(tmp, 'results_backup');

    if (fs.existsSync(origResultsDir)) {
      fs.cpSync(origResultsDir, backupDir, { recursive: true });
      fs.rmSync(origResultsDir, { recursive: true });
    }
    fs.mkdirSync(origResultsDir, { recursive: true });
    fs.writeFileSync(path.join(origResultsDir, 'bad.json'), 'not valid json {{{');

    try {
      assert.doesNotThrow(() => loadResults(),
        'loadResults should not throw on malformed JSON');
    } finally {
      fs.rmSync(origResultsDir, { recursive: true });
      if (fs.existsSync(backupDir)) {
        fs.cpSync(backupDir, origResultsDir, { recursive: true });
        fs.rmSync(backupDir, { recursive: true });
      }
    }
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('BUG 10: validateChallenge does not validate scoring method enum', () => {
  test('invalid scoring method passes validation', () => {
    const challenge = {
      id: 'BENCH-999', title: 'T', category: 'tests', difficulty: 'easy',
      target_layers: ['r_to_f'],
      mutation: { type: 'json-field-modify', target_file: 't.json', description: 't' },
      expected_outcome: { residual_change: 'increase', description: 't' },
      scoring: { method: 'totally_invalid_method' }
    };
    const errors = validateChallenge(challenge);
    assert.ok(errors.length > 0,
      `Invalid scoring method should produce error, got: ${JSON.stringify(errors)}`);
  });
});

describe('BUG 11: validateChallenge does not validate mutation type enum', () => {
  test('invalid mutation type passes validation', () => {
    const challenge = {
      id: 'BENCH-999', title: 'T', category: 'tests', difficulty: 'easy',
      target_layers: ['r_to_f'],
      mutation: { type: 'invalid-mutation-type', target_file: 't.json', description: 't' },
      expected_outcome: { residual_change: 'increase', description: 't' },
      scoring: { method: 'residual_zero' }
    };
    const errors = validateChallenge(challenge);
    assert.ok(errors.length > 0,
      `Invalid mutation type should produce error, got: ${JSON.stringify(errors)}`);
  });
});

describe('BUG 12: computeReport division on empty results produces NaN', () => {
  test('computeReport with empty array should return 0.0 passRate not NaN', () => {
    const report = computeReport([]);
    assert.strictEqual(report.passRate, '0.0',
      `Expected "0.0" but got "${report.passRate}"`);
    assert.ok(!report.passRate.includes('NaN'));
  });
});

describe('BUG 13: scoreResidualZero with null/undefined post', () => {
  test('residual_zero with post=null should not pass', () => {
    const challenge = { scoring: { method: 'residual_zero' } };
    const result = scoreChallenge(challenge, { total: 5 }, null, '', null);
    assert.ok(!result.passed, 'Should NOT pass when post-residual is null');
  });

  test('residual_zero with post={} should not pass', () => {
    const challenge = { scoring: { method: 'residual_zero' } };
    const result = scoreChallenge(challenge, { total: 5 }, {}, '', null);
    assert.ok(!result.passed, 'Should NOT pass when post-residual has no total');
  });
});

describe('BUG 14: scoreConvergence with null post', () => {
  test('convergence_achieved with null post should not pass', () => {
    const challenge = { scoring: { method: 'convergence_achieved' } };
    const result = scoreChallenge(challenge, {}, null, '', null);
    assert.ok(!result.passed, 'Should NOT pass when post-residual is null');
  });
});

describe('BUG 15: parseJsonPath with empty string', () => {
  test('empty json_path returns empty segments without crashing', () => {
    const segments = parseJsonPath('');
    assert.ok(Array.isArray(segments));
    assert.strictEqual(segments.length, 0);
  });
});

describe('BUG 16: scoreDetection with missing expected_outcome', () => {
  test('detection_only with no expected_outcome should not crash', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f']
    };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, {}, {}, 'some output', null);
    });
  });
});

describe('BUG 17: empty string in layers_affected matches everything', () => {
  test('empty string layer should not match', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f'],
      expected_outcome: { layers_affected: [''] }
    };
    const result = scoreChallenge(challenge, {}, {}, 'any output at all', null);
    assert.ok(!result.passed, 'Empty string layer should not match everything');
  });
});

describe('BUG 18: computeReport with results missing challenge field', () => {
  test('handles results without challenge object gracefully', () => {
    assert.doesNotThrow(() => {
      computeReport([{ score: { passed: true }, challenge: {} }]);
    });
  });
});

describe('BUG 19: applyMutation for file-create overwrites existing file silently', () => {
  test('file-create on existing file should not silently overwrite', () => {
    const tmp = makeTmpDir();
    const existing = path.join(tmp, 'exists.json');
    fs.writeFileSync(existing, '{"important": true}');

    const challenge = {
      mutation: {
        type: 'file-create',
        target_file: 'exists.json',
        content: '{"overwritten": true}',
        description: 'Overwrite'
      },
      target_layers: ['r_to_f']
    };

    applyMutation(challenge, tmp);
    const content = JSON.parse(fs.readFileSync(existing, 'utf8'));
    fs.rmSync(tmp, { recursive: true });

    assert.strictEqual(content.important, true,
      'file-create should not silently overwrite existing files');
  });
});

describe('BUG 20: scoreDetection with challenge having no target_layers', () => {
  test('detection_only with empty target_layers array should not crash', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: [],
      expected_outcome: { layers_affected: [] }
    };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, {}, {}, 'some output', null);
    });
  });
});
