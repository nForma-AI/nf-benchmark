# Unwinnable-by-construction detection challenges

These 54 `detection_only` challenges reference layers nf-solve does NOT produce, so they can NEVER pass regardless of solver capability. Fix = correct `scoring.target_layer` / `expected_outcome.layers_affected` to a real layer. (Auto-generated; see benchmark/score-grind.)

Real layers: r_to_f f_to_t c_to_f t_to_c f_to_c r_to_d d_to_c d_to_r c_to_r t_to_r p_to_f l1_to_l2 l1_to_l3 l3_to_tc (+informational hazard_model/per_model_gates/git_heatmap).

Non-existent layers referenced & suggested remap:
- `c_to_e` → c_to_r (code→requirements) or d_to_c
- `f_to_f` → l1_to_l3 / l3_to_tc (intra-formal) or f_to_t
- `c_to_t` → t_to_c (test↔code)
- `f_to_g` → f_to_t or l1_to_l3
- `l2_to_l3` → l1_to_l3 / l3_to_tc

| Challenge | Category | Bad layer(s) | Title |
|---|---|---|---|
| BENCH-042 | code | `c_to_e` | Hardcoded secret in source |
| BENCH-112 | code | `c_to_t` | Cross-site scripting in user input rendering |
| BENCH-117 | code | `c_to_t` | Inefficient algorithm with O(n²) complexity |
| BENCH-120 | code | `c_to_t` | Excessive API calls in tight loop |
| BENCH-126 | code | `c_to_t` | Platform-specific path separator handling |
| BENCH-129 | code | `c_to_t` | Unicode handling in string processing |
| BENCH-130 | code | `c_to_t` | Browser compatibility issue with CSS flexbox |
| BENCH-141 | code | `c_to_t` | Missing alt text on images |
| BENCH-142 | code | `c_to_t` | Poor color contrast ratio |
| BENCH-143 | code | `c_to_t` | Keyboard navigation not supported |
| BENCH-144 | code | `c_to_t` | Responsive design breakpoint failure |
| BENCH-145 | code | `c_to_t` | Poor user experience with slow loading states |
| BENCH-075 | config-hooks | `f_to_f` | Oscillation detection window too small |
| BENCH-078 | config-hooks | `f_to_f` | Context monitor threshold set to zero |
| BENCH-107 | config-hooks | `c_to_e` | Config hook with infinite recursion potential |
| BENCH-114 | config-hooks | `c_to_e` | Cryptographic key exposure in configuration |
| BENCH-136 | config-hooks | `c_to_e` | CI/CD pipeline with race condition in artifact dep |
| BENCH-138 | config-hooks | `c_to_e` | Infrastructure as code with resource conflicts |
| BENCH-176 | config-hooks | `c_to_e` | Config hook with circular dependency |
| BENCH-177 | config-hooks | `c_to_e` | Hook execution order dependency violation |
| BENCH-178 | config-hooks | `c_to_e` | Config hook with race condition on shared state |
| BENCH-179 | config-hooks | `c_to_e` | Hook failure causing cascading config errors |
| BENCH-180 | config-hooks | `c_to_e` | Config hook with external dependency timeout |
| BENCH-181 | config-hooks | `c_to_e` | Hook with side effects modifying global state |
| BENCH-182 | config-hooks | `c_to_e` | Config hook with memory leak accumulation |
| BENCH-183 | config-hooks | `c_to_e` | Hook execution bypassing security checks |
| BENCH-184 | config-hooks | `c_to_e` | Config hook with version compatibility issues |
| BENCH-185 | config-hooks | `c_to_e` | Hook with infinite recursion on config changes |
| BENCH-108 | convergence | `f_to_g`, `c_to_e` | Convergence failure with oscillating system state |
| BENCH-146 | convergence | `f_to_g`, `c_to_e` | Convergence timeout due to cyclic dependencies |
| BENCH-147 | convergence | `c_to_e` | Oscillating state with periodic resets |
| BENCH-149 | convergence | `f_to_g`, `c_to_e` | Multi-agent convergence deadlock |
| BENCH-150 | convergence | `c_to_e` | Convergence with external dependency failures |
| BENCH-152 | convergence | `c_to_t` | Convergence race condition in parallel processing |
| BENCH-153 | convergence | `f_to_g`, `c_to_e` | Convergence with non-monotonic progress |
| BENCH-154 | convergence | `c_to_t` | Convergence failure due to memory constraints |
| BENCH-155 | convergence | `c_to_e` | Infinite loop in convergence check |
| BENCH-062 | cross-layer-alignment | `l2_to_l3` | Low purpose alignment score |
| BENCH-065 | cross-layer-alignment | `l2_to_l3` | Good L1->L2 but tanked L2->L3 |
| BENCH-066 | cross-layer-alignment | `l2_to_l3` | Correct evidence but wrong purpose classification |
| BENCH-013 | formal-models | `f_to_f` | Alloy predicate with nonexistent signature |
| BENCH-014 | formal-models | `f_to_g` | Formal model gate maturity set to zero |
| BENCH-015 | formal-models | `f_to_f` | TLA+ spec with unbounded Nat range |
| BENCH-016 | formal-models | `f_to_g` | Formal model not registered in model registry |
| BENCH-017 | formal-models | `f_to_f` | PRISM model with invalid transition probabilities |
| BENCH-019 | formal-models | `f_to_f` | Overly complex TLA+ spec with 50+ variables |
| BENCH-021 | formal-models | `f_to_f` | Cross-formal inconsistency (TLA+ vs Alloy) |
| BENCH-022 | formal-models | `f_to_f` | Petri net with unreachable marking |
| BENCH-023 | formal-models | `f_to_f` | Trivially true formal invariant |
| BENCH-024 | formal-models | `f_to_f` | TLA+ spec timing out at default bounds |
| BENCH-186 | formal-models | `f_to_f` | Formal model with contradictory axioms |
| BENCH-187 | formal-models | `f_to_f` | Model checking with state space explosion |
| BENCH-189 | formal-models | `f_to_f` | Cross-formal model inconsistency |
| BENCH-190 | formal-models | `f_to_f` | Formal model with undefined behavior |
