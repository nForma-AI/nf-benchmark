'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseJsonPath, applyJsonMutation, applyMutation, applyFileMutation } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));
const { scoreChallenge, computeReport, formatReport } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));
const { createSnapshot, restoreSnapshot, runSolve, findSolveBin, loadResults } = require(path.join(__dirname, '..', 'lib', 'runner.cjs'));
const { validateChallenge, loadAllChallenges, loadChallenge } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));

function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-adv2-'));
  return d;
}

function writeJson(dir, file, data) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

// New adversarial tests to find additional bugs

describe('NEW BUG 1: scoreDetection with null challenge.target_layers', () => {
  test('detection_only with null target_layers should not crash', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: null,
      expected_outcome: { layers_affected: [] }
    };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, {}, {}, 'some output', null);
    });
  });
});

describe('NEW BUG 2: applyJsonMutation with invalid json_path', () => {
  test('invalid json_path should not crash', () => {
    const tmp = makeTmpDir();
    writeJson(tmp, 'test.json', { data: 'value' });

    assert.doesNotThrow(() => {
      applyJsonMutation('test.json', {
        type: 'json-field-modify',
        json_path: 'invalid[path',
        value: 'new'
      }, tmp);
    });
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('NEW BUG 3: computeReport with negative scores', () => {
  test('computeReport handles negative scores correctly', () => {
    const results = [
      { challenge: { category: 'test', difficulty: 'easy', target_layers: ['a'] }, score: { passed: true } },
      { challenge: { category: 'test', difficulty: 'easy', target_layers: ['a'] }, score: { passed: false } }
    ];
    assert.doesNotThrow(() => {
      computeReport(results);
    });
  });
});

describe('NEW BUG 4: loadResults with empty result files', () => {
  test('loadResults handles empty JSON files', () => {
    const tmp = makeTmpDir();
    const origResultsDir = path.join(__dirname, '..', 'results');
    const backupDir = path.join(tmp, 'results_backup');

    if (fs.existsSync(origResultsDir)) {
      fs.cpSync(origResultsDir, backupDir, { recursive: true });
      fs.rmSync(origResultsDir, { recursive: true });
    }
    fs.mkdirSync(origResultsDir, { recursive: true });
    fs.writeFileSync(path.join(origResultsDir, 'empty.json'), '');

    try {
      assert.doesNotThrow(() => loadResults());
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

describe('NEW BUG 5: validateChallenge with null challenge', () => {
  test('validateChallenge with null input should not crash', () => {
    assert.doesNotThrow(() => {
      validateChallenge(null);
    });
  });
});

describe('NEW BUG 6: runSolve with invalid projectRoot', () => {
  test('runSolve with nonexistent projectRoot should handle gracefully', () => {
    assert.doesNotThrow(() => {
      runSolve('/nonexistent/path', { timeout: 1 });
    });
  });
});

describe('NEW BUG 7: parseJsonPath with malformed brackets', () => {
  test('parseJsonPath handles malformed brackets', () => {
    assert.doesNotThrow(() => {
      parseJsonPath('$.test[invalid]');
    });
  });
});

describe('NEW BUG 8: applyMutation with missing mutation.type', () => {
  test('applyMutation with incomplete mutation object throws proper error', () => {
    const tmp = makeTmpDir();
    try {
      applyMutation({ mutation: {}, target_layers: [] }, tmp);
      assert.fail('Should have thrown');
    } catch (e) {
      assert.strictEqual(e.message, 'Invalid mutation: missing target_file');
    }
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('NEW BUG 9: scoreChallenge with undefined method', () => {
  test('scoreChallenge with missing scoring method', () => {
    const challenge = { scoring: {} };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, {}, {}, '', null);
    });
  });
});

describe('NEW BUG 10: loadChallenge with invalid ID', () => {
  test('loadChallenge with nonexistent ID returns null', () => {
    const result = loadChallenge('INVALID-ID');
    assert.strictEqual(result, null);
  });
});
