# Measurement Model

How to read what nf-benchmark measures — and why it's split into two tracks with
different metrics. (Quorum-ratified 2026-07-04; see
`QGSD/.planning/quorum/debates/2026-07-04-make-benchmark-useful.md`.)

## The problem this model fixes

The headline detection score is **recall-only**: it measures "was the injected defect
found." A detector that flags *everything* scores 100% recall — so the number can't
rank detectors, and "improving" it can just mean getting noisier. And ~40% of the
corpus is **undecidable by construction** (see `COVERAGE-ANALYSIS.md` and
`DETECTION-INFEASIBLE-FORMAL.md`): races, leaks, perf, semantic correctness — a sound
FP-safe detector for these is impossible (Rice's theorem). Scoring those against a
deterministic detector conflates two incommensurable things.

## Two tracks

| | Track A — deterministic | Track B — oracle/LLM |
|---|---|---|
| **What** | FP-safe detectors (sast, require_graph, model_check, petri_check, fsm_check) | undecidable challenges (races/leaks/perf/semantic) |
| **Decidability** | decidable (bounded models / syntax / graph structure) | undecidable — needs a spec or human/LLM judgment |
| **Metric** | **exactness** — 100% recall **and** 0% false positives | **precision/recall** — an oracle is *allowed* to be wrong |
| **Runner** | the harnesses below | the quorum/LLM tier (future — not yet wired) |

Track A must be **exact**. Track B is graded like an ML classifier. Naming them keeps
the two from collapsing into one meaningless number.

## Track A — the exactness harnesses

Detection = recall **and** precision. The corpus historically measured only recall;
these harnesses add the missing precision axis and combine both.

- **Precision** — `npm run precision` (`bin/precision-harness.cjs`). Runs every
  deterministic detector on **known-clean code** (the `fixtures/clean-corpus` fixture
  and, in CI, the real nForma checkout) and requires **zero findings**. Every finding
  on clean code is a false positive. This is the **0-baseline invariant** — the
  property that makes "any finding = a real defect" true — now a *measured, gated*
  metric instead of a hand-checked assertion.
- **Recall** — `npm run recall` (`bin/recall-harness.cjs`). Applies structured
  **mutation operators** (PIT/mutmut-style) that inject a detector-targeted defect into
  a clean file and requires the detector to catch it. Operators are **deterministic and
  leakage-free** (no LLM saw them in training) and **scale** — every operator × clean
  base is fresh ground truth. Preferred over git-history mining precisely because it
  can't be contaminated by training data.
- **Exactness** — `npm run exactness` (`bin/exactness-report.cjs`). Combines the two
  into a confusion matrix and reports Track A **precision / recall / F1**. Passes only
  when precision = recall = 100%.

```
Track A — FP-safe deterministic detectors (must be EXACT):
  TP=6  FP=0  FN=0
  precision = 100.0%   recall = 100.0%   F1 = 100.0%
  verdict: EXACT ✓
```

## Corpus health

- **Coverage audit** — `npm run coverage-audit` (`bin/coverage-audit.cjs`). Read-only.
  Reports filled vs empty/tagged per layer, flags **redundancy** (many challenges with
  the same layer + mutation shape → dilute signal) and **gaps** (detectors with thin
  hand-authored coverage). Guides what to dedup and where to add signal.
- **Capability vs coverage** — the run report shows both `passed/total` (coverage) and
  `passed/feasible` (capability); infeasible/fictional challenges are tagged
  `feasibility` and excluded from the capability denominator (see `COVERAGE-ANALYSIS.md`).

## CI enforcement

- `.github/workflows/precision.yml` — live precision gate against nForma `main`
  (`require_graph` + `sast` on shipping code; TLC detectors SKIP without a jar).
- `.github/workflows/decoupled-fixtures.yml` — the harness unit tests + a
  SKIP-tolerant precision gate against the pinned npm SUT (goes live automatically once
  a release ships the detectors).

## Roadmap (remaining)

Track B needs a runner: wire the quorum/LLM as an oracle detector over the undecidable
challenges, scored by a precision/recall curve. Feed it a leakage-free corpus —
mutation operators first, then **external** git-history mining (never nForma's own
history, and post-2024 niche repos with single-hunk diffs, to avoid training-data
contamination and multi-bug-commit label noise).
