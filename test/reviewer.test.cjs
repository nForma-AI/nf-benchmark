'use strict';

// Tests for the Track B reviewer adapter (bin/reviewer.cjs). The LLM is stubbed via a
// tiny shell command so the prompt-build / verdict-parse / fail-open contract is
// verified deterministically.

const { test } = require('node:test');
const assert = require('node:assert');
const { buildPrompt, parseVerdict, review } = require('../bin/reviewer.cjs');

test('buildPrompt embeds the code and asks for the JSON contract', () => {
  const p = buildPrompt('function f(){ return 1; }');
  assert.match(p, /function f\(\)\{ return 1; \}/);
  assert.match(p, /"hasDefect"/);
  assert.match(p, /SEMANTIC BUG/);
});

test('parseVerdict prefers explicit JSON', () => {
  assert.strictEqual(parseVerdict('sure, here: {"hasDefect": true}'), true);
  assert.strictEqual(parseVerdict('{"hasDefect":false}'), false);
});

test('parseVerdict falls back to yes/no prose when no JSON', () => {
  assert.strictEqual(parseVerdict('This function has a semantic bug — off by one.'), true);
  assert.strictEqual(parseVerdict('The logic is correct; no defect here.'), false);
  assert.strictEqual(parseVerdict('hmm, unclear'), false, 'ambiguous → no defect (fail-open)');
});

test('review shells out to $NF_REVIEWER_LLM and returns its verdict', () => {
  // stub LLM: echoes a canned JSON verdict regardless of the prompt on stdin
  const r = review('function f(){ return 1; }', "cat >/dev/null; echo '{\"hasDefect\": true}'");
  assert.strictEqual(r.hasDefect, true);
});

test('review fails open (no defect) when no LLM is configured', () => {
  const r = review('function f(){}', null);
  assert.strictEqual(r.hasDefect, false);
  assert.match(r.error, /no llm/);
});
