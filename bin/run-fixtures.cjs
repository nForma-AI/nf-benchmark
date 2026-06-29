#!/usr/bin/env node
'use strict';
// bin/run-fixtures.cjs
// Run the self-contained fixture corpus against a (pinned, npm) SUT — with NO host
// repo present. This is the fully-decoupled benchmark path.
//
//   node bin/run-fixtures.cjs --sut npm:@nforma.ai/nforma@0.43.1
//   node bin/run-fixtures.cjs --sut npm:@nforma.ai/nforma@0.43.1 --live   # real repair
//
// Default (no --live) is the fast CI gate that needs no LLM:
//   - residual_reduction fixtures must DETECT their gap via the SUT (nf-solve report-only),
//   - fix_and_verify fixtures must REPRODUCE their defect (verify fails).
// --live additionally drives residual fixtures' gap to 0 with a full solve (quorum toolchain).

const { discoverFixtures, loadFixture, runFixture } = require('../lib/fixture-runner.cjs');

function main() {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes('--json');
  const live = argv.includes('--live') || !!process.env.RUN_LIVE_SOLVE;
  const si = argv.indexOf('--sut');
  const sut = si >= 0 ? argv[si + 1] : (process.env.NF_SUT || undefined);

  const dirs = discoverFixtures();
  const results = [];
  for (const dir of dirs) {
    const fx = loadFixture(dir);
    let r, ok, mode;
    try {
      if (fx.method === 'residual_reduction') {
        r = runFixture(dir, { sut });
        ok = live ? r.passed === true : r.detected === true;
        mode = live ? 'live-repair' : 'detect';
      } else {
        r = runFixture(dir, { reproduceOnly: !live, sut });
        ok = r.passed === true;
        mode = live ? 'fix' : 'reproduce';
      }
    } catch (e) {
      r = { reason: 'error: ' + e.message };
      ok = false;
      mode = 'error';
    }
    results.push({ id: fx.id, method: fx.method, mode, ok, reason: r.reason });
  }

  const total = results.length;
  const passed = results.filter(x => x.ok).length;
  const allOk = total > 0 && passed === total;

  if (jsonMode) {
    console.log(JSON.stringify({ status: allOk ? 'pass' : 'fail', total, passed, sut: sut || '(default)', live, results }));
  } else {
    console.log(`━━━ Fixture corpus (SUT=${sut || 'default'}, ${live ? 'live repair' : 'detect/reproduce'}) ━━━`);
    for (const x of results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.id.padEnd(26)} [${x.mode}] ${x.reason}`);
    if (total === 0) console.log('  (no fixtures under fixtures/)');
    console.log(`  ${passed}/${total} fixtures OK`);
    console.log(allOk ? '  RESULT: PASS — decoupled corpus runs against the pinned SUT with no host repo.' : '  RESULT: FAIL');
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) main();
module.exports = { main };
