# Staged challenges — not loaded by the runner

`lib/challenges.cjs` reads `challenges/*.json` only, so anything here is inert. Same idea
as `.staged-fixtures/`: keep the intent in the repo instead of deleting it, restore when
the blocker is gone.

## 07-config-hooks-orphaned.json — BENCH-071/072/073/075/077/078

All six mutated `templates/nf.json` in the nForma SUT. That file **no longer exists**:
nForma deleted it (nForma-AI/nForma#387) because it shipped to npm as a default user
config that nothing read. `applyJsonMutation` throws on a missing target for every
non-`file-create` type, so all six would now error rather than score.

They should not be restored as-is. Even before the deletion they could not detect
anything: `templates/nf.json` was an **orphan** — no code path in nForma loaded it, so
zeroing `context_monitor.warning_threshold` or deleting `$.quorum` inside it changed no
behavior an analyzer could observe. Two of them documented that indirectly: BENCH-072 and
BENCH-077 are scored `no_crash`, i.e. they only assert nothing blew up.

Worse, they were actively harmful. The runner only grew `captureMutationTarget` /
`revertMutationTarget` later, so earlier runs left their mutations **committed** in the
nForma repo — the shipped file accumulated BENCH-073's `nf-bench-hook`
(`"event": "InvalidLifecycle"`), five stacked copies of BENCH-077's
`includes: ["nf-aux.json"]`, BENCH-075's `solve.oscillation_window`, BENCH-078's zeroed
threshold, and BENCH-072 had removed the entire `quorum` block. That pollution is what
prompted the deletion. The restore helpers now in `lib/runner.cjs` close that gap for
future challenges.

**To restore properly**, rewrite each against a config path nForma actually loads —
`~/.claude/nf.json` (global) or `.claude/nf.json` (project), both read by
`hooks/config-loader.js` — and pair it with a detector that reports the specific defect,
so the challenge scores `detection_only` on something real instead of `no_crash` on
something inert. Note `.claude/nf.json` is gitignored in nForma and absent from a fresh
clone, so a rewrite needs the harness to create it (today `applyJsonMutation` throws on a
missing target).
