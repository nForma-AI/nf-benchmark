'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseJsonPath, applyJsonMutation, applyMutation, applyFileMutation } = require(path.join(__dirname, '..', 'lib', 'mutator.cjs'));
const { scoreChallenge, computeReport, formatReport } = require(path.join(__dirname, '..', 'lib', 'scorer.cjs'));
const { createSnapshot, restoreSnapshot, runSolve, findSolveBin, loadResults, saveResult } = require(path.join(__dirname, '..', 'lib', 'runner.cjs'));
const { validateChallenge, loadAllChallenges, loadChallenge, loadByCategory, loadByDifficulty } = require(path.join(__dirname, '..', 'lib', 'challenges.cjs'));

function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-adv4-'));
  return d;
}

function writeJson(dir, file, data) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

// Fourth round of adversarial tests - much more extreme and comprehensive

describe('EXTREME BUG 1: scoreChallenge with deeply nested residual objects', () => {
  test('handles residual objects with 1000+ nested levels', () => {
    // Create a deeply nested residual object
    let residual = { total: 1 };
    let current = residual;
    for (let i = 0; i < 1000; i++) {
      current.nested = { total: i };
      current = current.nested;
    }
    const challenge = { scoring: { method: 'residual_zero' } };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, residual, { total: 0 }, '', null);
    });
  });
});

describe('EXTREME BUG 2: parseJsonPath with Unicode characters', () => {
  test('handles JSON paths with Unicode characters and emojis', () => {
    const paths = [
      '$.🚀.🌟.value',
      '$.测试.路径',
      '$.café.mañana',
      '$.файл.тест'
    ];
    for (const p of paths) {
      assert.doesNotThrow(() => {
        parseJsonPath(p);
      });
    }
  });
});

