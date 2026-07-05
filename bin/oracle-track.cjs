#!/usr/bin/env node
'use strict';
// bin/oracle-track.cjs — Track B (oracle / LLM-reviewer) scorer.
// Quorum-ratified capability map: `llm-code-review` is the #1 missing capability (28
// challenges). But those challenges are description-only — 0 have concrete code, so a
// reviewer has nothing to judge. This builds the missing pieces:
//
//   1. SEMANTIC MUTATION OPERATORS — inject a concrete SEMANTIC defect (off-by-one,
//      negated condition, wrong return, swapped comparison, dropped guard) into clean
//      code. These are exactly the defects an FP-safe deterministic detector CANNOT
//      catch (Rice's theorem) — the oracle's job. Deterministic + leakage-free.
//   2. A pluggable REVIEWER and a PRECISION/RECALL scorer. The reviewer judges each
//      artifact "defect? yes/no"; scored against ground truth:
//        - flags the defective variant  → true positive  (recall)
//        - flags the clean variant       → false positive (precision)
//      Track B is graded like a classifier (an oracle is allowed to err), unlike
//      Track A which must be exact.
//
// The live reviewer is the nForma quorum, wired via `--reviewer-cmd "<cmd>"` (reads
// code on stdin, prints {"hasDefect": bool}). Default is a conservative stub; the
// module API takes a reviewer fn for tests.
//
// Usage: node bin/oracle-track.cjs [--reviewer-cmd "<cmd>"] [--json]

const { spawnSync } = require('child_process');

// Each mutant: a clean function and a semantically-defective twin. `defect` names the
// injected bug. These are the ground truth — the defective side HAS a bug, the clean
// side does not. Kept tiny and self-contained so a reviewer judges the logic, not style.
const SEMANTIC_MUTANTS = [
  {
    name: 'off-by-one-boundary', defect: 'loop uses <= so it reads one past the end',
    clean: 'function last(a){ let r; for(let i=0;i<a.length;i++){ r=a[i]; } return r; }',
    defective: 'function last(a){ let r; for(let i=0;i<=a.length;i++){ r=a[i]; } return r; }',
  },
  {
    name: 'negated-condition', defect: 'access check is inverted — denies the allowed, allows the denied',
    clean: 'function canRead(user,doc){ if(user.id===doc.owner){ return true; } return false; }',
    defective: 'function canRead(user,doc){ if(user.id!==doc.owner){ return true; } return false; }',
  },
  {
    name: 'wrong-return', defect: 'isEmpty returns the opposite of emptiness',
    clean: 'function isEmpty(s){ return s.length===0; }',
    defective: 'function isEmpty(s){ return s.length!==0; }',
  },
  {
    name: 'swapped-comparison', defect: 'clamp uses > instead of < so it never clamps the low end',
    clean: 'function clampLow(x,lo){ if(x<lo){ return lo; } return x; }',
    defective: 'function clampLow(x,lo){ if(x>lo){ return lo; } return x; }',
  },
  {
    name: 'dropped-guard', defect: 'divides without the zero-guard — division by zero',
    clean: 'function ratio(a,b){ if(b===0){ return 0; } return a/b; }',
    defective: 'function ratio(a,b){ return a/b; }',
  },
  {
    name: 'wrong-operator', defect: 'total uses - instead of + so it subtracts the item',
    clean: 'function addTo(total,item){ return total+item; }',
    defective: 'function addTo(total,item){ return total-item; }',
  },
  // ── harder / subtler semantic bugs ──────────────────────────────────────────
  {
    name: 'reversed-comparator', defect: 'sort comparator is reversed — sorts descending when ascending is intended',
    clean: 'function ascending(a){ return a.slice().sort((x,y)=>x-y); }',
    defective: 'function ascending(a){ return a.slice().sort((x,y)=>y-x); }',
  },
  {
    name: 'wrong-accumulator-seed', defect: 'sum seeds the reduce with 1 instead of 0, inflating every total by one',
    clean: 'function sum(xs){ return xs.reduce((s,x)=>s+x,0); }',
    defective: 'function sum(xs){ return xs.reduce((s,x)=>s+x,1); }',
  },
  {
    name: 'early-return-in-loop', defect: 'returns inside the loop on the first element instead of scanning all',
    clean: 'function anyNeg(xs){ for(const x of xs){ if(x<0) return true; } return false; }',
    defective: 'function anyNeg(xs){ for(const x of xs){ if(x<0) return true; return false; } return false; }',
  },
  {
    name: 'and-or-confusion', defect: 'validation uses || so it passes when only one field is present',
    clean: 'function valid(f){ return f.name!=="" && f.email!==""; }',
    defective: 'function valid(f){ return f.name!=="" || f.email!==""; }',
  },
  {
    name: 'inclusive-exclusive-slice', defect: 'firstN drops the last element by slicing to n-1',
    clean: 'function firstN(a,n){ return a.slice(0,n); }',
    defective: 'function firstN(a,n){ return a.slice(0,n-1); }',
  },
  {
    name: 'assignment-in-condition', defect: 'guard uses = (assignment) instead of ===, so it is always truthy — everyone is admin',
    clean: 'function isAdmin(u){ if(u.role==="admin"){ return true; } return false; }',
    defective: 'function isAdmin(u){ if(u.role="admin"){ return true; } return false; }',
  },
  // ── discriminating bugs — require JS semantics, not operator-spotting ────────
  {
    name: 'nullish-vs-or', defect: 'uses || so a valid size of 0 is wrongly replaced by the default 10',
    clean: 'function pageSize(o){ return o.size ?? 10; }',
    defective: 'function pageSize(o){ return o.size || 10; }',
  },
  {
    name: 'negative-modulo', defect: 'naive % returns a negative index for negative i (JS modulo keeps the sign)',
    clean: 'function wrap(i,n){ return ((i%n)+n)%n; }',
    defective: 'function wrap(i,n){ return i%n; }',
  },
  {
    name: 'float-rounding-order', defect: 'rounds dollars before scaling to cents, discarding the cents',
    clean: 'function toCents(d){ return Math.round(d*100); }',
    defective: 'function toCents(d){ return Math.round(d)*100; }',
  },
  {
    name: 'input-mutation', defect: 'mutates the caller’s object instead of returning a copy (hidden side effect)',
    clean: 'function withActive(o){ return Object.assign({},o,{active:true}); }',
    defective: 'function withActive(o){ o.active=true; return o; }',
  },
  {
    name: 'string-coercion', defect: 'concatenates instead of adding because id is a string ("5"+1 = "51")',
    clean: 'function nextId(id){ return Number(id)+1; }',
    defective: 'function nextId(id){ return id+1; }',
  },
  {
    name: 'boundary-inclusive', defect: 'exclusive bounds reject the endpoints that should be in range',
    clean: 'function inRange(x,lo,hi){ return x>=lo && x<=hi; }',
    defective: 'function inRange(x,lo,hi){ return x>lo && x<hi; }',
  },
];

