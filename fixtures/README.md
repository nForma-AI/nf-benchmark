# Self-contained fixtures (decoupled benchmark architecture)

This is the target architecture confirmed by quorum (2026-06-29): replace the
"inject a mutation into the live QGSD repo and run nf-solve there" model with
**self-contained fixture projects** run against a **pinned SUT** in **ephemeral
isolation**. See `.planning/quorum/debates/2026-06-29-nf-benchmark-architecture.md`
in QGSD for the decision.

## Why
The old model coupled challenge validity to QGSD's evolving source (mutation targets
became "phantom" on every refactor — the recurring "broken/phantom challenge"
redesigns), pinned nothing (SUT = the dev checkout), and could corrupt/auto-commit
the live working repo. Self-contained fixtures fix all three: they carry their own
complete project, depend on **no host repo**, and so cannot rot; the SUT is pinned;
nothing the SUT does can touch your working tree.

## Fixture format
```
fixtures/<name>/
  fixture.json          # manifest
  project/              # a tiny COMPLETE project embodying ONE defect
    <code under test>
    verify.cjs          # the executable spec: exit 0 iff fixed, nonzero while broken
```

`fixture.json`:
```json
{
  "id": "FIX-...",                 // stable id
  "title": "...",                  // one line
  "category": "code|tests|...",
  "difficulty": "easy|medium|hard|expert",
  "defect": "...",                 // what's wrong (human-readable)
  "scoring": { "method": "fix_and_verify" | "no_regression", "target_layer": "code" },
  "verify": "node verify.cjs",     // command run inside project/ (cwd = the temp copy)
  "self_contained": true
}
```

## How a fixture is scored (`lib/fixture-runner.cjs`)
1. copy `project/` → throwaway temp dir (never the host repo);
2. run `verify` → must FAIL (defect present);
3. run the pinned SUT (nf-solve) against the temp copy;
4. run `verify` → must PASS (defect repaired);
5. discard the temp dir.

`fix_and_verify` passes iff verify failed pre AND passed post (defect reproduced then
repaired). `no_regression` passes iff verify passes post (no defect introduced).

### Two fixture flavors
- **`fix_and_verify`** (code-level) — `project/` is plain code + a `verify.cjs`. Use for
  defects a verify test can catch directly (sort/filter exemplars). Validated end-to-end
  with a stub SUT.
- **`residual_reduction`** (nForma-layer) — `project/` is a *minimal nForma project*
  (`.planning/formal/requirements.json`, etc.) with a seeded layer gap. Scored by
  `nf-solve`'s `residual_vector`: the runner measures residual via `nf-solve --report-only
  --json` (fast, no LLM) before and after the solve. Set `scoring.target_layer` (e.g.
  `r_to_f`) to score one seeded gap rather than every layer. **Validated:** `nf-solve`
  detects the seeded `r_to_f` gap on the `req-coverage-gap` exemplar (residual 1). The
  *repair* half (driving the residual to 0) runs a full solve and is gated behind
  `RUN_LIVE_SOLVE` (needs the live quorum toolchain).

## Adding a fixture
Create `fixtures/<name>/{fixture.json, project/...}` with a `verify` that fails on the
seeded defect. That's it — `discoverFixtures()` finds it and the runner handles the
rest. The exemplars `sort-ascending` and `filter-threshold` are the reference shape.

## SUT (system under test)
Resolved by `resolveSut()` (lib/runner.cjs): `--sut <path>` / `NF_SUT` (pinned) →
installed `~/.claude/nf-bin/nf-solve.cjs` → dev checkout (warned, not version-pinned).
Pin it for reproducible, version-comparable scores. The provenance (source+version)
is recorded on every run.

## Status & migration plan
**Landed (this branch):** the fixture format, `lib/fixture-runner.cjs`, two exemplars,
and an end-to-end test that runs fixtures through the runner with a stub SUT (proving
defect→repair discrimination and that the fixture source is never mutated).

**Resolved (the open design question):** `nf-solve` is residual/formal-driven — it needs
an nForma-shaped project and has no "repair a file until a test passes" mode. So the real
fixture format is a **minimal nForma project + a seeded layer gap, scored by residual
reduction** (the `residual_reduction` flavor above), validated for detection. The
`fix_and_verify` flavor remains for pure code defects.

**Next phase (follow-on):**
1. **Live repair validation.** Run `RUN_LIVE_SOLVE=1` (with the quorum toolchain) so the
   runner drives the seeded residual to 0 and scores `passed`. Wire this into a gated CI
   job separate from the fast unit tests.
2. **Migrate the 230 challenges.** Convert each existing mutation-spec challenge into a
   self-contained fixture (by category, in waves). Where a challenge mutated a QGSD
   file, capture the minimal code + a `verify` that encodes the same property.
3. **Deprecate the mutate-QGSD path** (`createSnapshot`/`applyMutation` against
   `projectRoot`) once fixtures reach parity; keep the `bin/nf-benchmark.cjs` CLI and
   CI-gate contract unchanged (the quorum's migration constraint).
4. **Results as artifacts** — keep `results/` gitignored; don't let it bloat the repo
   (the current bloat causes flaky `loadResults`/`saveResult` tests).