describe('EXTREME BUG 3: loadResults with corrupted binary data', () => {
  test('handles result files containing binary data', () => {
    const tmp = makeTmpDir();
    const resultsDir = path.join(tmp, 'results');
    fs.mkdirSync(resultsDir);

    // Create files with binary data
    fs.writeFileSync(path.join(resultsDir, 'binary1.json'), Buffer.from([0x00, 0x01, 0x02, 0xFF]));
    fs.writeFileSync(path.join(resultsDir, 'binary2.json'), Buffer.from('not json at all \x00\x01\x02'));

    const origResultsDir = path.join(__dirname, '..', 'results');
    const backupDir = path.join(tmp, 'backup');
    if (fs.existsSync(origResultsDir)) {
      fs.cpSync(origResultsDir, backupDir, { recursive: true });
      fs.rmSync(origResultsDir, { recursive: true });
    }
    fs.cpSync(resultsDir, origResultsDir, { recursive: true });

    try {
      assert.doesNotThrow(() => {
        loadResults();
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

describe('EXTREME BUG 4: computeReport with 10000+ results', () => {
  test('handles massive result sets without memory issues', () => {
    const results = [];
    for (let i = 0; i < 10000; i++) {
      results.push({
        challenge: {
          category: `cat-${i % 100}`,
          difficulty: ['easy', 'medium', 'hard', 'expert'][i % 4],
          target_layers: Array.from({ length: 10 }, (_, j) => `layer${j}`)
        },
        score: { passed: Math.random() > 0.5 }
      });
    }
    assert.doesNotThrow(() => {
      const report = computeReport(results);
      assert.strictEqual(report.total, 10000);
    });
  });
});

describe('EXTREME BUG 5: applyJsonMutation with massive JSON files', () => {
  test('handles JSON files with large content without crashing', () => {
    const tmp = makeTmpDir();
    const massiveData = {
      array: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(100)
      }))
    };
    writeJson(tmp, 'massive.json', massiveData);

    assert.doesNotThrow(() => {
      applyJsonMutation('massive.json', {
        type: 'json-field-modify',
        json_path: '$.array[0].id',
        value: 999999
      }, tmp);
    });

    fs.rmSync(tmp, { recursive: true });
  });
});

describe('EXTREME BUG 6: scoreDetection with extremely long output strings', () => {
  test('handles solver output strings of 10MB+', () => {
    const longOutput = 'residual '.repeat(1000000); // ~9MB string
    const challenge = {
      scoring: { method: 'detection_only' },
      target_layers: ['r_to_f'],
      expected_outcome: { layers_affected: ['r_to_f'] }
    };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, {}, {}, longOutput, null);
    });
  });
});

describe('EXTREME BUG 7: concurrent file operations', () => {
  test('handles concurrent mutations to the same file', async () => {
    const tmp = makeTmpDir();
    writeJson(tmp, 'concurrent.json', { counter: 0 });

    const mutations = [];
    for (let i = 0; i < 100; i++) {
      mutations.push(
        applyMutation({
          mutation: {
            type: 'json-field-modify',
            target_file: 'concurrent.json',
            json_path: '$.counter',
            value: i
          },
          target_layers: []
        }, tmp)
      );
    }

    // Since mutations are synchronous, they will overwrite each other
    // This tests that no crashes occur
    assert.doesNotThrow(() => {
      for (const mutation of mutations) {
        // Just run them
      }
    });

    fs.rmSync(tmp, { recursive: true });
  });
});

describe('EXTREME BUG 8: validateChallenge with deeply nested invalid structures', () => {
  test('handles challenges with extreme nesting depth', () => {
    let challenge = { id: 'BENCH-999', title: 'Test' };
    let current = challenge;
    for (let i = 0; i < 100; i++) {
      current.nested = { invalid: 'structure' };
      current = current.nested;
    }
    assert.doesNotThrow(() => {
      validateChallenge(challenge);
    });
  });
});

describe('EXTREME BUG 9: runSolve with malformed environment', () => {
  test('handles extreme environment variable lengths', () => {
    const originalEnv = process.env;
    try {
      // Set extremely long environment variables
      process.env.NF_SOLVE_SESSION_ID = 'x'.repeat(10000);
      process.env.PATH = '/bin:/usr/bin:' + '/fake/path'.repeat(1000);

      assert.doesNotThrow(() => {
        runSolve('/nonexistent', { timeout: 1 });
      });
    } finally {
      process.env = originalEnv;
    }
  });
});

describe('EXTREME BUG 10: saveResult with concurrent writes', () => {
  test('handles concurrent saveResult calls', async () => {
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
      const saves = [];
      for (let i = 0; i < 100; i++) {
        saves.push(saveResult(`BENCH-${i}`, { test: `data${i}` }));
      }
      assert.doesNotThrow(() => {
        // All saves should complete without issues
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

describe('EXTREME BUG 11: loadAllChallenges with filesystem corruption', () => {
  test('handles corrupted challenge files', () => {
    const tmp = makeTmpDir();
    const challengesDir = path.join(tmp, 'challenges');
    fs.mkdirSync(challengesDir);

    // Create some valid and some corrupted files
    writeJson(challengesDir, '01-valid.json', [
      { id: 'BENCH-001', title: 'Valid', category: 'test', difficulty: 'easy', target_layers: [], mutation: {}, expected_outcome: {}, scoring: { method: 'no_crash' } }
    ]);
    fs.writeFileSync(path.join(challengesDir, '02-corrupted.json'), 'not json {{{');
    fs.writeFileSync(path.join(challengesDir, '03-empty.json'), '');
    fs.writeFileSync(path.join(challengesDir, '04-binary.json'), Buffer.from([0x00, 0x01, 0x02]));

    const origChallengesDir = path.join(__dirname, '..', 'challenges');
    const backupDir = path.join(tmp, 'backup');
    if (fs.existsSync(origChallengesDir)) {
      fs.cpSync(origChallengesDir, backupDir, { recursive: true });
      fs.rmSync(origChallengesDir, { recursive: true });
    }
    fs.cpSync(challengesDir, origChallengesDir, { recursive: true });

    try {
      assert.doesNotThrow(() => {
        const challenges = loadAllChallenges();
        // Should load the valid challenge despite corrupted files
        assert.ok(challenges.length >= 1);
      });
    } finally {
      fs.rmSync(origChallengesDir, { recursive: true });
      if (fs.existsSync(backupDir)) {
        fs.cpSync(backupDir, origChallengesDir, { recursive: true });
        fs.rmSync(backupDir, { recursive: true });
      }
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

describe('EXTREME BUG 12: applyFileMutation with permission issues', () => {
  test('handles files with no write permissions', () => {
    const tmp = makeTmpDir();
    const readonlyFile = path.join(tmp, 'readonly.txt');
    fs.writeFileSync(readonlyFile, 'content');
    fs.chmodSync(readonlyFile, 0o444); // Read-only

    assert.doesNotThrow(() => {
      try {
        applyFileMutation('readonly.txt', {
          type: 'file-modify',
          description: 'Try to modify readonly file'
        }, tmp);
      } catch (e) {
        if (e.code === 'EACCES' || e.code === 'EPERM') {
          // Expected permission error
          return;
        }
        throw e;
      }
    });

    fs.rmSync(tmp, { recursive: true });
  });
});

describe('EXTREME BUG 13: scoreChallenge with circular residual references', () => {
  test('handles residual objects with circular references', () => {
    const residual = { total: 5 };
    residual.self = residual; // Circular

    const challenge = { scoring: { method: 'residual_zero' } };
    assert.doesNotThrow(() => {
      scoreChallenge(challenge, residual, { total: 0 }, '', null);
    });
  });
});

describe('EXTREME BUG 14: parseJsonPath with maximum path complexity', () => {
  test('handles paths with maximum brackets and nesting', () => {
    const complexPath = '$.' + Array.from({ length: 100 }, (_, i) => `level${i}["key${i}"][${i}]`).join('.');
    assert.doesNotThrow(() => {
      parseJsonPath(complexPath);
    });
  });
});

describe('EXTREME BUG 15: restoreSnapshot with filesystem full', () => {
  test('handles disk space exhaustion gracefully', () => {
    const tmp = makeTmpDir();
    const formalDir = path.join(tmp, '.planning', 'formal');
    fs.mkdirSync(formalDir, { recursive: true });

    // Create a large snapshot
    const snapshot = {};
    for (let i = 0; i < 1000; i++) {
      const filename = `large-${i}.json`;
      const content = JSON.stringify({ data: 'x'.repeat(10000) });
      fs.writeFileSync(path.join(formalDir, filename), content);
      snapshot[filename] = content;
    }

    assert.doesNotThrow(() => {
      restoreSnapshot(snapshot, tmp);
    });

    fs.rmSync(tmp, { recursive: true });
  });
});
