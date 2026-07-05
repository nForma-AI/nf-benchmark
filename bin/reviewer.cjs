#!/usr/bin/env node
'use strict';
// bin/reviewer.cjs — a production reviewer adapter for the Track B oracle scorer.
// Reads code on stdin, asks an LLM "semantic bug?", prints {"hasDefect": bool} — the
// exact contract oracle-track.cjs's --reviewer-cmd expects. Wire it as:
//
//   NF_REVIEWER_LLM='claude -p' node bin/oracle-track.cjs --reviewer-cmd 'node bin/reviewer.cjs'
//
// The LLM is whatever command $NF_REVIEWER_LLM names — any tool that reads a prompt on
// stdin and writes text to stdout (a Claude/Codex/etc. CLI, or a quorum-dispatch
// wrapper that fans out to nForma's slots and returns a majority verdict). This keeps
// nf-benchmark decoupled from any specific model or the nForma repo.
//
// Fail-open: with no LLM configured, or on any error, it reports {"hasDefect":false}
// (a non-detection) rather than crashing the scorer — that shows up as a miss (recall
// loss), never a false positive.

const fs = require('fs');
const { spawnSync } = require('child_process');

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } }

function buildPrompt(code) {
  return 'You are a strict code reviewer. Does the following JavaScript function contain a '
    + 'SEMANTIC BUG — wrong logic such as an off-by-one, inverted condition, wrong '
    + 'operator, wrong return value, missing guard, or and/or confusion? Ignore style, '
    + 'naming, and performance; judge only correctness.\n'
    + 'Answer with ONLY a JSON object on the final line: {"hasDefect": true} if it is '
    + 'logically wrong, {"hasDefect": false} if it is correct.\n\n'
    + code + '\n';
}

// Parse the LLM's answer leniently: explicit JSON wins; else fall back to yes/no cues.
function parseVerdict(out) {
  const m = out.match(/"hasDefect"\s*:\s*(true|false)/i);
  if (m) return m[1].toLowerCase() === 'true';
  const saysBug = /\b(has a (?:semantic )?bug|is (?:buggy|incorrect|wrong)|defect(?:ive)?)\b/i.test(out);
  const saysClean = /\b(no (?:semantic )?bug|no defect|is correct|logically correct|looks correct)\b/i.test(out);
  return saysBug && !saysClean;
}

function review(code, llmCmd) {
  if (!llmCmd) return { hasDefect: false, error: 'no llm configured (set $NF_REVIEWER_LLM)' };
  const r = spawnSync('/bin/sh', ['-c', llmCmd], { input: buildPrompt(code), encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error) return { hasDefect: false, error: 'llm spawn failed: ' + r.error.message };
  return { hasDefect: parseVerdict(r.stdout || '') };
}

if (require.main === module) {
  const verdict = review(readStdin(), process.env.NF_REVIEWER_LLM);
  if (verdict.error) process.stderr.write('[reviewer] ' + verdict.error + '\n');
  process.stdout.write(JSON.stringify({ hasDefect: verdict.hasDefect }) + '\n');
}

module.exports = { buildPrompt: buildPrompt, parseVerdict: parseVerdict, review: review };
