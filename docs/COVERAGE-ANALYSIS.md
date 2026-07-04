# Benchmark Coverage Analysis

**What fraction of the 230 challenges can actually measure `nf-solve`'s detection capability?**

A raw "X passed / 230" pass rate is misleading, because a large fraction of the
corpus is **unachievable by construction** — the challenge targets a defect no
sound (false-positive-free) detector can catch, or a file that does not exist in the
project under test. Those challenges are not capability gaps; they are corpus
artifacts. This document separates the two so the score can be read honestly.

## Classification (all 230)

| Category | Count | What it is |
|---|---:|---|
| **Filled** (real mutation) | 112 | Designed to pass — a concrete mutation a detector can find. |
| **Null-mutation** stability | 15 | `no_regression` checks — must show NO change; not a detection test. |
| **Empty, feasible authoring gap** | 20 | Description-only, but the target layer *could* detect a well-authored mutation on a real file. Optimistic — several are also mislabeled (see below). |
| **Empty, infeasible by construction** | 50 | Undecidable defect type — race/deadlock/ABA, memory leak, infinite loop/recursion, O(n²), state-space explosion, unbounded-Nat, oracle-dependent "too weak", cross-formal TLA↔Alloy. No FP-safe detector exists (Rice's theorem / needs an oracle). |
| **Empty, fictional target** | 33 | Targets a file not in the repo (`microservice-a.js`, `train.csv`, `Dockerfile`, `webhook-handler.js`, …) with no backing fixture. |

**Feasible denominator ≈ 112 filled + 20 authoring-gaps = 132** (57% of the corpus).
The remaining **~83 (36%)** — infeasible + fictional — cannot measure `nf-solve`
without either accepting false positives (which breaks the detectors' 0-baseline
invariant) or building new fixture projects.

## Why the two "unachievable" buckets are firm

- **Infeasible by construction** — sound static detection of races/ABA/deadlock/leaks
  on arbitrary code reduces to aliasing + happens-before over a Turing-complete
  language (Rice's theorem); the formal ones (unbounded-Nat, cross-formal,
  contradictory-axioms, state-explosion, weak-invariant) are oracle-dependent or
  undecidable. See `docs/DETECTION-INFEASIBLE-FORMAL.md`. A heuristic detector for
  these would flag legitimate code, collapsing the signal-vs-noise property that
  makes the shipped detectors actionable without triage.
- **Fictional target** — a `file-modify` on a path that does not exist applies no
  delta and can never produce a residual change. Making these pass requires a
  **fixture project** (like `fixtures/vuln-app`, which backs the SAST/secret
  challenges) — a per-cluster build effort, not a one-line mutation. Where the
  defect type is *also* infeasible (most of them: races, leaks, timeouts), even a
  fixture would not yield an FP-safe detector.

## The honest metric

Report `nf-solve` capability as **passed / feasible**, not **passed / 230**. The
feasible set is the 112 filled + the genuinely-authorable subset of the 20 gaps.
Challenges in the infeasible/fictional buckets should be tagged and excluded from the
capability score (or split into a separate "aspirational" suite), so a green run
reflects detection capability rather than corpus completeness.

## Where the remaining wins are (and are not)

- **Authoring gaps that are genuinely detector-backed** have been closed as found —
  e.g. BENCH-091/105 (doc `d_to_r`), BENCH-042 (secret via the `hardcoded-secret`
  SAST rule + `vuln-app`), BENCH-124/190 (concrete `model_check` models). Each is a
  verified FAIL→PASS.
- **Not worth manufacturing:** most of the remaining "feasible" 20 are mislabeled
  (an "off-by-one" or "wrong return type" logic bug tagged to a consistency layer
  that detects references, not semantics), or would only pass by re-authoring the
  challenge to test something other than its title, or by cloning an existing
  file-presence challenge. Neither measures new capability.
- **The real frontier** is fixture projects for whole clusters. It only pays off
  where the cluster's defect type is decidable + FP-safe (e.g. more injection/secret
  variants). For the race/leak/perf clusters it does not — those are infeasible
  regardless of fixture.
