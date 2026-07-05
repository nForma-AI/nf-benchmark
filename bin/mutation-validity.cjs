#!/usr/bin/env node
'use strict';
// bin/mutation-validity.cjs — flag challenges whose mutation is INERT.
//
// A `file-modify` mutation that only bare-APPENDS a comment (`// modified by benchmark`)
// with no `find`/`replace`/`content` creates no detectable defect — it's pure file
// churn. ~100 corpus challenges do this; 95 are (correctly) tagged infeasible/fictional
// and excluded from the capability metric, but any tagged `feasible` is MISCATEGORISED:
// it claims to be a detectable challenge yet can never pass (the seeded "defect" is a
// no-op). This lint surfaces that class so it's fixed (real mutation) or re-tagged,
// and it guards against future inert padding of the corpus.
//
// Usage: node bin/mutation-validity.cjs [--json]  (exit 1 if any FEASIBLE inert found)

const fs = require('fs');
const path = require('path');

const CONTENT_KEYS = ['find', 'replace', 'content', 'value', 'json_path'];
const INERT_APPEND = /modified by benchmark|^\s*$/i;

function isInert(m) {
  if (!m || m.type !== 'file-modify') return false;
  if (CONTENT_KEYS.some(k => m[k] !== undefined)) return false;   // has real edit content
  if (m.append === undefined) return true;                        // modify with nothing to change
  return INERT_APPEND.test(String(m.append));                     // append is just a marker comment
}

function scan(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    let data; try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    for (const c of (Array.isArray(data) ? data : (data.challenges || []))) {
      if (isInert(c.mutation)) {
        out.push({ id: c.id, file: f, feasibility: c.feasibility || 'feasible', target: (c.mutation || {}).target_file });
      }
    }
  }
  return out;
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'challenges');
  const inert = scan(dir);
  const miscategorised = inert.filter(x => x.feasibility === 'feasible');
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ inert_total: inert.length, miscategorised, inert }, null, 2) + '\n');
    process.exit(miscategorised.length > 0 ? 1 : 0);
  }
  const byFeas = {};
  for (const x of inert) byFeas[x.feasibility] = (byFeas[x.feasibility] || 0) + 1;
  process.stdout.write('Mutation validity — ' + inert.length + ' inert (no-defect) mutations:\n');
  for (const [k, v] of Object.entries(byFeas)) process.stdout.write('  ' + k.padEnd(12) + v + (k === 'feasible' ? '  ← MISCATEGORISED (feasible but can never pass)' : '  (excluded from capability — ok)') + '\n');
  if (miscategorised.length) {
    process.stdout.write('\nFEASIBLE-but-inert (fix: real mutation, or re-tag):\n');
    for (const x of miscategorised) process.stdout.write('  ' + x.id + '  ' + x.target + '\n');
  }
  process.exit(miscategorised.length > 0 ? 1 : 0);
}

module.exports = { isInert: isInert, scan: scan };
