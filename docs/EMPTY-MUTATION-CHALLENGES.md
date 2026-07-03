# Empty-mutation detection challenges (no `append`/`content`)

These 104 `file-modify` `detection_only` challenges have NO `append`/`content` field, so the mutator appends only the default `\n// modified by benchmark` comment — the defect described is NEVER injected, making them UNWINNABLE regardless of nf-solve capability. This is the single largest benchmark-repair lever (~45% of the 230-corpus).

Fix: add an `append` (or `content`) that actually injects the described defect, matching each challenge's `description`. Example (BENCH-013, now fixed): `append` a `pred { some x: NonexistentSignature | ... }` so the dangling-signature-reference detection (nForma #297) fires.

By category: code 28, config-hooks 15, convergence 9, documentation 1, formal-models 11, integration 15, reverse-flow 13, tests 12.

| Challenge | Category | Target | Described defect |
|---|---|---|---|
| BENCH-038 | code | `hooks/nf-context-monitor.js` | Remove try/catch wrapper around main logic |
| BENCH-042 | code | `bin/quorum-slot-dispatch.cjs` | Add hardcoded API endpoint URL constant |
| BENCH-043 | code | `bin/solve-wave-dag.cjs` | Add circular require to solve-cycle-detector.cjs w |
| BENCH-045 | code | `bin/nf-solve.cjs` | Add --bench-test flag parsing without documenting  |
| BENCH-046 | code | `bin/quorum-slot-dispatch.cjs` | Change fan-out boundary condition from < to <= |
| BENCH-047 | code | `hooks/nf-circuit-breaker.js` | Set default threshold to 0 or negative |
| BENCH-048 | code | `bin/solve-trend-helpers.cjs` | Change semaphore acquire to never release |
| BENCH-050 | code | `bin/solve-cycle-detector.cjs` | Change cycle window comparison from >= to > causin |
| BENCH-111 | code | `src/database.js` | Replace parameterized query with string concatenat |
| BENCH-112 | code | `src/renderer.js` | Remove HTML escaping from user input display |
| BENCH-113 | code | `src/auth.js` | Introduce logic error in session validation that a |
| BENCH-115 | code | `src/serializer.js` | Replace safe deserialization with eval-based parsi |
| BENCH-116 | code | `src/cache.js` | Add code that accumulates references without clean |
| BENCH-117 | code | `src/algorithm.js` | Change sorting/search to use nested loops instead  |
| BENCH-118 | code | `src/queries.js` | Add query that scans entire table without indexes |
| BENCH-120 | code | `src/api-client.js` | Move API call inside loop that executes multiple t |
| BENCH-122 | code | `src/lock.js` | Introduce timing window in lock acquisition/releas |
| BENCH-126 | code | `src/file-ops.js` | Replace path.join with hardcoded '/' separators |
| BENCH-128 | code | `src/date-utils.js` | Use naive date calculations ignoring DST transitio |
| BENCH-129 | code | `src/string-utils.js` | Use byte-based string operations on Unicode text |
| BENCH-130 | code | `src/styles.css` | Add CSS with unsupported properties in legacy brow |
| BENCH-131 | code | `src/ml-training.js` | Use same dataset for training and validation |
| BENCH-133 | code | `src/pipeline.js` | Include target variable in feature engineering for |
| BENCH-141 | code | `src/components/Image.js` | Remove alt prop from image component |
| BENCH-142 | code | `src/styles.css` | Set text color with low contrast against backgroun |
| BENCH-143 | code | `src/components/Button.js` | Remove keyboard event handlers from interactive co |
| BENCH-144 | code | `src/styles.css` | Use fixed pixel widths instead of responsive units |
| BENCH-145 | code | `src/components/DataTable.js` | Remove loading spinner during data fetch |
| BENCH-074 | config-hooks | `hooks/config-loader.js` | Change config merge to skip local config file |
| BENCH-076 | config-hooks | `hooks/nf-session-start.js` | Change exit code from 0 to 1 on successful complet |
| BENCH-080 | config-hooks | `hooks/config-loader.js` | Add path resolution using __dirname that works loc |
| BENCH-136 | config-hooks | `.github/workflows/deploy.yml` | Remove locking mechanism for deployment steps |
| BENCH-138 | config-hooks | `infrastructure/main.tf` | Add duplicate resource definitions causing conflic |
| BENCH-176 | config-hooks | `hooks/config-a.js` | Create circular dependency between config hooks |
| BENCH-177 | config-hooks | `hooks/order.js` | Reverse execution order of dependent hooks |
| BENCH-178 | config-hooks | `hooks/shared-state.js` | Add unsynchronized access to shared config state |
| BENCH-179 | config-hooks | `hooks/cascading.js` | Make hook throw exception affecting downstream con |
| BENCH-180 | config-hooks | `hooks/external.js` | Add blocking call to slow external service |
| BENCH-181 | config-hooks | `hooks/side-effects.js` | Add global state modifications in hook |
| BENCH-182 | config-hooks | `hooks/memory-leak.js` | Add memory accumulation in hook execution |
| BENCH-183 | config-hooks | `hooks/security-bypass.js` | Skip security validation in hook |
| BENCH-184 | config-hooks | `hooks/version.js` | Use deprecated hook API |
| BENCH-185 | config-hooks | `hooks/recursive.js` | Make hook modify config that triggers itself |
| BENCH-147 | convergence | `src/state-manager.js` | Add periodic state reset logic |
| BENCH-148 | convergence | `src/numerical.js` | Use direct equality on floating point values |
| BENCH-149 | convergence | `src/multi-agent.js` | Implement circular wait condition |
| BENCH-150 | convergence | `src/external-deps.js` | Add dependency on unreliable external service |
| BENCH-151 | convergence | `src/optimizer.js` | Use greedy algorithm prone to local optima |
| BENCH-152 | convergence | `src/parallel.js` | Add unsynchronized shared state updates |
| BENCH-153 | convergence | `src/algorithm.js` | Add random regression steps in convergence loop |
| BENCH-154 | convergence | `src/memory-intensive.js` | Increase memory requirements beyond system limits |
| BENCH-155 | convergence | `src/convergence-check.js` | Set impossible convergence condition |
| BENCH-105 | documentation | `docs/performance-spec.md` | Add requirements like 'response time < 1ns' or 'th |
| BENCH-015 | formal-models | `.planning/formal/tla/QGSDActivityTracking.tla` | Add variable with unbounded Nat type annotation |
| BENCH-017 | formal-models | `.planning/formal/prism/circuit-breaker.pm` | Modify transition probabilities to sum > 1.0 |
| BENCH-021 | formal-models | `.planning/formal/alloy/account-pool-structure.als` | Modify Alloy fact to contradict TLA+ invariant for |
| BENCH-023 | formal-models | `.planning/formal/tla/QGSDActivityTracking.tla` | Replace meaningful invariant with trivially true e |
| BENCH-102 | formal-models | `.planning/formal/tla/QGSDActivityTracking.tla` | Add <>[] (eventually always) property that contrad |
| BENCH-124 | formal-models | `.planning/formal/tla/Replication.tla` | Modify formal model to allow permanent inconsisten |
| BENCH-186 | formal-models | `.planning/formal/tla/Contradiction.tla` | Add contradictory axioms to formal model |
| BENCH-187 | formal-models | `.planning/formal/tla/Explosion.tla` | Add variables causing state space explosion |
| BENCH-188 | formal-models | `.planning/formal/tla/WeakInvariant.tla` | Weaken invariant to allow bad states |
| BENCH-189 | formal-models | `.planning/formal/alloy/Inconsistent.als` | Make Alloy model contradict TLA+ specification |
| BENCH-190 | formal-models | `.planning/formal/tla/Undefined.tla` | Add operation with undefined behavior |
| BENCH-119 | integration | `src/handler.js` | Make request handler synchronous, blocking concurr |
| BENCH-121 | integration | `src/distributed.js` | Remove partition detection and failover logic |
| BENCH-123 | integration | `src/microservice-a.js` | Add direct calls to another service's internal met |
| BENCH-127 | integration | `src/api-integration.js` | Use deprecated API endpoint that will be removed |
| BENCH-132 | integration | `data/train.csv` | Add poisoned samples that bias model predictions |
| BENCH-137 | integration | `Dockerfile` | Use outdated base image with security vulnerabilit |
| BENCH-166 | integration | `src/api-client.js` | Exceed rate limits in API integration |
| BENCH-168 | integration | `src/legacy-integration.js` | Use different encoding for data exchange |
| BENCH-169 | integration | `src/webhook-handler.js` | Disable signature verification for webhooks |
| BENCH-170 | integration | `src/db-integration.js` | Reduce connection pool size below requirements |
| BENCH-171 | integration | `src/message-queue.js` | Process messages out of order |
| BENCH-172 | integration | `src/oauth-client.js` | Use expired tokens in OAuth integration |
| BENCH-173 | integration | `src/file-integration.js` | Attempt operations without proper permissions |
| BENCH-174 | integration | `src/cache-integration.js` | Disable cache invalidation logic |
| BENCH-175 | integration | `src/monitoring-integration.js` | Lower alert thresholds causing false positives |
| BENCH-091 | reverse-flow | `docs/USER-GUIDE.md` | Add section claiming auto-scaling feature with no  |
| BENCH-092 | reverse-flow | `bin/solve-focus-filter.cjs` | Add @req comment but remove from traceability inde |
| BENCH-139 | reverse-flow | `scripts/deploy.sh` | Remove rollback logic from deployment script |
| BENCH-156 | reverse-flow | `src/backup.js` | Introduce corruption in backup creation process |
| BENCH-157 | reverse-flow | `src/rollback.js` | Reverse dependency order in rollback script |
| BENCH-158 | reverse-flow | `src/restore.js` | Add large data set that exceeds timeout |
| BENCH-159 | reverse-flow | `migrations/down.sql` | Create incompatible schema rollback |
| BENCH-160 | reverse-flow | `src/external-rollback.js` | Depend on unavailable external service for rollbac |
| BENCH-161 | reverse-flow | `src/partial-rollback.js` | Implement rollback that fails midway |
| BENCH-162 | reverse-flow | `src/concurrent-rollback.js` | Allow concurrent modifications during rollback |
| BENCH-163 | reverse-flow | `src/encrypted-rollback.js` | Lose encryption keys during rollback |
| BENCH-164 | reverse-flow | `src/distributed-rollback.js` | Add network partition simulation in rollback |
| BENCH-165 | reverse-flow | `src/resource-intensive-rollback.js` | Make rollback consume excessive resources |
| BENCH-027 | tests | `bin/layer-constants.test.cjs` | Remove @req annotation from test description |
| BENCH-030 | tests | `bin/layer-constants.test.cjs` | Copy an existing test block with modified descript |
| BENCH-031 | tests | `bin/quorum-slot-dispatch.test.cjs` | Remove await from an async test callback |
| BENCH-032 | tests | `bin/solve-cycle-detector.test.cjs` | Change assertion to test wrong property (passes bu |
| BENCH-033 | tests | `bin/layer-constants.test.cjs` | Add test using hardcoded /Users/bench/ path |
| BENCH-034 | tests | `bin/solve-wave-dag.test.cjs` | Add test that reads state set by preceding test wi |
| BENCH-035 | tests | `bin/oscillation-detector.test.cjs` | Remove unique assertions from tests so each test i |
| BENCH-191 | tests | `test/nondeterministic.test.js` | Add race condition causing intermittent test failu |
| BENCH-192 | tests | `test/overmocked.test.js` | Mock all dependencies hiding real bugs |
| BENCH-193 | tests | `test/environment-dependent.test.js` | Add test requiring unavailable environment resourc |
| BENCH-194 | tests | `test/clean-data.test.js` | Use sanitized test data missing edge cases |
| BENCH-195 | tests | `test/performance-unrealistic.test.js` | Use uniform load instead of realistic patterns |
