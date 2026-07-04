#!/usr/bin/env node
'use strict';
// bin/bug-history-miner.cjs — back the capability map with REAL defects
// (quorum-ratified 2026-07-04, debates/2026-07-04-benchmark-capability-map.md).
//
// The capability map ranks missing capabilities by how many SYNTHETIC challenges each
// unlocks. This grounds it in nForma's OWN history: it reads real fix() commits and
// classifies each by the capability that would have caught it — "would nForma have
// caught the bugs it wrote, and what capability would it have needed?"
//
// Guardrails the quorum insisted on:
//   - PRECISION corpus, not a capability test: fix commits are bugs that were CAUGHT
//     (survivorship). It measures the SHAPE of nForma's real defects, not a recall
//     ceiling. External CVE/OSS corpora are the recall side (future).
//   - The classification is by defect SHAPE (commit subject), not an LLM judgment.
//   - `deterministic-already` = defects a shipped detector already covers (regression
//     -guard, not a missing capability).
//
// Usage: node bin/bug-history-miner.cjs --repo <nForma-checkout> [--limit N] [--json] [--out <file>]

const fs = require('fs');
const { spawnSync } = require('child_process');
const { classify } = require('./capability-map.cjs');

const DETERMINISTIC_ALREADY = /dangling|circular (require|depend)|require of|sql inject|command inject|hardcoded (secret|path|key|absolute)|xss|eval|secret in source|invariant (violat|is violated)|unreachable marking|trivial invariant|prob.*sum|liveness/i;

// nForma's OWN orchestration/tooling scopes. Bugs here are in nForma itself, NOT the
// consistency/formal defects the detector targets in USER projects — so they are out
// of scope for the capability map (they'd only be caught by nForma dogfooding its own
// tooling as a "user project"). Separating them stops the fixture-project fallback
// from drowning the real signal.
const NFORMA_TOOLING_SCOPE = /^(fix|bug|hotfix)\((quorum|ci|install|hooks?|mcp[a-z-]*|release|skills?|link-[a-z]+|coderlm|tools|nf-tools|scoreboard|statusline|daintree|canopy|adapter|preflight|dispatch|slot|benchmark|packaging|deps?|build|lint|test|verify-hooks|precompact|session|stop-?hook)\)/i;

function fixCommits(repo, limit) {
  const SEP = '<<NFSEP>>';
  const r = spawnSync('git', ['-C', repo, 'log', '--pretty=format:%h' + SEP + '%s', '-n', String(limit)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out = r.stdout || '';
  const rows = [];
  for (const line of out.split('\n')) {
    const i = line.indexOf(SEP);
    if (i === -1) continue;
    const hash = line.slice(0, i);
    const subject = line.slice(i + SEP.length);
    if (!subject) continue;
    if (!/^(fix|bug|hotfix)(\(|:|\s)/i.test(subject)) continue;
    rows.push({ hash, subject });
  }
  return rows;
}

function mine(repo, limit) {
  const commits = fixCommits(repo, limit || 4000);
  const byCap = {};
  const mappings = [];
  for (const c of commits) {
    const cap = NFORMA_TOOLING_SCOPE.test(c.subject) ? 'out-of-scope-nforma-tooling'
      : DETERMINISTIC_ALREADY.test(c.subject) ? 'deterministic-already'
      : classify(c.subject);
    byCap[cap] = (byCap[cap] || 0) + 1;
    mappings.push({ commit: c.hash, subject: c.subject.slice(0, 100), capability: cap });
  }
  const ranked = Object.entries(byCap).map(([capability, count]) => ({ capability, count }))
    .sort((a, b) => b.count - a.count);
  return { total_bugs: commits.length, total_linked: mappings.length, ranked, mappings };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = { repo: null, limit: 4000, json: argv.includes('--json'), out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' && argv[i + 1]) opts.repo = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) opts.limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--out' && argv[i + 1]) opts.out = argv[++i];
  }
  if (!opts.repo) { process.stderr.write('bug-history-miner: --repo <nForma-checkout> required\n'); process.exit(2); }
  const r = mine(opts.repo, opts.limit);
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify({ schema_version: '1', total_bugs: r.total_bugs, total_linked: r.total_linked, ranked: r.ranked, mappings: r.mappings.slice(0, 500) }, null, 2) + '\n');
    process.stderr.write('wrote ' + opts.out + '\n');
  }
  if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exit(0); }
  process.stdout.write('Bug-history miner — ' + r.total_bugs + ' real fix commits classified by would-catch capability:\n\n');
  for (const row of r.ranked) {
    const pctv = (row.count / (r.total_bugs || 1) * 100).toFixed(1);
    process.stdout.write('  ' + row.capability.padEnd(28) + ' ' + String(row.count).padStart(4) + '  (' + pctv + '%)\n');
  }
  process.stdout.write('\nNote: fix commits are bugs that were CAUGHT (survivorship) — this measures nForma\'s\n');
  process.stdout.write('real defect SHAPE, not a recall ceiling. `deterministic-already` = a shipped detector\n');
  process.stdout.write('covers it (regression-guard, not a gap). External CVE/OSS corpora are the recall side.\n');
}

module.exports = { mine: mine };
