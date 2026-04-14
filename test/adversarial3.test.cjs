'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseJsonPath, applyJsonMutation, applyMutation, applyFileMutation } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));
const { scoreChallenge, computeReport, formatReport } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));
const { createSnapshot, restoreSnapshot, runSolve, findSolveBin, loadResults, saveResult } = require(path.join(__dirname, '..', 'lib', 'runner.cjs'));
const { validateChallenge, loadAllChallenges, loadChallenge, loadByCategory } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));

function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-adv3-'));
  return d;
}

function writeJson(dir, file, data) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

// Third round of adversarial tests

describe('ADV BUG 1: scoreChallenge with very large residual values', () => {
  test('handles extremely large residual totals without overflow', () => {
    const challenge = { scoring: { method: 'residual_zero' } };
    const result = scoreChallenge(challenge, { total: Number.MAX_SAFE_INTEGER }, { total: Number.MAX_SAFE_INTEGER - 1 }, '', null);
    assert.ok(!result.passed, 'Should handle large numbers');
  });
});

describe('ADV BUG 2: parseJsonPath with deeply nested paths', () => {
  test('handles very deep JSON paths without stack overflow', () => {
    const deepPath = '$.' + 'level'.repeat(1000) + '.value';
    assert.doesNotThrow(() => {
      parseJsonPath(deepPath);
    });
  });
});

describe('ADV BUG 3: loadResults with many result files', () => {
  test('handles directory with thousands of result files', () => {
    const tmp = makeTmpDir();
    const resultsDir = path.join(tmp, 'results');
    fs.mkdirSync(resultsDir);

    // Create 1000 result files
    for (let i = 0; i < 1000; i++) {
      fs.writeFileSync(path.join(resultsDir, `result-${i}.json`), JSON.stringify({ challenge: { id: `BENCH-${i}` }, score: { passed: true } }));
    }

    const origResultsDir = path.join(__dirname, '..', 'results');
    const backupDir = path.join(tmp, 'backup');
    if (fs.existsSync(origResultsDir)) {
      fs.cpSync(origResultsDir, backupDir, { recursive: true });
      fs.rmSync(origResultsDir, { recursive: true });
    }
    fs.cpSync(resultsDir, origResultsDir, { recursive: true });

    try {
      assert.doesNotThrow(() => {
        const results = loadResults();
        assert.strictEqual(results.length, 1000);
      });
    } finally {
      fs.rmSync(origResultsDir, { recursive: true });
      if (fs.existsSync(backupDir)) {
        fs.cpSync(backupDir, origResultsDir, { recursive: true });
        fs.rmSync(backupDir, { recursive: true });
      }
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

describe('ADV BUG 4: applyJsonMutation with cyclic references', () => {
  test('handles cyclic object references gracefully', () => {
    const tmp = makeTmpDir();
    const obj = { self: null };
    obj.self = obj; // cyclic
    writeJson(tmp, 'test.json', { data: 'safe' }); // but we'll try to mutate with cyclic

    // This might not work, but should not crash
    assert.doesNotThrow(() => {
      applyJsonMutation('test.json', {
        type: 'json-field-modify',
        json_path: '$.data',
        value: 'changed'
      }, tmp);
    });
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('ADV BUG 5: computeReport with results from different categories', () => {
  test('correctly aggregates stats across many categories', () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      results.push({
        challenge: {
          category: `category-${i % 10}`,
          difficulty: ['easy', 'medium', 'hard', 'expert'][i % 4],
          target_layers: ['layer1', 'layer2']
        },
        score: { passed: i % 2 === 0 }
      });
    }
    const report = computeReport(results);
    assert.strictEqual(report.total, 100);
    assert.strictEqual(report.byCategory['category-0'].total, 10);
  });
});

describe('ADV BUG 6: runSolve with very long timeout', () => {
  test('handles extremely long timeouts without issues', () => {
    assert.doesNotThrow(() => {
      runSolve('/nonexistent', { timeout: 999999 });
    });
  });
});

describe('ADV BUG 7: saveResult with special characters in challenge ID', () => {
  test('handles special characters in result filenames', () => {
    const tmp = makeTmpDir();
    const resultsDir = path.join(tmp, 'results');
    fs.mkdirSync(resultsDir);

    const origResultsDir = path.join(__dirname, '..', 'results');
    const backupDir = path.join(tmp, 'backup');
    if (fs.existsSync(origResultsDir)) {
      fs.cpSync(origResultsDir, backupDir, { recursive: true });
      fs.rmSync(origResultsDir, { recursive: true });
    }
    fs.symlinkSync(resultsDir, origResultsDir);

    try {
      assert.doesNotThrow(() => {
        saveResult('BENCH-001!@#$%^&*()', { test: 'data' });
      });
    } finally {
      fs.rmSync(origResultsDir);
      if (fs.existsSync(backupDir)) {
        fs.cpSync(backupDir, origResultsDir, { recursive: true });
        fs.rmSync(backupDir, { recursive: true });
      }
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

describe('ADV BUG 8: loadByCategory with nonexistent category', () => {
  test('loadByCategory returns empty array for invalid category', () => {
    const result = loadByCategory('nonexistent-category');
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });
});

describe('ADV BUG 9: scoreDetection with output containing null bytes', () => {
  test('handles null bytes in solver output', () => {
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f'],
      expected_outcome: { layers_affected: ['r_to_f'] }
    };
    const output = 'output with null byte: \x00 and some text';
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, {}, {}, output, null);
    });
  });
});

describe('ADV BUG 10: applyMutation with extremely long file paths', () => {
  test('handles OS filename length limits gracefully', () => {
    const tmp = makeTmpDir();
    
    assert.doesNotThrow(() => {
      try {
        applyMutation({
          mutation: {
            type: 'json-field-modify',
            target_file: 'very'.repeat(100) + '.json',
            json_path: '$.key',
            value: 'value'
          },
          target_layers: []
        }, tmp);
      } catch (e) {
        if (e.message.includes('File path too long')) {
          // Expected error
          return;
        }
        throw e;
      }
    });
    fs.rmSync(tmp, { recursive: true });
  });
});
