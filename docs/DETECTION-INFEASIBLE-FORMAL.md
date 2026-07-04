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

**A source↔report drift detector was built and empirically disproven.** The one
corpus-safe design is: flag a declared variable made `\in Nat` *only* in a model
the report records as bounded (report-unbounded models use `\in Nat` legitimately
and are gated out — verified **0 baseline false positives** across all 67 models,
and it correctly detects the mutation on a bounded model like NFDeliberation).
**But it cannot function in the benchmark**, for a concrete reason:

- `.planning/formal/state-space-report.json` is **git-ignored** (`git check-ignore`
  confirms) — it is a generated TLC artifact, absent in every fresh SUT checkout.
  No committed artifact carries per-model boundedness (`model-registry.json` has
  none), so there is **no bounded/unbounded baseline to gate against** in the SUT.
- With the report absent, `lintTLAModels`'s report loop is empty and the gated
  drift check never runs → the mutation is invisible.
- Regenerating the report requires TLC (not `--fast`), and would regenerate it
  *from the mutated source* → the model becomes report-unbounded → the gate skips
  it → still no detection.

So the capability is real on a developer tree (where the report exists) but is
structurally unmeasurable by the benchmark. It was **not shipped** — a
report-dependent `CORRUPTION_RULE` that silently no-ops in the regression gate
adds risk without benchmark-validatable value.

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

---

## The FP-safe formal-behavioral detector set is complete (three detectors)

nf-solve's behavioral formal detection was built one behavior at a time, each
decidable and false-positive-free (0-baseline on 197 real models, benchmark
FAIL→PASS):

| # | Behavior | Detector / layer | Benchmark |
|---|---|---|---|
| 1 | Reachable safety-invariant violation (incl. deadlock) | `model_check` — TLC `INVARIANT` (nForma #305) | BENCH-025 |
| 2 | Petri unreachable marking (structural dead place) | `petri_check` — static dead-place (nForma #306) | BENCH-022 |
| 3 | Unsatisfiable liveness under fairness | `model_check` — TLC `PROPERTY`, dual-gated on fairness (nForma #307) | BENCH-102 |

These map onto the standard taxonomy of finite-state model-checkable properties
(safety / structural-reachability / temporal). A 4-model quorum (2026-07-04,
unanimous) confirmed there is **no fourth decidable, FP-safe behavioral class** in
this corpus — every remaining candidate is either subsumed by #1, oracle-dependent,
or already a separate lint pass (rejected: refinement/simulation checking,
action-precondition reachability, init-predicate satisfiability, hyperproperties,
SANY/operator errors).

### Framework-limited (not shippable without breaking the 0-baseline invariant)

- **BENCH-188 "weak invariant"** (above) — oracle-dependent: "too weak" is meaningful
  only relative to an intended stronger property. Supply it and detector #1 already
  catches the violation; omit it and the judgment needs an external oracle (LLM), not
  a decidable check.
- **Code-level concurrency** (BENCH-104 ABA, BENCH-048 semaphore-deadlock,
  BENCH-122 distributed-lock race, BENCH-031/191 test races, BENCH-152/178
  shared-state races) — sound static race/ABA/deadlock detection on arbitrary JS
  reduces to aliasing + happens-before inference over a Turing-complete language
  (Rice's theorem). Any sound approximation either explodes the false-positive rate
  or requires user annotations (re-introducing the oracle). A heuristic detector here
  would collapse the signal-vs-noise 0-baseline invariant that makes the formal
  layers actionable without triage. These stay `detection_only` and are out of scope
  for a source/TLC detector by construction — they are LLM/oracle territory.

Quorum debate: `QGSD/.planning/quorum/debates/2026-07-04-behavior-4-formal-detection-boundary.md`.
