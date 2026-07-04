# Capability Map

The benchmark as a **development roadmap**, not a scorecard. Each challenge that no FP-safe deterministic detector can pass marks nForma's frontier — it maps to a *missing capability*. Capabilities are ranked by how many real challenges they unlock. Quorum-ratified 2026-07-04 (debates/2026-07-04-benchmark-capability-map.md).

**Actionable** = unlocks ≥5 challenges + has a concrete technical prerequisite + a proof-of-concept challenge that passes once wired in. Below that it is a *hypothesis*, not a capability.

| Priority | Capability | Tier | Unlocks | Prerequisite | Proof-of-concept |
|---|---|---|--:|---|---|
| **1** | `llm-code-review` | oracle | 28 | wire the quorum as a reviewer over the diff, scored by precision/recall | an off-by-one the quorum majority flags |
| **2** | `fixture-project` | harness | 25 | a fixture project supplying real code for the scenario | the scenario routed to a fixture + an existing detector |
| **3** | `concurrency-modeling` | formal | 16 | PlusCal process-composition in the FSM→TLA emitter (interleaved execution) | a two-process lock/semaphore model whose mutual-exclusion invariant TLC violates |
| **4** | `resource-lifecycle-modeling` | formal | 13 | model resource acquire/release lifecycle (leaks = unreleased on some path) | an FSM where a resource is acquired on a path with no release |
| **5** | `complexity-analysis` | oracle | 7 | LLM/quorum reasoning about asymptotic cost (not statically decidable) | an O(n^2) hotspot the quorum flags with rationale |
| — | `property-strengthening` | oracle | 3 | derive the intended (stronger) property from requirement text, then model-check it | a "too weak" invariant whose intended strengthening is violated |
| — | `symbolic-model-check` | formal | 2 | symbolic/bounded state-space reduction so large models reach property-checking | an unbounded-Nat spec checked under a symmetry/bound |
| — | `cross-formalism-check` | formal | 2 | run TLA+Alloy(+PRISM) for the same requirement and diff their outcomes | an Alloy fact that contradicts a TLA invariant for one requirement |

## How to read this

- **Tier `formal`** — escapable by expressing the logic in a declared, verifiable form (state machine → TLA → model-check). Building these grows nForma's formal reach. Highest: `concurrency-modeling` (PlusCal process-composition — the deferred FSM step).
- **Tier `oracle`** — needs judgment (the multi-LLM quorum wired as a reviewer). `llm-code-review` unlocks the most challenges; it is the Track B runner the measurement model calls for.
- **Tier `harness`** — needs a fixture project supplying real code, not a new detector.

Regenerate: `node bin/capability-map.cjs`. Each tagged challenge carries a `requires_capability` field (`--write-tags`).

## Guardrails (quorum)

- Own bug-history is a **precision** corpus ("would we have caught it?"), not a capability test — fix commits are bugs *caught* (survivorship). Use **external** CVE/OSS corpora for recall, and only the formal/deterministic tier is leakage-free.
- A capability is real only when its PoC challenge actually passes once the capability is wired in — otherwise it is a hypothesis on this list.