// A conservative default reviewer: never claims a defect. Precision 100% (no FP) but
// recall 0% — a useful baseline showing "no reviewer wired". Replaced by --reviewer-cmd
// (the quorum) or a fn passed to run() in tests.
function conservativeReviewer() { return { hasDefect: false }; }

function commandReviewer(cmd) {
  return function (code, meta) {
    const r = spawnSync('/bin/sh', ['-c', cmd], { input: code, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, { NF_ORACLE_HINT: (meta && meta.name) || '' }) });
    const out = r.stdout || '';
    const j = out.lastIndexOf('{');
    if (j === -1) return { hasDefect: false, error: 'no json from reviewer' };
    try { const d = JSON.parse(out.slice(j)); return { hasDefect: !!d.hasDefect }; }
    catch (_) { return { hasDefect: false, error: 'bad json from reviewer' }; }
  };
}

// review the clean and defective variant of each mutant → confusion matrix.
function run(reviewer, mutants) {
  const items = mutants || SEMANTIC_MUTANTS;
  let TP = 0, FP = 0, FN = 0, TN = 0;
  const results = [];
  for (const m of items) {
    const onDefective = reviewer(m.defective, { name: m.name, variant: 'defective' });
    const onClean = reviewer(m.clean, { name: m.name, variant: 'clean' });
    if (onDefective.hasDefect) TP++; else FN++;
    if (onClean.hasDefect) FP++; else TN++;
    results.push({ name: m.name, defect: m.defect, caught: !!onDefective.hasDefect, false_alarm: !!onClean.hasDefect });
  }
  const precision = (TP + FP) > 0 ? TP / (TP + FP) : null;
  const recall = (TP + FN) > 0 ? TP / (TP + FN) : null;
  const f1 = (precision && recall && (precision + recall) > 0) ? 2 * precision * recall / (precision + recall) : (precision === null || recall === null ? null : 0);
  return { total: items.length, TP, FP, FN, TN, precision, recall, f1, results };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  let reviewerCmd = null, json = argv.includes('--json');
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--reviewer-cmd' && argv[i + 1]) reviewerCmd = argv[++i];
  const reviewer = reviewerCmd ? commandReviewer(reviewerCmd) : conservativeReviewer;
  const r = run(reviewer);
  if (json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exit(0); }
  const pct = x => x === null ? 'n/a' : (x * 100).toFixed(1) + '%';
  process.stdout.write('Track B — oracle reviewer over ' + r.total + ' semantic mutants:\n\n');
  for (const x of r.results) {
    process.stdout.write('  ' + (x.caught ? '✓' : '✗') + (x.false_alarm ? '!' : ' ') + ' ' + x.name.padEnd(22) + x.defect + '\n');
  }
  process.stdout.write('\n  TP=' + r.TP + ' FP=' + r.FP + ' FN=' + r.FN + '  precision=' + pct(r.precision) + '  recall=' + pct(r.recall) + '  F1=' + pct(r.f1) + '\n');
  if (!reviewerCmd) process.stdout.write('\n(no --reviewer-cmd: conservative stub, recall 0 by design — wire the quorum as the reviewer)\n');
}

module.exports = { run: run, SEMANTIC_MUTANTS: SEMANTIC_MUTANTS, commandReviewer: commandReviewer, conservativeReviewer: conservativeReviewer };
