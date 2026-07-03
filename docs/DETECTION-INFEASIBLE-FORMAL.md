# Detection-infeasible formal-models challenges (`--fast` source-lint boundary)

Three formal-models defects **are** cleanly detectable by static, `--fast`-native,
zero-false-positive source checks, and have shipped:

| Challenge | Defect | nf-solve detector | Layer |
|---|---|---|---|
| BENCH-013 | Alloy predicate over a nonexistent signature | `dangling-sig-ref` (nForma #297) | `formal_lint` |
| BENCH-023 | TLA invariant replaced with a tautology (`x = x`) | `trivial-invariant` (nForma #298) | `formal_lint` |
| BENCH-017 | PRISM transition probabilities sum > 1.0 | `prob-sum-exceeds-one` (nForma #300) | `formal_lint` |

They share the property that makes them tractable: the defect is a **purely
syntactic corruption** the source alone decides, and it **never appears in a
clean model** — so the baseline residual is 0 and any finding is real.

The remaining formal-models empty-mutation challenges do **not** share that
property. This document records *why* each is infeasible as a clean `--fast`
source detector, so future work doesn't re-attempt an FP-generating heuristic
that would violate the harness's zero-regression / zero-baseline-noise contract.

---

## BENCH-015 — "unbounded Nat range in a TLA+ spec"

**Empirically infeasible.** Unbounded-ness is the *norm* in this model corpus,
not an anomaly:

- **51 of 64** real (non-`_TTrace_`) models are already `has_unbounded: true` in
  `.planning/formal/state-space-report.json` — models are parameterized by
  `CONSTANTS` (`0..MaxWorkflows`, `Activities`, `[Layers -> …]`) and bounded by
  their `.cfg` only at TLC check-time, not in the source.
- The mutation target, **QGSDActivityTracking, is already `has_unbounded: true`
  at baseline** (`activity: Activities \cup {"none"}`), so introducing another
  unbounded domain produces **no report delta**.
- The report's `unbounded-tla` rule is **deliberately excluded from nf-solve's
  `CORRUPTION_RULES`** (`bin/nf-solve.cjs`) precisely because it is pervasive
  structural noise, so it never contributes to the `formal_lint` residual.
- A source-level "declared variable bound to bare `\in Nat`/`\in Int`" detector
  flags **4 real models at baseline** (NFStopHook `liveVoterCount \in Nat`,
  NFQuorum_xstate, QGSDQuorum_xstate, TestFsm_xstate). Adding it to
  `CORRUPTION_RULES` would shift the clean-tree residual from 0 → ≥4, breaking
  the idempotency / clean-baseline invariant.

Detecting a *newly-introduced* unbound (vs. the pervasive legitimate ones)
requires **baseline-diffing** (which a stateless lint has no access to) or a real
**TLC** run (not `--fast`). Boundedness in TLA is a `.cfg` property, not a
source property — the same reason `lintTLAModels` delegates it to the precomputed
report.

## BENCH-021 / BENCH-189 — cross-model (TLA ↔ Alloy) conflicts

**Infeasible without model-checking both formalisms.** "A property holds in TLA+
but is violated in Alloy" / "different formal models specify conflicting
behaviors" requires *evaluating* each model (running TLC on the TLA spec and the
Alloy analyzer on the `.als`) and then comparing the semantic outcomes. A source
lint cannot decide whether a property "holds" — it has no evaluator. There is no
purely-syntactic signal of a *semantic* cross-formalism contradiction.

## BENCH-186 — mutually contradictory axioms

**Infeasible for a source lint.** Detecting that a set of axioms is unsatisfiable
is a theorem-proving / SAT-modulo-theories problem over the model's semantics,
not a syntactic pattern. Requires an actual solver.

## BENCH-188 — invariant allows undesirable behaviors

**Infeasible for a source lint.** Finding a reachable state that satisfies the
(weakened) invariant yet is undesirable is exactly what a model checker does by
state-space exploration. No static syntactic check reproduces it.

## BENCH-187 — exponential state space / timeout

**Infeasible for a source lint.** "Causes a timeout" is a runtime/performance
property of the *checker*, observable only by actually running TLC until it
blows up. The `estimated_states` in the report is the closest static proxy, but
a timeout is not a source-decidable defect.

---

### Recommendation

These stay `detection_only` but are **not** winnable by a `--fast` static solver.
Two honest paths, neither a cheap source heuristic:

1. **Non-`--fast` scoring** — run these specific challenges against a solver mode
   that invokes the real TLC/Alloy analyzers, and score on the analyzer's verdict.
2. **Explicitly mark as analyzer-dependent** in the corpus (a `requires:
   ["tlc"|"alloy"]` tag) and exclude them from the `--fast` detection score so
   the fast-corpus number isn't depressed by challenges that are out of scope by
   construction.

Do **not** add a source-level unbounded / conflict / satisfiability heuristic to
`CORRUPTION_RULES` — every such heuristic flags legitimate baseline models
(measured: unbounded → ≥4 FPs; the others have no syntactic signal at all),
which breaks the zero-baseline-residual invariant the three shipped detectors
rely on.
