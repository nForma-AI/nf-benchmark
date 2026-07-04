#!/usr/bin/env node
'use strict';
// bin/capability-map.cjs — turn the "infeasible" set from EXCLUDED into a ROADMAP
// (quorum-ratified 2026-07-04, debates/2026-07-04-benchmark-capability-map.md).
//
// A challenge that no FP-safe deterministic detector can pass isn't trash — it marks
// nForma's FRONTIER. nForma escapes undecidability two ways: express the logic in a
// declared VERIFIABLE form (state machine → TLA → model-check) or apply LLM JUDGMENT
// (the quorum). So every infeasible/fictional challenge maps to a MISSING CAPABILITY.
// This tool classifies each and ranks capabilities by how many real challenges they
// unlock — a development priority queue read straight off the benchmark.
//
// Actionability gate (quorum): a capability is ACTIONABLE only with (a) a concrete
// technical prerequisite (not "needs AI" but "needs PlusCal process composition"),
// (b) a proof-of-concept challenge that PASSES once it's wired in, and (c) it unlocks
// >= 5 challenges. Below that it's a HYPOTHESIS, not a capability.
//
// Usage: node bin/capability-map.cjs [--json] [--write-tags]
//   --write-tags  also stamp `requires_capability` onto each tagged challenge.

const fs = require('fs');
const path = require('path');

// tier: formal = escapable via TLA/model-checking; oracle = needs LLM/quorum judgment;
// harness = needs a fixture/runner, not a detector.
const CAPABILITIES = [
  { id: 'concurrency-modeling', tier: 'formal', prereq: 'PlusCal process-composition in the FSM→TLA emitter (interleaved execution)', poc: 'a two-process lock/semaphore model whose mutual-exclusion invariant TLC violates', match: /race|concurren|deadlock|semaphore|mutex|shared.state|\bABA\b|partition|distributed lock|artifact deploy/i },
  { id: 'cross-formalism-check', tier: 'formal', prereq: 'run TLA+Alloy(+PRISM) for the same requirement and diff their outcomes', poc: 'an Alloy fact that contradicts a TLA invariant for one requirement', match: /cross-formal|tla.*alloy|alloy.*tla|cross-formal model incons/i },
  { id: 'symbolic-model-check', tier: 'formal', prereq: 'symbolic/bounded state-space reduction so large models reach property-checking', poc: 'an unbounded-Nat spec checked under a symmetry/bound', match: /unbounded|state space|explosion|too large/i },
  { id: 'property-strengthening', tier: 'oracle', prereq: 'derive the intended (stronger) property from requirement text, then model-check it', poc: 'a "too weak" invariant whose intended strengthening is violated', match: /too weak|weak invariant|undefined behavior|contradictory|unsatisf|wrong behavior/i },
  { id: 'resource-lifecycle-modeling', tier: 'formal', prereq: 'model resource acquire/release lifecycle (leaks = unreleased on some path)', poc: 'an FSM where a resource is acquired on a path with no release', match: /memory leak|\bleak\b|resource conflict|oscillat|cascad|infinite (loop|recursion)|recursion|side effect|external depend|timeout/i },
  { id: 'complexity-analysis', tier: 'oracle', prereq: 'LLM/quorum reasoning about asymptotic cost (not statically decidable)', poc: 'an O(n^2) hotspot the quorum flags with rationale', match: /o\(n|complexity|bottleneck|scalab|performance|10k concurrent/i },
  { id: 'llm-code-review', tier: 'oracle', prereq: 'wire the quorum as a reviewer over the diff, scored by precision/recall', poc: 'an off-by-one the quorum majority flags', match: /off-by-one|wrong (value|assertion|return|expected)|logic|semantic|bypass|order|redundant|duplicate|coverage hole|hardcoded (path|absolute)|magic|threshold|invalid|non-determin|encoding|deprecated|version compat|expired|rate limit|auth|migration|rollback|hook exits|dev but break|test data/i },
  { id: 'fixture-project', tier: 'harness', prereq: 'a fixture project supplying real code for the scenario', poc: 'the scenario routed to a fixture + an existing detector', match: /.*/ },
];

function classify(text) {
  for (const c of CAPABILITIES) if (c.match.test(text)) return c.id;
  return 'fixture-project';
}

function build(dir, writeTags) {
  const byCap = {};
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const p = path.join(dir, f);
    let data; try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
    const arr = Array.isArray(data) ? data : (data.challenges || []);
    let changed = false;
    for (const c of arr) {
      if (!c.feasibility) continue; // only tagged (infeasible/fictional)
      const cap = classify((c.title || '') + ' ' + (c.description || '') + ' ' + ((c.mutation || {}).description || ''));
      (byCap[cap] = byCap[cap] || []).push(c.id);
      if (writeTags && c.requires_capability !== cap) { c.requires_capability = cap; changed = true; }
    }
    if (writeTags && changed) fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  }
  const capMeta = Object.fromEntries(CAPABILITIES.map(c => [c.id, c]));
  const rows = Object.entries(byCap).map(([id, ids]) => ({
    capability: id, tier: capMeta[id].tier, prereq: capMeta[id].prereq, poc: capMeta[id].poc,
    unlocks: ids.length, actionable: ids.length >= 5, challenges: ids,
  })).sort((a, b) => b.unlocks - a.unlocks);
  return rows;
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'challenges');
  const rows = build(dir, process.argv.includes('--write-tags'));
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(rows, null, 2) + '\n'); process.exit(0); }
  process.stdout.write('Capability map — missing capabilities ranked by real challenges unlocked:\n\n');
  for (const r of rows) {
    process.stdout.write((r.actionable ? '▶ ' : '· ') + r.capability.padEnd(28) + ' [' + r.tier + ']  unlocks ' + String(r.unlocks).padStart(2) + (r.actionable ? '  ACTIONABLE' : '  (hypothesis, <5)') + '\n');
    process.stdout.write('    prereq: ' + r.prereq + '\n');
    process.stdout.write('    PoC:    ' + r.poc + '\n');
  }
  process.stdout.write('\n▶ = actionable (unlocks >=5 challenges + concrete prereq + PoC). Build these first, highest unlock-count first.\n');
}

module.exports = { build: build, classify: classify, CAPABILITIES: CAPABILITIES };
