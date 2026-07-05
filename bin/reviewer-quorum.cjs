#!/usr/bin/env node
'use strict';
// bin/reviewer-quorum.cjs — a QUORUM reviewer for the Track B oracle scorer.
//
// Where bin/reviewer.cjs asks ONE LLM, this fans the review out to a fleet of
// independent reviewers and takes a MAJORITY vote — nForma's actual differentiator:
// a diverse quorum (different model families) catches what any single reviewer misses,
// and disagreement is signal. Same `{"hasDefect":bool}` contract, so it drops straight
// into oracle-track.cjs's --reviewer-cmd.
//
// The fleet is the newline/comma-separated list in $NF_REVIEWER_FLEET — each entry a
// command that reads a prompt on stdin and writes text (a Claude/Codex/Gemini/Copilot
// CLI, or a per-slot nForma quorum-dispatch wrapper). Example:
//
//   NF_REVIEWER_FLEET='claude -p
//   codex exec
//   gemini -p' \
//     node bin/oracle-track.cjs --reviewer-cmd 'node bin/reviewer-quorum.cjs'
//
// Vote rule ($NF_REVIEWER_VOTE, default 'majority'):
//   majority — strict majority of LIVE reviewers (ties → no defect); favors precision.
//   any      — ANY live reviewer flags it; favors recall (a diverse fleet's union).
//   <0..1>   — flag if the flagged FRACTION of live reviewers >= this threshold.
// Empirically it matters: on the discriminating corpus a 3-model panel scored
// R=94.4% under 'majority' (a subtle bug 2/3 missed slipped through) but R=100% under
// 'any' (the one model that caught it was enough) — with precision still 100%. For bug
// detection, where a human triages false alarms, 'any' is usually the better rule.
// Dead/erroring reviewers are dropped from the denominator (never a silent "no", which
// would erode recall). Fails open to {"hasDefect":false} if the whole fleet is down.

const fs = require('fs');
const { spawnSync } = require('child_process');
const { buildPrompt, parseVerdict } = require('./reviewer.cjs');

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } }

function parseFleet(raw) {
  return String(raw || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

// Ask one reviewer. Returns true/false, or null if it could not vote (spawn/timeout/no
// output) — null is EXCLUDED from the tally rather than counted as a "no".
function askOne(code, llmCmd) {
  const r = spawnSync('/bin/sh', ['-c', llmCmd], { input: buildPrompt(code), encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status === null) return null;
  const out = r.stdout || '';
  if (!out.trim()) return null;
  return parseVerdict(out);
}

function decide(yes, live, rule) {
  if (live === 0) return false;
  if (rule === 'any') return yes >= 1;
  const f = parseFloat(rule);
  if (!Number.isNaN(f) && f > 0 && f <= 1) return yes / live >= f;
  return yes * 2 > live; // 'majority' (default): strict majority, ties don't flag
}

function quorumReview(code, fleet, rule) {
  const votes = fleet.map(cmd => askOne(code, cmd)).filter(v => v !== null);
  const yes = votes.filter(Boolean).length;
  const live = votes.length;
  return { hasDefect: decide(yes, live, rule || 'majority'), yes, live, fleet_size: fleet.length };
}

if (require.main === module) {
  const fleet = parseFleet(process.env.NF_REVIEWER_FLEET);
  if (fleet.length === 0) {
    process.stderr.write('[reviewer-quorum] set $NF_REVIEWER_FLEET to a newline/comma list of LLM commands\n');
    process.stdout.write('{"hasDefect":false,"error":"empty fleet"}\n');
    process.exit(0);
  }
  const v = quorumReview(readStdin(), fleet, process.env.NF_REVIEWER_VOTE);
  if (v.live === 0) process.stderr.write('[reviewer-quorum] no live reviewers (fleet of ' + v.fleet_size + ' all failed)\n');
  else process.stderr.write('[reviewer-quorum] ' + v.yes + '/' + v.live + ' flagged defect\n');
  process.stdout.write(JSON.stringify({ hasDefect: v.hasDefect }) + '\n');
}

module.exports = { parseFleet: parseFleet, quorumReview: quorumReview, askOne: askOne, decide: decide };
